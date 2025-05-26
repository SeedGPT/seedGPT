import { AnthropicMessage, Task, Config } from './types.js'
import { LLMClient } from './llmClient.js'
import { WorkspaceManager } from './workspaceManager.js'
import { CIManager } from './ciManager.js'
import { LLMTools } from './llmTools.js'
import { IntelligentTaskManager } from './intelligentTaskManager.js'
import { ContextManager } from './contextManager.js'
import { BranchRecoveryManager } from './branchRecoveryManager.js'
import { Octokit } from '@octokit/rest'
import logger from './logger.js'
import { parseCodeReview } from './codeReviewer.js'
import { getPatchGenerationPrompt, getReviewPrompt, getSummarizePrompt } from './systemPrompt.js'
import { appendProgress } from './progressLogger.js'
import { updateMemory } from './memory.js'

export interface WorkflowDependencies {
	llmClient: LLMClient
	workspaceManager: WorkspaceManager
	ciManager: CIManager
	llmTools: LLMTools
	intelligentTaskManager: IntelligentTaskManager
	contextManager: ContextManager
	branchRecoveryManager: BranchRecoveryManager
	octokit: Octokit
	cfg: Config
}

export interface WorkflowState {
	task: Task
	branchName: string
	contextMessages: AnthropicMessage[]
	currentPatch?: string
	prNumber?: number
	iterationCount: number
	maxIterations: number
	decisionHistory: WorkflowDecision[]
	ciFailureCount: number
	lastFailureReason?: string
}

export interface WorkflowDecision {
	iteration: number
	decision: 'continue' | 'complete' | 'fix_ci' | 'restart' | 'block'
	reasoning: string
	timestamp: string
	contextSnapshot: string
}

export class EvolutionWorkflow {
	private deps: WorkflowDependencies

	constructor(dependencies: WorkflowDependencies) {
		this.deps = dependencies
	}
	async executeTask(task: Task): Promise<boolean> {
		const state: WorkflowState = {
			task,
			branchName: await this.deps.workspaceManager.createFeatureBranch(task.id),
			contextMessages: await this.deps.contextManager.buildContextMessages(task.description),
			iterationCount: 0,
			maxIterations: 10,
			decisionHistory: [],
			ciFailureCount: 0
		}

		try {
			logger.info(`🛠 Starting task execution workflow`, { taskId: task.id })
			
			await this.iterativeImplementation(state)
			
			const merged = await this.handlePRAndMerge(state)
			if (merged) {
				await this.finalizeSuccessfulTask(state)
				return true
			}
			
			return false
		} catch (error) {
			await this.handleTaskFailure(state, error)
			return false
		}
	}
	private async iterativeImplementation(state: WorkflowState): Promise<void> {
		while (state.iterationCount < state.maxIterations) {
			state.iterationCount++
			logger.info(`🔄 Development iteration ${state.iterationCount}/${state.maxIterations}`, { taskId: state.task.id })

			await this.generateAndReviewPatch(state)
			await this.applyPatchToWorkspace(state)
			
			// Enhanced commit messaging for iterative development
			const commitMessage = this.buildIterationCommitMessage(state)
			await this.deps.workspaceManager.commitAndPush(state.task.id, commitMessage, state.branchName)
			
			logger.info(`💾 Iteration ${state.iterationCount} committed to branch`, { 
				taskId: state.task.id, 
				branch: state.branchName,
				message: commitMessage.substring(0, 50) + '...'
			})
			
			if (state.iterationCount === 1) {
				state.prNumber = await this.createPullRequest(state)
			}

			const shouldContinue = await this.checkIfMoreWorkNeeded(state)
			if (!shouldContinue) {
				logger.info(`✅ Implementation complete after ${state.iterationCount} iterations`, { taskId: state.task.id })
				break
			}
		}

		if (state.iterationCount >= state.maxIterations) {
			throw new Error(`Maximum iterations (${state.maxIterations}) reached without completion`)
		}
	}

	private async generateAndReviewPatch(state: WorkflowState): Promise<void> {
		const patchPrompt = this.buildPatchPrompt(state)
		logger.info('🔧 Generating patch...', { taskId: state.task.id, iteration: state.iterationCount })
		
		let patch = await this.deps.llmClient.generatePatch([
			...state.contextMessages,
			{ role: 'user', content: patchPrompt }
		])

		const reviewPrompt = getReviewPrompt(patch)
		logger.info('🔍 Reviewing generated patch...', { taskId: state.task.id })

		const reviewFeedback = await this.deps.llmClient.generateReview([
			...state.contextMessages,
			{ role: 'user', content: reviewPrompt }
		])

		const parsedReview = parseCodeReview(reviewFeedback)
		
		if (!parsedReview.approved || parsedReview.issues.length > 0) {
			logger.info('🔍 Review found issues, generating improved patch...', {
				taskId: state.task.id,
				issues: parsedReview.issues,
				score: parsedReview.score
			})
			patch = await this.deps.llmClient.generateCodeFix(patch, reviewFeedback, state.contextMessages)
		}

		state.currentPatch = patch
	}

	private async applyPatchToWorkspace(state: WorkflowState): Promise<void> {
		if (!state.currentPatch) {
			throw new Error('No patch available to apply')
		}

		logger.info('📝 Applying patch to workspace...', { taskId: state.task.id })
		await this.deps.workspaceManager.applyPatch(state.currentPatch, state.task.id)
		logger.info('✅ Patch applied successfully', { taskId: state.task.id })
	}

	private async createPullRequest(state: WorkflowState): Promise<number> {
		const pr = await this.deps.octokit.pulls.create({
			owner: process.env.GITHUB_REPO_OWNER!,
			repo: process.env.GITHUB_REPO_NAME!,
			head: state.branchName,
			base: this.deps.cfg.git.mainBranch,
			title: `🔨 Task #${state.task.id}: ${state.task.description}`,
			body: this.buildPRDescription(state)
		})

		logger.info(`📬 PR #${pr.data.number} created: ${pr.data.html_url}`)
		return pr.data.number
	}
    
    private async checkIfMoreWorkNeeded(state: WorkflowState): Promise<boolean> {
		const analysisPrompt = `
Task: ${state.task.description}
Current iteration: ${state.iterationCount}
Branch: ${state.branchName}

DECISION HISTORY:
${state.decisionHistory.map(d => `Iteration ${d.iteration}: ${d.decision} - ${d.reasoning}`).join('\n')}

As an autonomous development agent, I need to determine if more work is required for this task.

Current development status:
- Iteration ${state.iterationCount} of ${state.maxIterations} completed
- Changes have been applied and committed
${state.prNumber ? `- PR #${state.prNumber} has been created` : '- PR will be created on next iteration'}
${state.ciFailureCount > 0 ? `- Previous CI failures: ${state.ciFailureCount}` : '- No CI failures so far'}

I should analyze:
1. Is the core functionality fully implemented according to the task description?
2. Are there missing edge cases, error handling, or validation?
3. Should I add comprehensive tests to ensure reliability?
4. Is documentation needed for the new functionality?
5. Are there potential improvements or optimizations to make?
6. Could the implementation be more robust or maintainable?
7. Have I learned from previous decision history and failures?

Based on my self-assessment and the current state, I will decide whether to:
- CONTINUE: Continue with another iteration to improve/complete the implementation
- COMPLETE: The task is sufficiently implemented and ready for CI/merge

Decision and reasoning:`

		const response = await this.deps.llmClient.generateResponse([
			...state.contextMessages,
			{ role: 'user', content: analysisPrompt }
		])

		const shouldContinue = response.toUpperCase().includes('CONTINUE')
		const decision = shouldContinue ? 'continue' : 'complete'
		
		// Record decision in history		
        state.decisionHistory.push({
			iteration: state.iterationCount,
			decision,
			reasoning: response.substring(0, 300),
			timestamp: new Date().toISOString(),
			contextSnapshot: `Iteration ${state.iterationCount}, CI failures: ${state.ciFailureCount}`
		})
		
		logger.info(`LLM iteration decision: ${decision.toUpperCase()}`, {
			taskId: state.task.id,
			iteration: state.iterationCount,
			reasoning: response.substring(0, 200),
			totalDecisions: state.decisionHistory.length
		})

		return shouldContinue
	}
	private async handlePRAndMerge(state: WorkflowState): Promise<boolean> {
		if (!state.prNumber) {
			throw new Error('No PR number available for merging')
		}

		logger.info(`⏳ Monitoring CI and attempting merge for PR #${state.prNumber}`)
		
		const maxCIAttempts = 3
		let attempt = 1
		
		while (attempt <= maxCIAttempts) {
			logger.info(`CI monitoring attempt ${attempt}/${maxCIAttempts}`, { prNumber: state.prNumber })
			
			const ciResult = await this.deps.ciManager.waitForCIAndMerge(state.prNumber)
			
			if (ciResult) {
				logger.info(`✅ CI passed and PR merged successfully`, { prNumber: state.prNumber })
				return true
			}
			
			if (attempt < maxCIAttempts) {
				logger.warn(`CI failed for PR #${state.prNumber}, attempting intelligent failure analysis`, { attempt })
				
				const fixed = await this.handleCIFailureWithLLM(state)
				if (fixed) {
					attempt++
					continue
				} else {
					logger.error(`Unable to fix CI failure after LLM analysis`, { prNumber: state.prNumber })
					return false
				}
			}
			
			attempt++
		}
		
		logger.error(`CI failed after ${maxCIAttempts} attempts for PR #${state.prNumber}`)
		return false
	}
	private async handleCIFailureWithLLM(state: WorkflowState): Promise<boolean> {
		try {
			const ciStatus = await this.deps.ciManager.getCIStatus(state.prNumber!)
			state.ciFailureCount++
			state.lastFailureReason = ciStatus.description || 'Unknown CI failure'
			
			// Get detailed CI logs for analysis
			const ciLogs = await this.getCIFailureLogs(state.prNumber!)
			
			const failureAnalysisPrompt = `
CI FAILURE ANALYSIS REQUIRED

Task: ${state.task.description}
PR: #${state.prNumber}
Iteration: ${state.iterationCount}
Branch: ${state.branchName}
Failure Count: ${state.ciFailureCount}

CI Status Details:
- State: ${ciStatus.state}
- Conclusion: ${ciStatus.conclusion}
- Description: ${ciStatus.description}

CI FAILURE LOGS:
${ciLogs}

PREVIOUS DECISIONS:
${state.decisionHistory.slice(-3).map(d => `${d.decision}: ${d.reasoning}`).join('\n')}

As an autonomous development agent, I need to analyze this CI failure and determine the best course of action.

FAILURE ANALYSIS:
1. Root Cause Identification:
   - Compilation errors (syntax, type errors, missing imports)
   - Test failures (unit tests, integration tests, linting)
   - Build issues (dependency problems, configuration errors)
   - Infrastructure issues (timeouts, resource limits)

2. Fix Strategy Assessment:
   - Is this a simple fix I can generate automatically?
   - Does this require a fundamental approach change?
   - Are there patterns I can learn from previous failures?

3. Decision Framework:
   - GENERATE_FIX: I can identify and fix the specific issue
   - RESTART_ITERATION: The approach needs to be reconsidered
   - BLOCK_TASK: Fundamental issues require human intervention

Based on my detailed analysis of the logs and failure patterns:

Analysis and decision:`

			const analysis = await this.deps.llmClient.generateResponse([
				...state.contextMessages,
				{ role: 'user', content: failureAnalysisPrompt }
			])

			// Record decision
			const decision = analysis.toUpperCase().includes('GENERATE_FIX') ? 'fix_ci' :
							analysis.toUpperCase().includes('RESTART_ITERATION') ? 'restart' : 'block'
							
			state.decisionHistory.push({
				iteration: state.iterationCount,
				decision,
				reasoning: analysis.substring(0, 300),
				timestamp: new Date().toISOString(),
				contextSnapshot: `CI failure ${state.ciFailureCount}, ${ciStatus.state}: ${ciStatus.description}`
			})

			if (decision === 'fix_ci') {
				logger.info(`LLM decided to generate fix for CI failure`, { prNumber: state.prNumber, failureCount: state.ciFailureCount })
				return await this.generateCIFix(state, analysis)
			} else if (decision === 'restart') {
				logger.info(`LLM decided to restart iteration due to CI failure`, { prNumber: state.prNumber, failureCount: state.ciFailureCount })
				return await this.restartIteration(state)
			} else {
				logger.warn(`LLM decided to block task due to CI failure`, { prNumber: state.prNumber, failureCount: state.ciFailureCount })
				state.task.status = 'blocked'
				state.task.metadata = state.task.metadata || {}
				state.task.metadata.blockedReason = `CI failures after ${state.ciFailureCount} attempts: ${state.lastFailureReason}`
				return false
			}
		} catch (error) {
			logger.error('Error in LLM CI failure analysis', { error, prNumber: state.prNumber })
			return false
		}
	}
	private async getCIFailureLogs(prNumber: number): Promise<string> {
		try {
			logger.info(`Fetching real CI logs for PR #${prNumber}`)
			
			const logs = await this.deps.ciManager.getWorkflowLogs(prNumber)
			
			if (!logs || logs.includes('No CI workflows found') || logs.includes('No failed workflows found')) {
				return `No detailed CI failure logs available for PR #${prNumber}. This could indicate:
- CI workflows haven't started yet
- All workflows passed successfully
- Workflows are still running
- Non-standard CI workflow configuration

Please check the GitHub Actions tab for this PR to see the current status.`
			}
			
			return logs
		} catch (error) {
			logger.error('Failed to fetch CI logs', { error, prNumber })
			return `Unable to fetch detailed CI logs for PR #${prNumber}: ${error}`
		}
	}

	private async generateCIFix(state: WorkflowState, analysis: string): Promise<boolean> {
		const fixPrompt = `
Based on my analysis of the CI failure, I need to generate a fix.

Previous Analysis: ${analysis}

Task: ${state.task.description}
Current Iteration: ${state.iterationCount}

Generate a patch that specifically addresses the CI failure while maintaining the integrity of the implementation.
Focus on:
- Fixing compilation errors
- Resolving test failures  
- Addressing linting/formatting issues
- Ensuring code quality standards are met

The fix should be minimal and targeted to resolve the CI issues without breaking existing functionality.`

		try {
			const fixPatch = await this.deps.llmClient.generatePatch([
				...state.contextMessages,
				{ role: 'user', content: fixPrompt }
			])

			await this.deps.workspaceManager.applyPatch(fixPatch, state.task.id)
			
			const commitMessage = `Fix CI failure - Iteration ${state.iterationCount}: ${state.task.description}`
			await this.deps.workspaceManager.commitAndPush(state.task.id, commitMessage, state.branchName)
			
			logger.info(`Applied LLM-generated CI fix`, { prNumber: state.prNumber })
			return true
		} catch (error) {
			logger.error('Failed to apply LLM-generated CI fix', { error, prNumber: state.prNumber })
			return false
		}
	}

	private async restartIteration(state: WorkflowState): Promise<boolean> {
		try {
			logger.info(`Restarting iteration ${state.iterationCount} due to CI failure`, { taskId: state.task.id })
			
			await this.generateAndReviewPatch(state)
			await this.applyPatchToWorkspace(state)
			
			const commitMessage = `Restart iteration ${state.iterationCount}: ${state.task.description}`
			await this.deps.workspaceManager.commitAndPush(state.task.id, commitMessage, state.branchName)
			
			return true
		} catch (error) {
			logger.error('Failed to restart iteration', { error, taskId: state.task.id })
			return false
		}
	}	private async finalizeSuccessfulTask(state: WorkflowState): Promise<void> {
		logger.info(`🎉 PR #${state.prNumber} successfully merged`)

		const summaryPrompt = getSummarizePrompt(state.prNumber!.toString(), state.task.description)
		const summary = await this.deps.llmClient.generateSummary([
			...state.contextMessages,
			{ role: 'user', content: summaryPrompt }
		])

		// Enhanced summary with workflow insights
		const enhancedSummary = `${summary}

WORKFLOW INSIGHTS:
- Completed in ${state.iterationCount} iterations
- Decision history: ${state.decisionHistory.length} decisions made
- CI failure count: ${state.ciFailureCount}
- Key decisions: ${state.decisionHistory.map(d => d.decision).join(' → ')}
- Iterative improvements: ${state.decisionHistory.filter(d => d.decision === 'continue').length}
- Total development time: ${state.decisionHistory.length > 0 ? 
			new Date(state.decisionHistory[state.decisionHistory.length - 1].timestamp).getTime() - 
			new Date(state.decisionHistory[0].timestamp).getTime() : 0}ms`

		appendProgress(this.deps.cfg.files.progress, enhancedSummary, {
			taskId: state.task.id,
			prNumber: state.prNumber
		})

		await updateMemory(this.deps.cfg.memory, enhancedSummary, {
			taskId: state.task.id,
			prNumber: state.prNumber,
			importance: 'medium'
		})

		// Store workflow state for future learning
		await this.saveWorkflowState(state)

		state.task.status = 'done'
		state.task.completedAt = new Date().toISOString()
		state.task.metadata = state.task.metadata || {}
		state.task.metadata.iterationCount = state.iterationCount
		state.task.metadata.ciFailureCount = state.ciFailureCount
		state.task.metadata.workflowDecisions = state.decisionHistory.length
		
		logger.info(`✅ Task #${state.task.id} completed successfully - Branch and PR preserved for history`, {
			iterations: state.iterationCount,
			decisions: state.decisionHistory.length,
			ciFailures: state.ciFailureCount
		})
	}

	private async saveWorkflowState(state: WorkflowState): Promise<void> {
		try {
			const workflowHistory = {
				taskId: state.task.id,
				branchName: state.branchName,
				prNumber: state.prNumber,
				iterationCount: state.iterationCount,
				ciFailureCount: state.ciFailureCount,
				decisionHistory: state.decisionHistory,
				completedAt: new Date().toISOString(),
				taskDescription: state.task.description,
				finalStatus: state.task.status
			}
			
			// In a full implementation, this would be saved to a database or file system
			// For now, we'll log it for debugging and future analysis
			logger.info('Workflow state saved for analysis', { 
				workflowHistory: JSON.stringify(workflowHistory, null, 2) 
			})
			
		} catch (error) {
			logger.error('Failed to save workflow state', { error, taskId: state.task.id })
		}
	}

	private async handleTaskFailure(state: WorkflowState, error: any): Promise<void> {
		logger.error('Task execution failed', { error, taskId: state.task.id })

		state.task.metadata = state.task.metadata || {}
		state.task.metadata.failureCount = (state.task.metadata.failureCount || 0) + 1
		state.task.metadata.lastAttempt = new Date().toISOString()

		const recoveryPrompt = this.buildRecoveryPrompt(state, error)
		
		try {
			const recoveryResponse = await this.deps.llmClient.generateResponse([
				...state.contextMessages,
				{ role: 'user', content: recoveryPrompt }
			])
		await this.executeRecoveryAction(state, recoveryResponse)
		} catch (recoveryError) {
			logger.error('Recovery action failed', { recoveryError, taskId: state.task.id })
			state.task.status = 'pending'
		}

		logger.info(`Branch ${state.branchName} preserved for debugging and history`)
	}

	private async executeRecoveryAction(state: WorkflowState, recoveryResponse: string): Promise<void> {
		const toolRequest = this.deps.llmTools.parseToolRequest(recoveryResponse)
		if (!toolRequest) {
			state.task.status = 'pending'
			return
		}

		let toolResult
		switch (toolRequest.tool) {
			case 'NUKE_BRANCH':
				toolResult = await this.deps.llmTools.nukeBranch(state.task, state.branchName, toolRequest.reason)
				break
			case 'RESTART_TASK':
				toolResult = await this.deps.llmTools.restartTask(state.task, toolRequest.reason)
				break
			case 'BLOCK_TASK':
				toolResult = await this.deps.llmTools.blockTask(state.task, toolRequest.reason)
				break
			default:
				state.task.status = 'pending'
				return
		}

		logger.info('Recovery action completed', {
			taskId: state.task.id,
			tool: toolRequest.tool,
			result: toolResult
		})
	}
	private buildPatchPrompt(state: WorkflowState): string {
		const templatePrompt = getPatchGenerationPrompt(state.task.description)
		
		if (state.iterationCount > 1) {
			return `${templatePrompt}

ITERATIVE DEVELOPMENT CONTEXT:
This is iteration ${state.iterationCount} of the implementation. Previous work has been done and committed.

As an autonomous development agent, I should focus on:
- Addressing any remaining requirements not covered in previous iterations
- Fixing issues discovered through testing or review
- Adding comprehensive tests if not already present
- Improving error handling and edge cases
- Enhancing documentation or code clarity
- Making incremental improvements based on my self-assessment

I should provide only the changes needed for this iteration, building upon the existing work.

Previous iterations have been committed, so I can see the current state of the codebase.
My goal is to make meaningful progress toward completing the task requirements.`
		}
		
		return templatePrompt
	}

	private buildIterationCommitMessage(state: WorkflowState): string {
		if (state.iterationCount === 1) {
			return `Initial implementation: ${state.task.description}`
		}
		
		// For subsequent iterations, create more descriptive commit messages
		const recentDecision = state.decisionHistory[state.decisionHistory.length - 1]
		
		if (recentDecision && recentDecision.decision === 'continue') {
			const shortReasoning = recentDecision.reasoning.split('.')[0]
			return `Iteration ${state.iterationCount}: ${shortReasoning.substring(0, 50)}...`
		}
		
		return `Iteration ${state.iterationCount}: Enhanced implementation for ${state.task.description}`
	}

	private buildPRDescription(state: WorkflowState): string {
		return `Autonomous implementation of task #${state.task.id}

## Task Description
${state.task.description}

## Implementation
This PR was created autonomously using an iterative development workflow:
- Multiple development iterations with LLM-driven improvements
- Automated code review and fix generation
- Comprehensive error handling and testing
- Security scanning and best practices applied

This PR will be automatically merged upon CI success.`
	}

	private buildRecoveryPrompt(state: WorkflowState, error: any): string {
		return `Task #${state.task.id} failed with error: ${error}

Failure count: ${state.task.metadata?.failureCount || 0}
Task description: ${state.task.description}
Branch: ${state.branchName}
Iteration: ${state.iterationCount}

Available recovery actions:
- NUKE_BRANCH: <reason> - Reset branch to clean state
- RESTART_TASK: <reason> - Retry task from beginning  
- BLOCK_TASK: <reason> - Mark task as blocked

Analyze the error and decide the best recovery action. Respond with the tool command and reason.`
	}
}
