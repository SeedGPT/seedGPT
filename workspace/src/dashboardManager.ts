import express, { Request, Response, NextFunction } from 'express'
import bcrypt from 'bcrypt'

import logger from './logger.js'
import { IntelligentTaskManager } from './intelligentTaskManager.js'
import { BranchRecoveryManager } from './branchRecoveryManager.js'
import { Config, Task, TaskSuggestion } from './types.js'

export class DashboardManager {
	private app: express.Application
	private taskManager: IntelligentTaskManager
	private branchRecovery?: BranchRecoveryManager
	private cfg: Config
	private server: any

	constructor(taskManager: IntelligentTaskManager, cfg: Config, branchRecovery?: BranchRecoveryManager) {
		this.taskManager = taskManager
		this.branchRecovery = branchRecovery
		this.cfg = cfg
		this.app = express()
		this.setupMiddleware()
		this.setupRoutes()
	}

	async start(): Promise<void> {
		if (!this.cfg.dashboard?.enabled) {
			logger.info('Dashboard disabled in configuration')
			return
		}

		const port = this.cfg.dashboard.port || 3000
		
		this.server = this.app.listen(port, () => {
			logger.info(`Dashboard started on port ${port}`)
		})
	}

	async stop(): Promise<void> {
		if (this.server) {
			this.server.close()
			logger.info('Dashboard stopped')
		}
	}
	private setupMiddleware(): void {
		this.app.use(express.json())
		this.app.use(express.static('public'))
		
		this.app.use((req: Request, res: Response, next: NextFunction) => {
			const authHeader = req.headers.authorization
			
			if (req.path === '/health') {
				next()
				return
			}

			if (!authHeader || !authHeader.startsWith('Bearer ')) {
				res.status(401).json({ error: 'Authentication required' })
				return
			}			const token = authHeader.substring(7)
			const expectedHash = process.env.DASHBOARD_PASSWORD_HASH
			
			if (!expectedHash || !bcrypt.compareSync(token, expectedHash)) {
				res.status(401).json({ error: 'Invalid authentication' })
				return
			}

			next()
		})
	}
	private setupRoutes(): void {
		this.app.get('/health', (req: Request, res: Response) => {
			res.json({ status: 'healthy', timestamp: new Date().toISOString() })
		})

		this.app.get('/api/tasks', async (req: Request, res: Response) => {
			try {
				const tasks = await this.taskManager.loadTasks()
				const superTasks = await this.taskManager.loadSuperTasks()
				const repoState = await this.taskManager.getRepositoryState()

				res.json({
					tasks,
					superTasks,
					repositoryState: repoState,
					stats: this.calculateStats(tasks)
				})
			} catch (error) {
				logger.error('Failed to load tasks for dashboard', { error })
				res.status(500).json({ error: 'Failed to load tasks' })
			}
		})

		this.app.post('/api/tasks', async (req: Request, res: Response) => {
			try {
				const { description, priority, type, estimatedEffort } = req.body

				if (!description || description.length < 10) {
					res.status(400).json({ error: 'Description must be at least 10 characters' })
					return
				}

				const tasks = await this.taskManager.loadTasks()
				const maxId = Math.max(0, ...tasks.map(t => t.id))

				const newTask: Task = {
					id: maxId + 1,
					description,
					priority: priority || 'medium',
					status: 'pending',
					type: type || 'feature',
					estimatedEffort: estimatedEffort || 'medium',
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
					metadata: {
						impact: 'medium',
						complexity: 'moderate',
						failureCount: 0
					}
				}

				tasks.push(newTask)
				await this.taskManager.saveTasks(tasks)

				logger.info('Task created via dashboard', { taskId: newTask.id, description })
				res.json(newTask)
			} catch (error) {
				logger.error('Failed to create task via dashboard', { error })
				res.status(500).json({ error: 'Failed to create task' })
			}
		})
		this.app.put('/api/tasks/:id', async (req: Request, res: Response) => {
			try {
				const taskId = parseInt(req.params.id)
				const updates = req.body

				const tasks = await this.taskManager.loadTasks()
				const task = tasks.find(t => t.id === taskId)

				if (!task) {
					res.status(404).json({ error: 'Task not found' })
					return
				}

				Object.assign(task, updates, { updatedAt: new Date().toISOString() })
				await this.taskManager.saveTasks(tasks)

				logger.info('Task updated via dashboard', { taskId, updates: Object.keys(updates) })
				res.json(task)
			} catch (error) {
				logger.error('Failed to update task via dashboard', { error })
				res.status(500).json({ error: 'Failed to update task' })
			}
		})

		this.app.delete('/api/tasks/:id', async (req: Request, res: Response) => {
			try {
				const taskId = parseInt(req.params.id)
				const tasks = await this.taskManager.loadTasks()
				
				const filteredTasks = tasks.filter(t => t.id !== taskId)
				
				if (filteredTasks.length === tasks.length) {
					res.status(404).json({ error: 'Task not found' })
					return
				}

				await this.taskManager.saveTasks(filteredTasks)

				logger.info('Task deleted via dashboard', { taskId })
				res.json({ success: true })
			} catch (error) {
				logger.error('Failed to delete task via dashboard', { error })
				res.status(500).json({ error: 'Failed to delete task' })
			}
		})

		this.app.get('/api/suggestions', async (req: Request, res: Response) => {
			try {
				const repoState = await this.taskManager.getRepositoryState()
				const tasks = await this.taskManager.loadTasks()
				const suggestions = await this.taskManager.generateTaskSuggestions(repoState, tasks)

				res.json(suggestions)
			} catch (error) {
				logger.error('Failed to generate suggestions', { error })
				res.status(500).json({ error: 'Failed to generate suggestions' })
			}
		})

		this.app.post('/api/suggestions/:index/accept', async (req: Request, res: Response) => {
			try {
				const suggestionIndex = parseInt(req.params.index)
				const repoState = await this.taskManager.getRepositoryState()
				const tasks = await this.taskManager.loadTasks()
				const suggestions = await this.taskManager.generateTaskSuggestions(repoState, tasks)

				if (suggestionIndex < 0 || suggestionIndex >= suggestions.length) {
					res.status(404).json({ error: 'Suggestion not found' })
					return
				}

				const suggestion = suggestions[suggestionIndex]
				const maxId = Math.max(0, ...tasks.map(t => t.id))

				const newTask: Task = {
					id: maxId + 1,
					description: suggestion.description,
					priority: suggestion.priority,
					status: 'pending',
					type: suggestion.type,
					estimatedEffort: suggestion.estimatedEffort,
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
					metadata: {
						impact: suggestion.impact,
						complexity: 'moderate',
						failureCount: 0,
						context: [`Suggestion: ${suggestion.rationale}`]
					}
				}

				tasks.push(newTask)
				await this.taskManager.saveTasks(tasks)

				logger.info('Suggestion accepted via dashboard', { taskId: newTask.id, suggestion: suggestion.description })
				res.json(newTask)
			} catch (error) {
				logger.error('Failed to accept suggestion', { error })
				res.status(500).json({ error: 'Failed to accept suggestion' })
			}
		})
		this.app.get('/api/system-status', async (req: Request, res: Response) => {
			try {
				const tasks = await this.taskManager.loadTasks()
				const superTasks = await this.taskManager.loadSuperTasks()
				const repoState = await this.taskManager.getRepositoryState()

				const status = {
					systemHealth: this.calculateSystemHealth(tasks, repoState),
					taskProgress: this.calculateTaskProgress(tasks),
					superTaskProgress: this.calculateSuperTaskProgress(superTasks),
					repositoryState: repoState,
					lastActivity: this.getLastActivity(tasks),
					recommendations: await this.getSystemRecommendations(tasks, repoState)
				}

				res.json(status)
			} catch (error) {
				logger.error('Failed to get system status', { error })
				res.status(500).json({ error: 'Failed to get system status' })
			}
		})

		this.app.get('/api/recovery-history', async (req: Request, res: Response) => {
			try {
				if (!this.branchRecovery) {
					res.status(404).json({ error: 'Branch recovery not available' })
					return
				}

				const limit = parseInt(req.query.limit as string) || 20
				const history = await this.branchRecovery.getRecoveryHistory(limit)

				const processedHistory = history.map(entry => {
					const [timestamp, action] = entry.split(' - ', 2)
					return {
						timestamp,
						action: action || 'Unknown action',
						formatted: new Date(timestamp).toLocaleString()
					}
				})

				res.json({
					entries: processedHistory,
					total: processedHistory.length
				})
			} catch (error) {
				logger.error('Failed to get recovery history', { error })
				res.status(500).json({ error: 'Failed to get recovery history' })
			}
		})

		this.app.get('/api/context-analysis/:taskId', async (req: Request, res: Response) => {
			try {
				const taskId = parseInt(req.params.taskId)
				const tasks = await this.taskManager.loadTasks()
				const task = tasks.find(t => t.id === taskId)

				if (!task) {
					res.status(404).json({ error: 'Task not found' })
					return
				}

				// Simulate context analysis for demonstration
				const contextAnalysis = {
					taskId: task.id,
					description: task.description,
					estimatedScope: task.estimatedEffort || 'medium',
					extractedKeywords: this.extractKeywordsFromDescription(task.description),
					potentialFiles: this.suggestRelevantFiles(task.description),
					complexity: task.metadata?.complexity || 'moderate',
					recommendations: this.getTaskRecommendations(task)
				}

				res.json(contextAnalysis)
			} catch (error) {
				logger.error('Failed to analyze task context', { error })
				res.status(500).json({ error: 'Failed to analyze task context' })
			}
		})
	}

	private calculateStats(tasks: Task[]) {
		return {
			total: tasks.length,
			pending: tasks.filter(t => t.status === 'pending').length,
			inProgress: tasks.filter(t => t.status === 'in-progress').length,
			completed: tasks.filter(t => t.status === 'done').length,
			blocked: tasks.filter(t => t.status === 'blocked').length,
			byType: {
				feature: tasks.filter(t => t.type === 'feature').length,
				refactor: tasks.filter(t => t.type === 'refactor').length,
				fix: tasks.filter(t => t.type === 'fix').length,
				research: tasks.filter(t => t.type === 'research').length,
				tool: tasks.filter(t => t.type === 'tool').length
			},
			byPriority: {
				critical: tasks.filter(t => t.priority === 'critical').length,
				high: tasks.filter(t => t.priority === 'high').length,
				medium: tasks.filter(t => t.priority === 'medium').length,
				low: tasks.filter(t => t.priority === 'low').length
			}
		}
	}

	private calculateSystemHealth(tasks: Task[], repoState: any): string {
		const blockedTasks = tasks.filter(t => t.status === 'blocked').length
		const failedTasks = tasks.filter(t => (t.metadata?.failureCount || 0) > 2).length
		
		if (blockedTasks > 3 || failedTasks > 2) return 'poor'
		if (repoState.technicalDebt > 8) return 'degraded'
		if (blockedTasks > 1 || failedTasks > 0) return 'good'
		
		return 'excellent'
	}

	private calculateTaskProgress(tasks: Task[]) {
		const completed = tasks.filter(t => t.status === 'done').length
		const total = tasks.length
		return total > 0 ? Math.round((completed / total) * 100) : 0
	}

	private calculateSuperTaskProgress(superTasks: any[]) {
		return superTasks.map(st => ({
			id: st.id,
			title: st.title,
			progress: st.metrics?.progressPercentage || 0,
			status: st.status
		}))
	}

	private getLastActivity(tasks: Task[]): string {
		const lastUpdated = tasks
			.map(t => new Date(t.updatedAt))
			.sort((a, b) => b.getTime() - a.getTime())[0]
		
		return lastUpdated ? lastUpdated.toISOString() : new Date().toISOString()
	}

	private async getSystemRecommendations(tasks: Task[], repoState: any): Promise<string[]> {
		const recommendations: string[] = []

		const blockedTasks = tasks.filter(t => t.status === 'blocked').length
		if (blockedTasks > 2) {
			recommendations.push('High number of blocked tasks - review dependencies')
		}

		if (repoState.testCoverage < 70) {
			recommendations.push('Test coverage below recommended threshold')
		}

		if (repoState.technicalDebt > 6) {
			recommendations.push('Technical debt requires attention')
		}

		const oldTasks = tasks.filter(t => {
			const daysSinceUpdate = (Date.now() - new Date(t.updatedAt).getTime()) / (1000 * 60 * 60 * 24)
			return daysSinceUpdate > 7 && t.status === 'pending'
		}).length

		if (oldTasks > 3) {
			recommendations.push('Review and update stale tasks')
		}

		return recommendations
	}

	private extractKeywordsFromDescription(description: string): string[] {
		const commonWords = ['the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'up', 'about', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'among', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can', 'shall']
		
		const words = description.toLowerCase()
			.replace(/[^\w\s]/g, ' ')
			.split(/\s+/)
			.filter(word => word.length > 2 && !commonWords.includes(word))
		
		const uniqueWords = [...new Set(words)]
		return uniqueWords.slice(0, 10)
	}

	private suggestRelevantFiles(description: string): string[] {
		const keywords = this.extractKeywordsFromDescription(description)
		const suggestions: string[] = []

		// File type suggestions based on keywords
		if (keywords.some(k => ['test', 'testing', 'spec', 'unit'].includes(k))) {
			suggestions.push('tests/', '*.test.ts', '*.spec.ts')
		}

		if (keywords.some(k => ['ui', 'interface', 'dashboard', 'frontend'].includes(k))) {
			suggestions.push('src/dashboardManager.ts', 'public/', '*.html', '*.css')
		}

		if (keywords.some(k => ['api', 'endpoint', 'route', 'server'].includes(k))) {
			suggestions.push('src/dashboardManager.ts', 'src/index.ts')
		}

		if (keywords.some(k => ['task', 'management', 'workflow'].includes(k))) {
			suggestions.push('src/taskManager.ts', 'src/intelligentTaskManager.ts', 'tasks.yaml')
		}

		if (keywords.some(k => ['git', 'branch', 'commit', 'repository'].includes(k))) {
			suggestions.push('src/workspaceManager.ts', 'src/branchRecoveryManager.ts')
		}

		if (keywords.some(k => ['llm', 'ai', 'anthropic', 'prompt'].includes(k))) {
			suggestions.push('src/llmClient.ts', 'src/systemPrompt.ts', 'prompts/')
		}

		if (keywords.some(k => ['config', 'configuration', 'settings'].includes(k))) {
			suggestions.push('agent-config.yaml', 'src/types.ts')
		}

		if (keywords.some(k => ['memory', 'context', 'knowledge'].includes(k))) {
			suggestions.push('src/memory.ts', 'src/contextManager.ts')
		}

		if (keywords.some(k => ['recovery', 'error', 'failure', 'fix'].includes(k))) {
			suggestions.push('src/branchRecoveryManager.ts', 'src/codeReviewer.ts')
		}

		if (keywords.some(k => ['research', 'analysis', 'investigation'].includes(k))) {
			suggestions.push('src/researchManager.ts')
		}

		// Default suggestions if no specific patterns match
		if (suggestions.length === 0) {
			suggestions.push('src/index.ts', 'README.md', 'PROGRESS.md')
		}

		return [...new Set(suggestions)].slice(0, 8)
	}

	private getTaskRecommendations(task: Task): string[] {
		const recommendations: string[] = []

		// Priority-based recommendations
		if (task.priority === 'critical') {
			recommendations.push('Consider breaking into smaller subtasks')
			recommendations.push('Assign dedicated resources')
		}

		// Status-based recommendations
		if (task.status === 'blocked') {
			recommendations.push('Identify and resolve blocking dependencies')
			recommendations.push('Consider alternative approaches')
		}

		if (task.status === 'pending' && task.estimatedEffort === 'large') {
			recommendations.push('Create detailed implementation plan')
			recommendations.push('Identify potential risks and mitigation strategies')
		}

		// Failure count recommendations
		const failureCount = task.metadata?.failureCount || 0
		if (failureCount > 0) {
			recommendations.push('Review previous failure reasons')
			if (failureCount > 2) {
				recommendations.push('Consider converting to research task')
			}
		}

		// Type-based recommendations
		if (task.type === 'refactor') {
			recommendations.push('Ensure comprehensive test coverage')
			recommendations.push('Document breaking changes')
		}

		if (task.type === 'feature') {
			recommendations.push('Define acceptance criteria')
			recommendations.push('Consider user experience impact')
		}

		// Default recommendations
		if (recommendations.length === 0) {
			recommendations.push('Review task requirements and scope')
			recommendations.push('Ensure proper documentation')
		}

		return recommendations.slice(0, 5)
	}
}
