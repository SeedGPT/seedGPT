import * as fs from 'fs'

import { readFileSync } from 'fs'
import { join } from 'path'
import Anthropic from '@anthropic-ai/sdk'
import { Octokit } from '@octokit/rest'
import SimpleGitLib, { type SimpleGit } from 'simple-git'

import { BranchRecoveryManager } from './branchRecoveryManager.js'
import { CIManager } from './ciManager.js'
import { ContextManager } from './contextManager.js'
import { DashboardManager } from './dashboardManager.js'
import { EvolutionWorkflow, WorkflowDependencies } from './evolutionWorkflow.js'
import { IntelligentTaskManager } from './intelligentTaskManager.js'
import { LLMClient } from './llmClient.js'
import { LLMTools } from './llmTools.js'
import logger from './logger.js'
import { loadMemory, updateMemory, setWorkspaceManager as setMemoryWorkspaceManager } from './memory.js'
import { appendProgress, setWorkspaceManager as setProgressWorkspaceManager } from './progressLogger.js'
import { ResearchManager } from './researchManager.js'
import { getTaskGenerationPrompt, getPatchGenerationPrompt, getReviewPrompt, getSummarizePrompt } from './systemPrompt.js'
import { loadConfig, loadTasks, saveTasks, setWorkspaceManager } from './taskManager.js'
import { AnthropicMessage, Config, Task } from './types.js'
import { WorkspaceManager } from './workspaceManager.js'
import { parseCodeReview } from './codeReviewer.js'

const requiredEnvVars = ['ANTHROPIC_API_KEY', 'GITHUB_TOKEN', 'GITHUB_REPO_OWNER', 'GITHUB_REPO_NAME', 'BETTERSTACK_LOG_TOKEN', 'NODE_ENV', 'DASHBOARD_PASSWORD_HASH']
for (const envVar of requiredEnvVars) {
	const value = process.env[envVar]
	if (value == null || value === '') {
		logger.error(`Missing required environment variable: ${envVar}`)
		throw new Error(`Missing required environment variable: ${envVar}`)
	}
}

const git: SimpleGit = SimpleGitLib()
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN })

let cfg: Config
let llmClient: LLMClient
let workspaceManager: WorkspaceManager
let ciManager: CIManager
let intelligentTaskManager: IntelligentTaskManager
let researchManager: ResearchManager
let branchRecoveryManager: BranchRecoveryManager
let dashboardManager: DashboardManager
let llmTools: LLMTools
let contextManager: ContextManager
let evolutionWorkflow: EvolutionWorkflow

try {
	cfg = loadConfig('agent-config.yaml')
	llmClient = new LLMClient(anthropic, cfg)
	workspaceManager = new WorkspaceManager(git, cfg)
	setWorkspaceManager(workspaceManager)
	setMemoryWorkspaceManager(workspaceManager)
	setProgressWorkspaceManager(workspaceManager)
	ciManager = new CIManager(octokit, cfg)
	intelligentTaskManager = new IntelligentTaskManager(cfg, workspaceManager)
	researchManager = new ResearchManager(cfg, workspaceManager)
	branchRecoveryManager = new BranchRecoveryManager(workspaceManager)
	dashboardManager = new DashboardManager(intelligentTaskManager, cfg, branchRecoveryManager)
	llmTools = new LLMTools(branchRecoveryManager, workspaceManager)
	contextManager = new ContextManager(workspaceManager, llmClient)
	
	const workflowDeps: WorkflowDependencies = {
		llmClient,
		workspaceManager,
		ciManager,
		llmTools,
		intelligentTaskManager,
		contextManager,
		branchRecoveryManager,
		octokit,
		cfg
	}
	evolutionWorkflow = new EvolutionWorkflow(workflowDeps)
} catch (error) {
	logger.error('Failed to initialize system', { error })
	throw error
}

async function buildContextMessages(taskDescription?: string): Promise<AnthropicMessage[]> {
	const memSum = await loadMemory(cfg.memory)
	
	if (taskDescription) {
		// Use intelligent context selection for task-specific operations
		return await contextManager.buildContextMessages(taskDescription, memSum)
	} else {
		// Fallback to memory-only context for general operations
		return memSum ? [{ role: 'user', content: `Memory Context:\n${memSum}` }] : []
	}
}

async function initializeDirectories(): Promise<void> {
	const dirs = ['logs', 'memory', 'summaries', 'prompts']
	for (const dir of dirs) {
		const workspaceDir = workspaceManager.getWorkspaceFilePath(dir)
		if (!fs.existsSync(workspaceDir)) {
			fs.mkdirSync(workspaceDir, { recursive: true })
		}
	}

	const progressPath = workspaceManager.getWorkspaceFilePath('PROGRESS.md')
	if (!fs.existsSync(progressPath)) {
		fs.writeFileSync(progressPath, '# SeedGPT Evolution Progress\n\nThis file tracks the autonomous evolution of the SeedGPT system.\n\n---\n')
	}
}

async function generateNewTasks(existingTasks: Task[]): Promise<Task[]> {
	try {
		const repoState = await intelligentTaskManager.analyzeRepositoryState()
		const contextMessages = await buildContextMessages()

		const shouldResearch = await researchManager.shouldConductResearch(repoState, existingTasks.slice(-10))
		if (shouldResearch) {
			logger.info('🔬 Conducting research to improve task generation...')
			const researchTopics = await researchManager.generateResearchTopics(repoState, existingTasks.filter(t => t.metadata?.failureCount && t.metadata.failureCount > 0))

			if (researchTopics.length > 0) {
				const researchResults = await researchManager.conductResearch(researchTopics[0])
				logger.info(`📚 Research completed on: ${researchResults.topic}`)
			}
		}

		const intelligentTasks = await intelligentTaskManager.generateIntelligentTasks(existingTasks, repoState)
		if (intelligentTasks.length > 0) {
			logger.info(`🧠 Generated ${intelligentTasks.length} intelligent tasks`)
			return intelligentTasks
		}

		const prompt = getTaskGenerationPrompt()
		const userContent = `${prompt}

Current system state: ${existingTasks.length} tasks (${existingTasks.filter(t => t.status === 'pending').length} pending)

Recent completed tasks:
${existingTasks.filter(t => t.status === 'done').slice(-3).map(t => `#${t.id}: ${t.description}`).join('\n') || 'None'}`

		const messages: AnthropicMessage[] = [...contextMessages, { role: 'user', content: userContent }]
		const fallbackTasks = await llmClient.generateTasks(messages)
		return fallbackTasks.map(task => ({
			...task,
			type: task.type || 'standard',
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			metadata: {
				...task.metadata,
				impact: task.metadata?.impact || 'medium',
				complexity: task.metadata?.complexity || 'moderate'
			}
		}))
	} catch (error) {
		logger.error('Task generation failed', { error })
		return []
	}
}

async function runEvolutionCycle(): Promise<void> {
	try {
		await initializeDirectories()
		await workspaceManager.initializeWorkspace()

		let tasks = loadTasks(cfg.files.tasks)
		logger.info(`Loaded ${tasks.length} tasks, ${tasks.filter(t => t.status === 'pending').length} pending`)

		// Proactive recovery check for stuck tasks
		let recoveryAttempted = false
		for (const task of tasks) {
			if (task.status === 'in-progress' || task.status === 'blocked') {
				const recovered = await branchRecoveryManager.attemptTaskRecovery(task)
				if (recovered) {
					recoveryAttempted = true
					logger.info(`Recovery applied to task #${task.id}`)
				}
			}
		}

		if (recoveryAttempted) {
			saveTasks(cfg.files.tasks, tasks)
		}

		const pending = tasks.filter(t => t.status === 'pending')
		if (pending.length === 0) {
			logger.info('🧠 Generating new tasks...')
			const newTasks = await generateNewTasks(tasks)

			if (newTasks.length > 0) {
				const maxId = Math.max(0, ...tasks.map(t => t.id))
				newTasks.forEach((task, i) => { task.id = maxId + i + 1 })
				tasks = tasks.concat(newTasks)
				saveTasks(cfg.files.tasks, tasks)
				logger.info(`➕ Added ${newTasks.length} new tasks`)
			} else {
				logger.error('⚠️ No new tasks generated. Retrying in 30s...')
				setTimeout(runEvolutionCycle, 30000)
				return
			}
		}		// Use intelligent task selection
		const repoState = await intelligentTaskManager.analyzeRepositoryState()
		const superTasks = await intelligentTaskManager.loadSuperTasks()
		const task = await intelligentTaskManager.intelligentTaskSelection(tasks, superTasks)

		if (!task) {
			logger.info('No suitable task found for execution, waiting...')
			setTimeout(runEvolutionCycle, 60000)
			return
		}
		logger.info(`🛠 Working on Task #${task.id}: ${task.description}`)
		task.status = 'in-progress'
		saveTasks(cfg.files.tasks, tasks)

		const success = await evolutionWorkflow.executeTask(task)
		
		if (success) {
			logger.info(`✅ Task #${task.id} completed successfully`)
			saveTasks(cfg.files.tasks, tasks)
			throw new Error('RESTART_REQUIRED')
		} else {
			logger.warn(`❌ Task #${task.id} failed, will retry later`)
			saveTasks(cfg.files.tasks, tasks)
			setTimeout(runEvolutionCycle, 60000)
		}} catch (error) {
		if (error instanceof Error && error.message === 'RESTART_REQUIRED') {
			logger.info('🔄 System restart required after successful merge. Terminating process...')
			
			if (cfg.dashboard?.enabled) {
				await dashboardManager.stop()
			}
			
			setTimeout(() => {
				logger.info('🛑 Process terminating for restart...')
				process.exit(0)
			}, 2000)
			return
		}

		const isTransientError = error instanceof Error && (
			error.message.includes('529') ||
			error.message.includes('overloaded') ||
			error.message.includes('503') ||
			error.message.includes('502')
		)

		// Check if we need emergency reset
		if (error instanceof Error && error.message.includes('workspace_corrupted')) {
			logger.error('Workspace corruption detected, performing emergency reset')
			try {
				await branchRecoveryManager.performEmergencyReset()
				logger.info('Emergency reset completed, restarting evolution cycle')
				setTimeout(runEvolutionCycle, 10000)
				return
			} catch (resetError) {
				logger.error('Emergency reset failed', { resetError })
			}
		}

		if (isTransientError) {
			logger.warn('Transient API error in evolution cycle, retrying with extended backoff', {
				error: { message: error.message, status: (error as any).status }
			})
			const backoffDelay = Math.min(600000, 60000 * Math.pow(2, Math.random()))
			setTimeout(runEvolutionCycle, backoffDelay)
		} else {
			logger.error('Evolution cycle failed', { error })
			setTimeout(runEvolutionCycle, 30000)
		}
	}
}

function getToolExecutionFollowupPrompt(toolName: string, toolCommand: string, toolReason: string, toolResult: any): string {
	const template = readFileSync(join(process.cwd(), 'prompts', 'tool_execution_followup.template'), 'utf-8')
	
	return template
		.replace(/{{toolName}}/g, toolName)
		.replace(/{{toolCommand}}/g, toolCommand)
		.replace(/{{toolReason}}/g, toolReason)
		.replace(/{{success}}/g, toolResult.success.toString())
		.replace(/{{message}}/g, toolResult.message)
		.replace(/{{#if output}}/g, toolResult.output ? '' : '<!--')
		.replace(/{{\/if}}/g, toolResult.output ? '' : '-->')
		.replace(/{{#if output\.stdout}}/g, toolResult.output?.stdout ? '' : '<!--')
		.replace(/{{output\.stdout}}/g, toolResult.output?.stdout || '')
		.replace(/{{#if output\.stderr}}/g, toolResult.output?.stderr ? '' : '<!--')
		.replace(/{{output\.stderr}}/g, toolResult.output?.stderr || '')
}

// ...existing code...

if (import.meta.url === `file://${process.argv[1]}`) {
	async function main() {
		logger.info('🚀 SeedGPT autonomous evolution starting...')

		// Start dashboard if enabled
		if (cfg.dashboard?.enabled) {
			logger.info('🌐 Starting dashboard interface...')
			await dashboardManager.start()
			logger.info(`📊 Dashboard available at http://localhost:${cfg.dashboard.port}`)
		}

		runEvolutionCycle().catch(logger.error)
	}

	main().catch(logger.error)
}
