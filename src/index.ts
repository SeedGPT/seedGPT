import * as fs from 'fs'

import Anthropic from '@anthropic-ai/sdk'
import { Octokit } from '@octokit/rest'
import SimpleGitLib, { type SimpleGit } from 'simple-git'

import { CIManager } from './ciManager.js'
import { LLMClient } from './llmClient.js'
import logger from './logger.js'
import { loadMemory, updateMemory } from './memory.js'
import { appendProgress } from './progressLogger.js'
import {
	getTaskGenerationPrompt,
	getPatchGenerationPrompt,
	getReviewPrompt,
	getSummarizePrompt
} from './systemPrompt.js'
import { loadConfig, loadTasks, saveTasks } from './taskManager.js'
import { AnthropicMessage, Config, type Task } from './types.js'
import { WorkspaceManager } from './workspaceManager.js'

const requiredEnvVars = ['ANTHROPIC_API_KEY', 'GITHUB_TOKEN', 'GITHUB_REPO_OWNER', 'GITHUB_REPO_NAME', 'BETTERSTACK_LOG_TOKEN', 'NODE_ENV']
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

try {
	cfg = loadConfig('agent-config.yaml')
	llmClient = new LLMClient(anthropic, cfg)
	workspaceManager = new WorkspaceManager(git, cfg)
	ciManager = new CIManager(octokit, cfg)
} catch (error) {
	logger.error('Failed to initialize system', { error })
	throw error
}

async function buildContextMessages (): Promise<AnthropicMessage[]> {
	const memSum = await loadMemory(cfg.memory)
	return memSum ? [{ role: 'user', content: `Memory Context:\n${memSum}` }] : []
}

async function initializeDirectories (): Promise<void> {
	const dirs = ['logs', 'memory', 'summaries', 'prompts']
	for (const dir of dirs) {
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true })
		}
	}

	if (!fs.existsSync('PROGRESS.md')) {
		fs.writeFileSync('PROGRESS.md', '# SeedGPT Evolution Progress\n\nThis file tracks the autonomous evolution of the SeedGPT system.\n\n---\n')
	}
}

async function generateNewTasks (existingTasks: Task[]): Promise<Task[]> {
	try {
		const contextMessages = await buildContextMessages()
		const prompt = getTaskGenerationPrompt()

		const userContent = `${prompt}

Current system state: ${existingTasks.length} tasks (${existingTasks.filter(t => t.status === 'pending').length} pending)

Recent completed tasks:
${existingTasks.filter(t => t.status === 'done').slice(-3).map(t => `#${t.id}: ${t.description}`).join('\n') || 'None'}`

		const messages: AnthropicMessage[] = [...contextMessages, { role: 'user', content: userContent }]
		return await llmClient.generateTasks(messages)
	} catch (error) {
		logger.error('Task generation failed', { error })
		return []
	}
}

async function runEvolutionCycle (): Promise<void> {
	try {
		await initializeDirectories()
		await workspaceManager.initializeWorkspace()

		let tasks = loadTasks(cfg.files.tasks)
		logger.info(`Loaded ${tasks.length} tasks, ${tasks.filter(t => t.status === 'pending').length} pending`)

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
		}

		const task = tasks.find(t => t.status === 'pending')
		if (!task) {
			setTimeout(runEvolutionCycle, 60000)
			return
		}

		logger.info(`🛠 Working on Task #${task.id}: ${task.description}`)
		task.status = 'in-progress'
		saveTasks(cfg.files.tasks, tasks)

		const branchName = await workspaceManager.createFeatureBranch(task.id)

		try {
			const contextMessages = await buildContextMessages()
			const patchPrompt = getPatchGenerationPrompt(task.description)

			logger.info('🔧 Generating initial patch...', { taskId: task.id })
			let patch = await llmClient.generatePatch([
				...contextMessages,
				{ role: 'user', content: patchPrompt }
			])
			logger.debug('Generated patch preview', { 
				taskId: task.id, 
				patchLength: patch.length, 
				patchPreview: patch.substring(0, 500) + (patch.length > 500 ? '...' : '')
			})

			const reviewPrompt = getReviewPrompt(patch)
			logger.info('🔍 Generating code review...', { taskId: task.id })
			const reviewFeedback = await llmClient.generateReview([
				...contextMessages,
				{ role: 'user', content: reviewPrompt }
			])
			logger.debug('Review feedback received', { 
				taskId: task.id, 
				feedbackLength: reviewFeedback.length,
				feedbackPreview: reviewFeedback.substring(0, 300) + (reviewFeedback.length > 300 ? '...' : '')
			})

			if (reviewFeedback.includes('✗') || reviewFeedback.includes('NEEDS_WORK') || reviewFeedback.includes('REJECT')) {
				logger.info('🔍 Review found issues, generating improved patch...', { taskId: task.id })
				patch = await llmClient.generateCodeFix(patch, reviewFeedback, contextMessages)
				logger.debug('Improved patch generated', { 
					taskId: task.id, 
					improvedPatchLength: patch.length, 
					improvedPatchPreview: patch.substring(0, 500) + (patch.length > 500 ? '...' : '')
				})
			} else {
				logger.info('✅ Review passed, proceeding with original patch', { taskId: task.id })
			}

			logger.info('📝 Applying patch to workspace...', { taskId: task.id })
			try {
				await workspaceManager.applyPatch(patch, task.id)
				logger.info('✅ Patch applied successfully', { taskId: task.id })
			} catch (patchError) {
				logger.error('❌ Failed to apply patch', { 
					taskId: task.id, 
					error: patchError,
					patchLength: patch.length,
					patchContent: patch
				})
				throw patchError
			}

			logger.info('📤 Committing and pushing changes...', { taskId: task.id })
			await workspaceManager.commitAndPush(task.id, task.description, branchName)
			logger.info('✅ Changes committed and pushed', { taskId: task.id, branchName })

			const pr = await octokit.pulls.create({
				owner: process.env.GITHUB_REPO_OWNER!,
				repo: process.env.GITHUB_REPO_NAME!,
				head: branchName,
				base: cfg.git.mainBranch,
				title: `🔨 Task #${task.id}: ${task.description}`,
				body: `Autonomous implementation of task #${task.id}

## Task Description
${task.description}

## Implementation
This PR was created autonomously and follows software engineering best practices:
- Clean, maintainable code with proper TypeScript types
- Comprehensive error handling and logging
- Security scanning and vulnerability fixes applied
- Code review process completed before submission

This PR will be automatically merged upon CI success.`
			})

			logger.info(`📬 PR #${pr.data.number} created: ${pr.data.html_url}`)

			const merged = await ciManager.waitForCIAndMerge(pr.data.number)

			if (merged) {
				logger.info(`🎉 PR #${pr.data.number} successfully merged`)

				const summaryPrompt = getSummarizePrompt(pr.data.number.toString(), task.description)
				const summary = await llmClient.generateSummary([
					...contextMessages,
					{ role: 'user', content: summaryPrompt }
				])

				appendProgress(cfg.files.progress, summary, {
					taskId: task.id,
					prNumber: pr.data.number
				})

				await updateMemory(cfg.memory, summary, {
					taskId: task.id,
					prNumber: pr.data.number,
					importance: 'medium'
				})

				task.status = 'done'
				saveTasks(cfg.files.tasks, tasks)

				await workspaceManager.cleanupBranch(branchName)

				logger.info(`✅ Task #${task.id} completed and merged. System will restart automatically...`)

				throw new Error('RESTART_REQUIRED')
			} else {
				logger.error(`❌ PR #${pr.data.number} failed CI or could not be merged`)
				task.status = 'pending'
				saveTasks(cfg.files.tasks, tasks)
				await workspaceManager.cleanupBranch(branchName)
				setTimeout(runEvolutionCycle, 60000)
			}
		} catch (error) {
			logger.error('Task execution failed', { error, taskId: task.id })
			task.status = 'pending'
			saveTasks(cfg.files.tasks, tasks)
			await workspaceManager.cleanupBranch(branchName)
			setTimeout(runEvolutionCycle, 30000)
		}
	} catch (error) {
		logger.error('Evolution cycle failed', { error })
		setTimeout(runEvolutionCycle, 30000)
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	logger.info('🚀 SeedGPT autonomous evolution starting...')
	runEvolutionCycle().catch(logger.error)
}
