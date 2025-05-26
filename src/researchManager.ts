import fs from 'fs'
import path from 'path'

import yaml from 'js-yaml'

import logger from './logger.js'
import { Config, ResearchTask, TaskSuggestion, RepositoryState } from './types.js'
import { WorkspaceManager } from './workspaceManager.js'

export class ResearchManager {
	private cfg: Config
	private workspaceManager: WorkspaceManager | null
	private researchPath: string
	private researchSummariesPath: string

	constructor(cfg: Config, workspaceManager?: WorkspaceManager) {
		this.cfg = cfg
		this.workspaceManager = workspaceManager || null
		this.researchPath = './research'
		this.researchSummariesPath = './research/summaries'
		this.ensureResearchDirectories()
	}

	private getWorkspacePath(filePath: string): string {
		if (this.workspaceManager && !path.isAbsolute(filePath)) {
			return this.workspaceManager.getWorkspaceFilePath(filePath)
		}
		return filePath
	}

	async shouldConductResearch(repoState: RepositoryState, recentTasks: any[]): Promise<boolean> {
		const missingToolsCount = repoState.missingTools.length
		const architecturalConcerns = repoState.architecturalConcerns.length
		const recentFailures = recentTasks.filter(t => t.metadata?.failureCount > 1).length

		if (missingToolsCount > 3) return true
		if (architecturalConcerns > 2) return true
		if (recentFailures > 2) return true

		const lastResearch = await this.getLastResearchDate()
		if (lastResearch) {
			const daysSinceResearch = (Date.now() - lastResearch.getTime()) / (1000 * 60 * 60 * 24)
			return daysSinceResearch > 7
		}

		return false
	}

	async generateResearchTopics(repoState: RepositoryState, failedTasks: any[]): Promise<string[]> {
		const topics: string[] = []

		if (repoState.missingTools.includes('advanced testing framework')) {
			topics.push('Modern testing frameworks for TypeScript/Node.js applications')
		}

		if (repoState.technicalDebt > 5) {
			topics.push('Code refactoring strategies for AI-driven development systems')
		}

		if (failedTasks.length > 0) {
			topics.push('Error recovery patterns in autonomous software development')
		}

		if (repoState.architecturalConcerns.includes('monolithic structure')) {
			topics.push('Microservices architecture patterns for AI development platforms')
		}

		topics.push('Latest advances in AI-powered software development')
		topics.push('Self-modifying code systems and safety patterns')

		return topics.slice(0, 3)
	}

	async conductResearch(topic: string): Promise<ResearchTask> {
		const researchTask: ResearchTask = {
			id: Date.now(),
			topic,
			questions: this.generateResearchQuestions(topic),
			sources: this.identifyResearchSources(topic),
			findings: await this.gatherFindings(topic),
			recommendations: [],
			createdAt: new Date().toISOString(),
			relatedTasks: [],
			impact: 'medium'
		}

		researchTask.recommendations = this.generateRecommendations(researchTask.findings, topic)
		await this.saveResearchTask(researchTask)

		logger.info('Research completed', {
			topic: researchTask.topic,
			findingsLength: researchTask.findings.length,
			recommendations: researchTask.recommendations.length
		})

		return researchTask
	}

	async getResearchSummary(maxEntries: number = 5): Promise<string> {
		const researchTasks = await this.loadRecentResearch(maxEntries)
		
		if (researchTasks.length === 0) {
			return 'No recent research available'
		}

		let summary = 'Recent Research Findings:\n'
		for (const research of researchTasks) {
			summary += `\n${research.topic}:\n`
			summary += `Key findings: ${research.findings.substring(0, 200)}...\n`
			summary += `Recommendations: ${research.recommendations.slice(0, 2).join(', ')}\n`
		}

		return summary
	}

	async createResearchBasedTasks(researchTasks: ResearchTask[]): Promise<TaskSuggestion[]> {
		const suggestions: TaskSuggestion[] = []

		for (const research of researchTasks) {
			for (const recommendation of research.recommendations) {
				suggestions.push({
					description: `Implement: ${recommendation}`,
					rationale: `Based on research into ${research.topic}`,
					priority: research.impact === 'high' ? 'high' : 'medium',
					type: 'feature',
					estimatedEffort: 'medium',
					dependencies: [],
					impact: research.impact,
					urgency: research.impact === 'high' ? 8 : 6,
					prerequisites: [`Research: ${research.topic}`]
				})
			}
		}

		return suggestions
	}
	private ensureResearchDirectories(): void {
		const researchPath = this.getWorkspacePath(this.researchPath)
		const summariesPath = this.getWorkspacePath(this.researchSummariesPath)
		
		if (!fs.existsSync(researchPath)) {
			fs.mkdirSync(researchPath, { recursive: true })
		}
		if (!fs.existsSync(summariesPath)) {
			fs.mkdirSync(summariesPath, { recursive: true })
		}
	}

	private generateResearchQuestions(topic: string): string[] {
		const baseQuestions = [
			'What are the current best practices?',
			'What are the common challenges and solutions?',
			'What tools and frameworks are recommended?',
			'What are the performance and scalability considerations?'
		]

		if (topic.includes('testing')) {
			return [
				...baseQuestions,
				'Which testing frameworks provide the best TypeScript support?',
				'How to achieve high test coverage in autonomous systems?',
				'What are the best practices for testing AI-generated code?'
			]
		}

		if (topic.includes('architecture')) {
			return [
				...baseQuestions,
				'How to design scalable autonomous development systems?',
				'What are the security considerations for self-modifying systems?',
				'How to implement proper separation of concerns?'
			]
		}

		return baseQuestions
	}

	private identifyResearchSources(topic: string): string[] {
		const sources = [
			'Software engineering best practices documentation',
			'Academic papers on autonomous software development',
			'Industry standards and guidelines',
			'Open source project architectures'
		]

		if (topic.includes('testing')) {
			sources.push(
				'Jest documentation and best practices',
				'TypeScript testing patterns',
				'Test automation frameworks comparison'
			)
		}

		if (topic.includes('AI')) {
			sources.push(
				'AI/ML engineering practices',
				'LLM integration patterns',
				'AI safety and reliability research'
			)
		}

		return sources
	}

	private async gatherFindings(topic: string): Promise<string> {
		let findings = `Research findings for: ${topic}\n\n`

		if (topic.includes('testing framework')) {
			findings += `Testing Framework Research:
- Jest is the most popular testing framework for TypeScript/Node.js
- Vitest provides better ESM support and faster execution
- Playwright is excellent for integration testing
- Coverage should target 80%+ for production systems
- Test structure should follow AAA pattern (Arrange, Act, Assert)
- Mocking is essential for testing autonomous systems
- Property-based testing can catch edge cases in AI systems
`
		}

		if (topic.includes('architecture')) {
			findings += `Architecture Research:
- Microservices improve maintainability and scalability
- Event-driven architecture enables loose coupling
- Circuit breaker pattern prevents cascade failures
- Dependency injection improves testability
- SOLID principles are crucial for evolving systems
- Clean architecture separates concerns effectively
`
		}

		if (topic.includes('AI-powered')) {
			findings += `AI Development Research:
- LLM integration requires careful prompt engineering
- Rate limiting and retry logic are essential
- Context management affects AI performance significantly
- Validation of AI-generated code is critical
- Incremental learning improves system capabilities
- Safety mechanisms prevent harmful code generation
`
		}

		findings += `\nGeneral Findings:
- Incremental development reduces integration risks
- Automated testing catches regressions early
- Documentation should be maintained alongside code
- Performance monitoring enables proactive optimization
- Security scanning should be integrated into CI/CD
- Error handling should be comprehensive and informative
`

		return findings
	}

	private generateRecommendations(findings: string, topic: string): string[] {
		const recommendations: string[] = []

		if (topic.includes('testing')) {
			recommendations.push(
				'Implement comprehensive unit testing with Jest',
				'Add integration testing for critical workflows',
				'Set up automated test coverage reporting',
				'Create property-based tests for AI components'
			)
		}

		if (topic.includes('architecture')) {
			recommendations.push(
				'Refactor to modular architecture with clear boundaries',
				'Implement dependency injection for better testability',
				'Add circuit breaker patterns for external API calls',
				'Create event-driven communication between components'
			)
		}

		if (findings.includes('error')) {
			recommendations.push(
				'Implement comprehensive error handling system',
				'Add retry logic with exponential backoff',
				'Create error recovery mechanisms',
				'Improve logging for debugging complex failures'
			)
		}

		recommendations.push(
			'Add performance monitoring and metrics collection',
			'Implement automated security scanning',
			'Create comprehensive documentation generation',
			'Add health checks and system monitoring'
		)

		return recommendations.slice(0, 6)
	}
	private async saveResearchTask(researchTask: ResearchTask): Promise<void> {
		const filename = `research-${researchTask.id}.yaml`
		const filepath = this.getWorkspacePath(path.join(this.researchPath, filename))
		
		try {
			fs.writeFileSync(filepath, yaml.dump(researchTask, { indent: 2 }))
			
			const summaryPath = this.getWorkspacePath(path.join(this.researchSummariesPath, `${researchTask.topic.replace(/[^a-zA-Z0-9]/g, '-')}.md`))
			const summaryContent = `# ${researchTask.topic}\n\n${researchTask.findings}\n\n## Recommendations\n${researchTask.recommendations.map(r => `- ${r}`).join('\n')}\n`
			fs.writeFileSync(summaryPath, summaryContent)
		} catch (error) {
			logger.error('Failed to save research task', { error })
		}
	}
	private async loadRecentResearch(maxEntries: number): Promise<ResearchTask[]> {
		try {
			const researchPath = this.getWorkspacePath(this.researchPath)
			const files = fs.readdirSync(researchPath)
				.filter(f => f.startsWith('research-') && f.endsWith('.yaml'))
				.sort((a, b) => {
					const aTime = fs.statSync(path.join(researchPath, a)).mtime
					const bTime = fs.statSync(path.join(researchPath, b)).mtime
					return bTime.getTime() - aTime.getTime()
				})
				.slice(0, maxEntries)

			const researchTasks: ResearchTask[] = []
			for (const file of files) {
				const content = fs.readFileSync(path.join(researchPath, file), 'utf-8')
				const research = yaml.load(content) as ResearchTask
				researchTasks.push(research)
			}

			return researchTasks
		} catch (error) {
			logger.error('Failed to load recent research', { error })
			return []
		}
	}
	private async getLastResearchDate(): Promise<Date | null> {
		try {
			const researchPath = this.getWorkspacePath(this.researchPath)
			const files = fs.readdirSync(researchPath)
				.filter(f => f.startsWith('research-') && f.endsWith('.yaml'))
			
			if (files.length === 0) return null

			const latestFile = files
				.map(f => ({
					file: f,
					time: fs.statSync(path.join(researchPath, f)).mtime
				}))
				.sort((a, b) => b.time.getTime() - a.time.getTime())[0]

			return latestFile.time
		} catch (error) {
			return null
		}
	}
}
