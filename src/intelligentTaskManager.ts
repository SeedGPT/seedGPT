import fs from 'fs'
import path from 'path'

import yaml from 'js-yaml'

import logger from './logger.js'
import { loadMemory } from './memory.js'
import { Config, Task, SuperTask, RepositoryState, TaskSuggestion, ResearchTask } from './types.js'
import { WorkspaceManager } from './workspaceManager.js'

export class IntelligentTaskManager {
	private cfg: Config
	private tasksPath: string
	private superTasksPath: string
	private repositoryStatePath: string
	private workspaceManager?: WorkspaceManager

	constructor(cfg: Config, workspaceManager?: WorkspaceManager) {
		this.cfg = cfg
		this.workspaceManager = workspaceManager
		this.tasksPath = cfg.files.tasks
		this.superTasksPath = './super-tasks.yaml'
		this.repositoryStatePath = './repository-state.yaml'
	}

	private getFilePath(relativePath: string): string {
		if (this.workspaceManager) {
			return this.workspaceManager.getWorkspaceFilePath(relativePath)
		}
		return relativePath
	}
	async loadTasks(): Promise<Task[]> {
		try {
			const filePath = this.getFilePath(this.tasksPath)
			if (!fs.existsSync(filePath)) {
				return []
			}
			const tasks = yaml.load(fs.readFileSync(filePath, 'utf-8')) as Task[]
			return this.migrateTasksToNewFormat(tasks || [])
		} catch (error) {
			logger.error('Failed to load tasks', { error })
			return []
		}
	}

	async saveTasks(tasks: Task[]): Promise<void> {
		try {
			const filePath = this.getFilePath(this.tasksPath)
			fs.writeFileSync(filePath, yaml.dump(tasks, { 
				indent: 2,
				lineWidth: 120,
				noRefs: true
			}))
		} catch (error) {
			logger.error('Failed to save tasks', { error })
		}
	}
	async loadSuperTasks(): Promise<SuperTask[]> {
		try {
			const filePath = this.getFilePath(this.superTasksPath)
			if (!fs.existsSync(filePath)) {
				return this.createDefaultSuperTasks()
			}
			return yaml.load(fs.readFileSync(filePath, 'utf-8')) as SuperTask[] || []
		} catch (error) {
			logger.error('Failed to load super tasks', { error })
			return this.createDefaultSuperTasks()
		}
	}

	async saveSuperTasks(superTasks: SuperTask[]): Promise<void> {
		try {
			const filePath = this.getFilePath(this.superTasksPath)
			fs.writeFileSync(filePath, yaml.dump(superTasks, {
				indent: 2,
				lineWidth: 120,
				noRefs: true
			}))
		} catch (error) {
			logger.error('Failed to save super tasks', { error })
		}
	}
	async getRepositoryState(): Promise<RepositoryState> {
		try {
			const filePath = this.getFilePath(this.repositoryStatePath)
			if (!fs.existsSync(filePath)) {
				return this.analyzeRepositoryState()
			}
			const state = yaml.load(fs.readFileSync(filePath, 'utf-8')) as RepositoryState
			const daysSinceAnalysis = (Date.now() - new Date(state.lastAnalysis).getTime()) / (1000 * 60 * 60 * 24)
			
			if (daysSinceAnalysis > 1) {
				return this.analyzeRepositoryState()
			}
			
			return state
		} catch (error) {
			logger.error('Failed to get repository state', { error })
			return this.analyzeRepositoryState()
		}
	}

	async intelligentTaskSelection(tasks: Task[], superTasks: SuperTask[]): Promise<Task | null> {
		const pendingTasks = tasks.filter(t => t.status === 'pending')
		if (pendingTasks.length === 0) return null

		const repoState = await this.getRepositoryState()
		const taskScores = await this.scoreTasksByContext(pendingTasks, repoState, superTasks)

		const blockedTasks = pendingTasks.filter(t => this.isTaskBlocked(t, tasks))
		const unBlockedTasks = taskScores.filter(score => !blockedTasks.some(bt => bt.id === score.task.id))

		if (unBlockedTasks.length === 0) {
			await this.handleBlockedSituation(blockedTasks, tasks, superTasks)
			return null
		}

		const sortedTasks = unBlockedTasks.sort((a, b) => b.score - a.score)
		const selectedTask = sortedTasks[0].task

		logger.info('Intelligently selected task', {
			taskId: selectedTask.id,
			score: sortedTasks[0].score,
			rationale: sortedTasks[0].rationale,
			totalCandidates: pendingTasks.length,
			blockedTasks: blockedTasks.length
		})

		return selectedTask
	}

	async shouldGenerateNewTasks(tasks: Task[], superTasks: SuperTask[]): Promise<boolean> {
		const pendingTasks = tasks.filter(t => t.status === 'pending')
		const toolTasks = pendingTasks.filter(t => t.type === 'tool')
		const repoState = await this.getRepositoryState()

		if (pendingTasks.length === 0) return true
		if (toolTasks.length === 0 && repoState.missingTools.length > 0) return true
		if (this.needsRefactoring(repoState) && !pendingTasks.some(t => t.type === 'refactor')) return true
		if (pendingTasks.length < 3) return true

		return false
	}

	async createSubtasksForTask(task: Task, tasks: Task[]): Promise<Task[]> {
		if (task.metadata?.complexity === 'expert' || task.estimatedEffort === 'epic') {
			const subtasks = await this.decomposeComplexTask(task)
			
			task.type = 'super'
			task.children = subtasks.map(st => st.id)
			task.status = 'in-progress'
			
			return subtasks
		}
		
		return []
	}

	async shouldNukeBranch(task: Task): Promise<boolean> {
		const failureCount = task.metadata?.failureCount || 0
		const lastAttempt = task.metadata?.lastAttempt
		
		if (failureCount >= 3) {
			logger.warn('Task has failed multiple times, considering branch nuke', {
				taskId: task.id,
				failureCount
			})
			return true
		}

		if (lastAttempt) {
			const hoursSinceAttempt = (Date.now() - new Date(lastAttempt).getTime()) / (1000 * 60 * 60)
			if (hoursSinceAttempt > 24 && task.status === 'in-progress') {
				logger.warn('Task stuck for over 24 hours, considering branch nuke', {
					taskId: task.id,
					hoursSinceAttempt
				})
				return true
			}
		}

		return false
	}

	async markTaskAsComplete(taskId: number, tasks: Task[], superTasks: SuperTask[]): Promise<void> {
		const task = tasks.find(t => t.id === taskId)
		if (!task) return

		task.status = 'done'
		task.completedAt = new Date().toISOString()
		task.updatedAt = new Date().toISOString()

		if (task.parentId) {
			await this.checkParentCompletion(task.parentId, tasks, superTasks)
		}

		await this.updateSuperTaskProgress(task, superTasks)
		await this.saveTasks(tasks)
		await this.saveSuperTasks(superTasks)
	}

	async generateTaskSuggestions(repoState: RepositoryState, existingTasks: Task[]): Promise<TaskSuggestion[]> {
		const suggestions: TaskSuggestion[] = []

		if (repoState.testCoverage < 80) {
			suggestions.push({
				description: 'Improve test coverage to reach 80%+ threshold',
				rationale: `Current coverage is ${repoState.testCoverage}%, below target`,
				priority: 'high',
				type: 'feature',
				estimatedEffort: 'medium',
				dependencies: [],
				impact: 'high',
				urgency: 8,
				prerequisites: ['testing framework']
			})
		}

		if (repoState.technicalDebt > 5) {
			suggestions.push({
				description: 'Refactor codebase to reduce technical debt',
				rationale: `Technical debt score is ${repoState.technicalDebt}, needs reduction`,
				priority: 'medium',
				type: 'refactor',
				estimatedEffort: 'large',
				dependencies: [],
				impact: 'medium',
				urgency: 6,
				prerequisites: []
			})
		}

		for (const missingTool of repoState.missingTools) {
			suggestions.push({
				description: `Implement ${missingTool} capability`,
				rationale: `Missing tool that would accelerate development`,
				priority: 'high',
				type: 'tool',
				estimatedEffort: 'medium',
				dependencies: [],
				impact: 'high',
				urgency: 9,
				prerequisites: []
			})
		}

		return suggestions.sort((a, b) => b.urgency - a.urgency)
	}

	private migrateTasksToNewFormat(tasks: Task[]): Task[] {
		return tasks.map(task => ({
			...task,
			type: task.type || 'feature',
			createdAt: task.createdAt || new Date().toISOString(),
			updatedAt: task.updatedAt || new Date().toISOString(),
			metadata: {
				...task.metadata,
				failureCount: task.metadata?.failureCount || 0,
				impact: task.metadata?.impact || 'medium',
				complexity: task.metadata?.complexity || 'moderate'
			}
		}))
	}

	private createDefaultSuperTasks(): SuperTask[] {
		return [
			{
				id: 1,
				title: 'Self-Evolving AI Development Platform',
				description: 'Build a comprehensive autonomous development platform',
				longTermVision: 'Create an AI system capable of complete autonomous software development lifecycle management',
				priority: 'critical',
				status: 'active',
				subtasks: [],
				milestones: [
					{
						id: 1,
						name: 'Basic Automation',
						description: 'Core task execution and git workflow',
						criteria: ['Can execute tasks', 'Can create PRs', 'Can merge code'],
						completed: true,
						completedAt: new Date().toISOString(),
						dependentTasks: []
					},
					{
						id: 2,
						name: 'Intelligent Task Management',
						description: 'Smart task selection and hierarchy',
						criteria: ['Hierarchical tasks', 'Intelligent selection', 'Dependency management'],
						completed: false,
						dependentTasks: []
					}
				],
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				completionCriteria: [
					'Full autonomous development capability',
					'Self-improvement and evolution',
					'Advanced research capabilities'
				]
			}
		]
	}

	async analyzeRepositoryState(): Promise<RepositoryState> {
		const srcPath = './src'
		let codebaseSize = 0
		let testCoverage = 60
		let technicalDebt = 3

		try {
			if (fs.existsSync(srcPath)) {
				const files = this.getFilesRecursively(srcPath)
				codebaseSize = files.length
			}
		} catch (error) {
			logger.warn('Failed to analyze codebase size', { error })
		}

		const state: RepositoryState = {
			codebaseSize,
			testCoverage,
			technicalDebt,
			lastAnalysis: new Date().toISOString(),
			capabilities: [
				'task management',
				'git automation',
				'ai code generation',
				'code review',
				'ci/cd integration'
			],
			missingTools: [
				'advanced testing framework',
				'performance monitoring',
				'security scanning',
				'dependency management',
				'documentation generator'
			],
			architecturalConcerns: [
				'monolithic structure',
				'limited error recovery',
				'basic memory management'
			],
			opportunityAreas: [
				'microservices architecture',
				'advanced ai techniques',
				'real-time monitoring',
				'distributed execution'
			]
		}
		try {
			const filePath = this.getFilePath(this.repositoryStatePath)
			fs.writeFileSync(filePath, yaml.dump(state, { indent: 2 }))
		} catch (error) {
			logger.warn('Failed to save repository state', { error })
		}

		return state
	}

	private getFilesRecursively(dir: string): string[] {
		let files: string[] = []
		try {
			const items = fs.readdirSync(dir)
			for (const item of items) {
				const fullPath = path.join(dir, item)
				const stat = fs.statSync(fullPath)
				if (stat.isDirectory()) {
					files = files.concat(this.getFilesRecursively(fullPath))
				} else if (item.endsWith('.ts') || item.endsWith('.js')) {
					files.push(fullPath)
				}
			}
		} catch (error) {
			// Ignore errors reading directories
		}
		return files
	}

	private async scoreTasksByContext(tasks: Task[], repoState: RepositoryState, superTasks: SuperTask[]): Promise<Array<{ task: Task; score: number; rationale: string }>> {
		return tasks.map(task => {
			let score = 0
			let rationale = ''

			switch (task.priority) {
				case 'critical': score += 100; break
				case 'high': score += 75; break
				case 'medium': score += 50; break
				case 'low': score += 25; break
			}

			if (task.type === 'tool' && repoState.missingTools.length > 0) {
				score += 30
				rationale += 'Tool development prioritized for capability expansion. '
			}

			if (task.type === 'refactor' && repoState.technicalDebt > 5) {
				score += 25
				rationale += 'Refactoring needed due to technical debt. '
			}

			if (task.estimatedEffort === 'small') {
				score += 20
				rationale += 'Quick win opportunity. '
			}

			if (task.metadata?.impact === 'high' || task.metadata?.impact === 'critical') {
				score += 15
				rationale += 'High impact task. '
			}

			const failureCount = task.metadata?.failureCount || 0
			score -= failureCount * 10
			if (failureCount > 0) {
				rationale += `Previous failures reduce priority. `
			}

			return { task, score, rationale: rationale.trim() }
		})
	}

	private isTaskBlocked(task: Task, allTasks: Task[]): boolean {
		if (!task.dependencies) return false
		
		return task.dependencies.some(depId => {
			const dependency = allTasks.find(t => t.id === depId)
			return !dependency || dependency.status !== 'done'
		})
	}

	private async handleBlockedSituation(blockedTasks: Task[], allTasks: Task[], superTasks: SuperTask[]): Promise<void> {
		logger.warn('All tasks are blocked, analyzing situation', {
			blockedCount: blockedTasks.length
		})

		for (const task of blockedTasks) {
			if (task.metadata?.failureCount && task.metadata.failureCount >= 2) {
				logger.info('Converting failed task to research task', { taskId: task.id })
				task.type = 'research'
				task.metadata.blockedReason = 'Multiple failures - needs research'
			}
		}

		await this.saveTasks(allTasks)
	}

	private needsRefactoring(repoState: RepositoryState): boolean {
		return repoState.technicalDebt > 5 || 
			   repoState.architecturalConcerns.length > 3 ||
			   repoState.codebaseSize > 20
	}

	private async decomposeComplexTask(task: Task): Promise<Task[]> {
		const subtasks: Task[] = []
		const baseId = task.id * 1000

		if (task.description.toLowerCase().includes('testing framework')) {
			subtasks.push(
				{
					id: baseId + 1,
					description: 'Set up unit testing infrastructure',
					priority: 'high',
					status: 'pending',
					type: 'subtask',
					parentId: task.id,
					estimatedEffort: 'small',
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
					metadata: { complexity: 'moderate', impact: 'high' }
				},
				{
					id: baseId + 2,
					description: 'Implement integration testing framework',
					priority: 'medium',
					status: 'pending',
					type: 'subtask',
					parentId: task.id,
					estimatedEffort: 'medium',
					dependencies: [baseId + 1],
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
					metadata: { complexity: 'moderate', impact: 'medium' }
				}
			)
		}

		return subtasks
	}

	private async checkParentCompletion(parentId: number, tasks: Task[], superTasks: SuperTask[]): Promise<void> {
		const parent = tasks.find(t => t.id === parentId)
		if (!parent || !parent.children) return

		const allChildrenComplete = parent.children.every(childId => {
			const child = tasks.find(t => t.id === childId)
			return child?.status === 'done'
		})

		if (allChildrenComplete) {
			parent.status = 'done'
			parent.completedAt = new Date().toISOString()
			parent.updatedAt = new Date().toISOString()
			
			logger.info('Parent task completed', { parentId })
		}
	}

	private async updateSuperTaskProgress(task: Task, superTasks: SuperTask[]): Promise<void> {
		for (const superTask of superTasks) {
			if (superTask.subtasks.includes(task.id)) {
				const totalTasks = superTask.subtasks.length
				const completedTasks = superTask.subtasks.filter(id => 
					task.id === id || (task.id !== id && task.status === 'done')
				).length

				superTask.metrics = {
					progressPercentage: Math.round((completedTasks / totalTasks) * 100),
					completedTasks,
					totalTasks,
					blockedTasks: 0
				}

				superTask.updatedAt = new Date().toISOString()

				if (completedTasks === totalTasks) {
					superTask.status = 'completed'
				}
			}
		}
	}
	async generateIntelligentTasks(existingTasks: Task[], repoState: RepositoryState): Promise<Task[]> {
		try {
			const superTasks = await this.loadSuperTasks()
			const shouldGenerate = await this.shouldGenerateNewTasks(existingTasks, superTasks)
			
			if (!shouldGenerate) {
				logger.info('No new tasks needed based on current state')
				return []
			}

			const suggestions = await this.generateTaskSuggestions(repoState, existingTasks)
			const newTasks: Task[] = []
			
			let maxId = Math.max(0, ...existingTasks.map(t => t.id))
			
			for (const suggestion of suggestions.slice(0, 3)) {
				maxId++
				const task: Task = {
					id: maxId,
					description: suggestion.description,
					priority: suggestion.priority,
					status: 'pending',
					type: suggestion.type,
					estimatedEffort: suggestion.estimatedEffort,
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
					dependencies: this.convertDependenciesToIds(suggestion.dependencies, existingTasks),
					metadata: {
						impact: suggestion.impact,
						complexity: suggestion.estimatedEffort === 'large' ? 'expert' : 
								   suggestion.estimatedEffort === 'medium' ? 'moderate' : 'simple',
						failureCount: 0,
						generationSource: 'intelligent',
						context: [suggestion.rationale]
					}
				}
				
				newTasks.push(task)
			}

			const memory = await loadMemory(this.cfg.memory)
			if (memory && newTasks.length < 2) {
				const memoryInsight = this.extractInsightFromMemory(memory)
				if (memoryInsight) {
					maxId++
					newTasks.push({
						id: maxId,
						description: memoryInsight,
						priority: 'medium',
						status: 'pending',
						type: 'feature',
						estimatedEffort: 'medium',
						createdAt: new Date().toISOString(),
						updatedAt: new Date().toISOString(),
						metadata: {
							impact: 'medium',
							complexity: 'moderate',
							failureCount: 0,
							generationSource: 'memory-insight'
						}
					})
				}
			}

			logger.info(`Generated ${newTasks.length} intelligent tasks`, {
				taskTypes: newTasks.map(t => t.type),
				priorities: newTasks.map(t => t.priority)
			})

			return newTasks
		} catch (error) {
			logger.error('Failed to generate intelligent tasks', { error })
			return []
		}	}

	private convertDependenciesToIds(dependencies: string[], existingTasks: Task[]): number[] {
		const dependencyIds: number[] = []
		
		for (const dep of dependencies) {
			const matchingTask = existingTasks.find(task => 
				task.description.toLowerCase().includes(dep.toLowerCase()) ||
				task.tags?.some(tag => tag.toLowerCase().includes(dep.toLowerCase()))
			)
			
			if (matchingTask) {
				dependencyIds.push(matchingTask.id)
			}
		}
		
		return dependencyIds
	}
	private extractInsightFromMemory(memory: string): string | null {
		if (!memory || memory.length < 50) return null

		const memoryLower = memory.toLowerCase()
		const failurePatterns = [
			'failed', 'error', 'exception', 'timeout', 'crash', 'bug',
			'issue', 'problem', 'fix', 'broken', 'unstable'
		]
		
		const successPatterns = [
			'completed', 'success', 'merged', 'implemented', 'added',
			'improved', 'optimized', 'enhanced', 'fixed'
		]

		const failureCount = failurePatterns.reduce((count, pattern) => 
			count + (memoryLower.match(new RegExp(pattern, 'g')) || []).length, 0)
		
		const successCount = successPatterns.reduce((count, pattern) => 
			count + (memoryLower.match(new RegExp(pattern, 'g')) || []).length, 0)

		if (memoryLower.includes('test') && memoryLower.includes('coverage')) {
			return 'Expand test coverage based on recent development patterns'
		}

		if (memoryLower.includes('security') || memoryLower.includes('vulnerability')) {
			return 'Implement security enhancements based on identified concerns'
		}

		if (memoryLower.includes('performance') || memoryLower.includes('optimization')) {
			return 'Add performance monitoring and optimization features'
		}

		if (memoryLower.includes('documentation') || memoryLower.includes('readme')) {
			return 'Improve documentation based on recent development activities'
		}

		if (memoryLower.includes('refactor') || memoryLower.includes('cleanup')) {
			return 'Refactor codebase to improve maintainability'
		}

		if (failureCount > successCount * 2) {
			return 'Improve error handling and recovery mechanisms based on failure patterns'
		}

		if (memoryLower.includes('ci') || memoryLower.includes('pipeline')) {
			return 'Enhance CI/CD pipeline based on development workflow'
		}

		if (memoryLower.includes('monitoring') || memoryLower.includes('logging')) {
			return 'Add comprehensive monitoring and observability features'
		}

		const recentTasks = memory.split('\n')
			.filter(line => line.includes('Task') || line.includes('PR'))
			.slice(-5)

		if (recentTasks.length > 0) {
			const taskPatterns = recentTasks.join(' ').toLowerCase()
			
			if (taskPatterns.includes('database') || taskPatterns.includes('storage')) {
				return 'Implement data management and storage improvements'
			}
			
			if (taskPatterns.includes('api') || taskPatterns.includes('endpoint')) {
				return 'Enhance API design and endpoint functionality'
			}
			
			if (taskPatterns.includes('ui') || taskPatterns.includes('interface')) {
				return 'Improve user interface and experience features'
			}
		}

		return 'Analyze codebase patterns and implement systematic improvements'
	}
}
