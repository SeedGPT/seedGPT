import * as fs from 'fs'
import * as path from 'path'

import logger from './logger.js'
import { AnthropicMessage } from './types.js'
import { WorkspaceManager } from './workspaceManager.js'

export interface ContextFile {
	path: string
	content: string
	importance: number
	size: number
}

export interface ContextAnalysis {
	targetFiles: string[]
	relatedFiles: string[]
	keywords: string[]
	estimatedScope: 'small' | 'medium' | 'large'
}

export class ContextManager {
	private workspaceManager: WorkspaceManager
	private maxContextTokens: number = 50000 // Conservative estimate for token limits
	
	constructor(workspaceManager: WorkspaceManager) {
		this.workspaceManager = workspaceManager
	}

	async analyzeTaskContext(taskDescription: string): Promise<ContextAnalysis> {
		const keywords = this.extractKeywords(taskDescription)
		const targetFiles = await this.identifyTargetFiles(taskDescription, keywords)
		const relatedFiles = await this.findRelatedFiles(targetFiles, keywords)
		const estimatedScope = this.estimateScope(taskDescription, targetFiles, relatedFiles)

		logger.debug('Task context analysis completed', {
			keywords,
			targetFiles,
			relatedFiles: relatedFiles.slice(0, 10), // Limit for logging
			estimatedScope
		})

		return {
			targetFiles,
			relatedFiles,
			keywords,
			estimatedScope
		}
	}

	async buildContextMessages(taskDescription: string, memoryContext?: string): Promise<AnthropicMessage[]> {
		const messages: AnthropicMessage[] = []

		// Add memory context if available
		if (memoryContext) {
			messages.push({
				role: 'user',
				content: `Memory Context:\n${memoryContext}`
			})
		}
		// Analyze task to determine relevant files
		const analysis = await this.analyzeTaskContext(taskDescription)
		const contextFiles = await this.selectRelevantFiles(analysis)

		if (contextFiles.length > 0) {
			const fileContext = this.formatFileContext(contextFiles)
			messages.push({
				role: 'user',
				content: `Codebase Context:\n${fileContext}`
			})

			logger.info('Built context with files', {
				fileCount: contextFiles.length,
				totalSize: contextFiles.reduce((sum, f) => sum + f.size, 0),
				files: contextFiles.map(f => f.path)
			})
		} else {
			logger.warn('No relevant files found for context', { taskDescription })
		}

		return messages
	}

	private extractKeywords(taskDescription: string): string[] {
		const text = taskDescription.toLowerCase()
		const keywords: string[] = []

		// Programming language keywords
		const languages = ['typescript', 'javascript', 'python', 'react', 'node', 'express']
		languages.forEach(lang => {
			if (text.includes(lang)) keywords.push(lang)
		})

		// Framework/library keywords
		const frameworks = ['anthropic', 'openai', 'llm', 'git', 'github', 'api', 'cli', 'dashboard', 'memory', 'workspace']
		frameworks.forEach(fw => {
			if (text.includes(fw)) keywords.push(fw)
		})

		// Action keywords
		const actions = ['add', 'implement', 'fix', 'update', 'create', 'delete', 'refactor', 'enhance', 'optimize']
		actions.forEach(action => {
			if (text.includes(action)) keywords.push(action)
		})

		// File type keywords
		const fileTypes = ['test', 'spec', 'config', 'manager', 'client', 'service', 'util', 'helper', 'interface', 'type']
		fileTypes.forEach(type => {
			if (text.includes(type)) keywords.push(type)
		})

		// Extract specific file/class names mentioned
		const fileNamePattern = /\b([a-zA-Z][a-zA-Z0-9]*Manager|[a-zA-Z][a-zA-Z0-9]*Client|[a-zA-Z][a-zA-Z0-9]*Service|[a-zA-Z][a-zA-Z0-9]*\.ts|[a-zA-Z][a-zA-Z0-9]*\.js)\b/g
		const matches = text.match(fileNamePattern)
		if (matches) {
			keywords.push(...matches)
		}

		return [...new Set(keywords)] // Remove duplicates
	}

	private async identifyTargetFiles(taskDescription: string, keywords: string[]): Promise<string[]> {
		const workspacePath = this.workspaceManager.getWorkspacePath()
		const allFiles = await this.getAllSourceFiles(workspacePath)
		const targetFiles: string[] = []

		// Direct file mentions
		for (const file of allFiles) {
			const fileName = path.basename(file, path.extname(file))
			const relativePath = path.relative(workspacePath, file)
			
			if (keywords.some(kw => 
				fileName.toLowerCase().includes(kw.toLowerCase()) ||
				relativePath.toLowerCase().includes(kw.toLowerCase()) ||
				taskDescription.toLowerCase().includes(fileName.toLowerCase()) ||
				taskDescription.toLowerCase().includes(relativePath.toLowerCase())
			)) {
				targetFiles.push(relativePath)
			}
		}

		// If no direct matches, look for functional matches
		if (targetFiles.length === 0) {
			const functionalMatches = await this.findFunctionalMatches(allFiles, keywords, taskDescription)
			targetFiles.push(...functionalMatches)
		}

		return targetFiles.slice(0, 5) // Limit target files
	}

	private async findRelatedFiles(targetFiles: string[], keywords: string[]): Promise<string[]> {
		const workspacePath = this.workspaceManager.getWorkspacePath()
		const allFiles = await this.getAllSourceFiles(workspacePath)
		const relatedFiles: string[] = []

		for (const file of allFiles) {
			const relativePath = path.relative(workspacePath, file)
			
			// Skip if already a target file
			if (targetFiles.includes(relativePath)) continue			// Check for imports/dependencies
			try {
				const content = fs.readFileSync(file, 'utf-8')
				const hasRelatedImports = targetFiles.some(target => {
					const targetName = path.basename(target, path.extname(target))
					return content.includes(`from './${targetName}`) ||
						   content.includes(`import`) && content.includes(targetName)
				})

				if (hasRelatedImports) {
					relatedFiles.push(relativePath)
					continue
				}

				// Check for keyword relevance
				const relevanceScore = keywords.reduce((score, keyword) => {
					const keywordCount = (content.toLowerCase().match(new RegExp(keyword.toLowerCase(), 'g')) || []).length
					return score + keywordCount
				}, 0)

				if (relevanceScore > 2) { // Threshold for relevance
					relatedFiles.push(relativePath)
				}
			} catch (error) {
				// Skip files that can't be read
			}
		}

		return relatedFiles.slice(0, 10) // Limit related files
	}

	private async findFunctionalMatches(allFiles: string[], keywords: string[], taskDescription: string): Promise<string[]> {
		const matches: string[] = []
		const workspacePath = this.workspaceManager.getWorkspacePath()

		// Look for files that might be functionally related
		for (const file of allFiles) {
			const relativePath = path.relative(workspacePath, file)
			const fileName = path.basename(file, path.extname(file))

			// Task-related files
			if (taskDescription.includes('task') && fileName.toLowerCase().includes('task')) {
				matches.push(relativePath)
			}

			// LLM-related files
			if (keywords.includes('llm') || keywords.includes('anthropic')) {
				if (fileName.toLowerCase().includes('llm') || fileName.toLowerCase().includes('client')) {
					matches.push(relativePath)
				}
			}

			// Test-related files
			if (taskDescription.includes('test') && (fileName.includes('test') || fileName.includes('spec'))) {
				matches.push(relativePath)
			}
		}

		return matches
	}

	private async selectRelevantFiles(analysis: ContextAnalysis): Promise<ContextFile[]> {
		const workspacePath = this.workspaceManager.getWorkspacePath()
		const contextFiles: ContextFile[] = []
		let totalSize = 0

		// Add target files (highest priority)
		for (const filePath of analysis.targetFiles) {
			const fullPath = path.join(workspacePath, filePath)
			const contextFile = await this.createContextFile(fullPath, filePath, 10)
			if (contextFile && totalSize + contextFile.size < this.maxContextTokens * 4) { // Rough token estimate
				contextFiles.push(contextFile)
				totalSize += contextFile.size
			}
		}

		// Add related files (lower priority)
		for (const filePath of analysis.relatedFiles) {
			if (totalSize >= this.maxContextTokens * 3) break // Leave room for other context

			const fullPath = path.join(workspacePath, filePath)
			const contextFile = await this.createContextFile(fullPath, filePath, 5)
			if (contextFile && totalSize + contextFile.size < this.maxContextTokens * 3) {
				contextFiles.push(contextFile)
				totalSize += contextFile.size
			}
		}

		// Sort by importance and size
		return contextFiles
			.sort((a, b) => b.importance - a.importance || a.size - b.size)
			.slice(0, 15) // Maximum number of files
	}

	private async createContextFile(fullPath: string, relativePath: string, importance: number): Promise<ContextFile | null> {
		try {
			if (!fs.existsSync(fullPath)) return null

			const content = fs.readFileSync(fullPath, 'utf-8')
			const size = content.length

			// Skip very large files or binary files
			if (size > 10000 || this.isBinaryFile(fullPath)) {
				return null
			}

			return {
				path: relativePath,
				content,
				importance,
				size
			}
		} catch (error) {
			logger.debug('Failed to read file for context', { path: relativePath, error })
			return null
		}
	}

	private formatFileContext(contextFiles: ContextFile[]): string {
		const sections = contextFiles.map(file => 
			`--- ${file.path} ---\n${file.content}\n`
		)
		
		return sections.join('\n')
	}

	private estimateScope(taskDescription: string, targetFiles: string[], relatedFiles: string[]): 'small' | 'medium' | 'large' {
		const totalFiles = targetFiles.length + relatedFiles.length
		const hasComplexKeywords = ['refactor', 'architecture', 'system', 'integration'].some(kw => 
			taskDescription.toLowerCase().includes(kw)
		)

		if (hasComplexKeywords || totalFiles > 8) return 'large'
		if (totalFiles > 3) return 'medium'
		return 'small'
	}

	private async getAllSourceFiles(dirPath: string): Promise<string[]> {
		const files: string[] = []
		const extensions = ['.ts', '.js', '.json', '.yaml', '.yml', '.md']

		const scanDirectory = (dir: string) => {
			try {
				const items = fs.readdirSync(dir, { withFileTypes: true })
				
				for (const item of items) {
					const fullPath = path.join(dir, item.name)
					
					if (item.isDirectory()) {
						// Skip node_modules, .git, and other irrelevant directories
						if (!['node_modules', '.git', 'dist', 'build', '.vscode'].includes(item.name)) {
							scanDirectory(fullPath)
						}
					} else if (item.isFile() && extensions.includes(path.extname(item.name))) {
						files.push(fullPath)
					}
				}
			} catch (error) {
				// Skip directories that can't be read
			}
		}

		scanDirectory(dirPath)
		return files
	}

	private isBinaryFile(filePath: string): boolean {
		const binaryExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.pdf', '.zip', '.tar', '.gz']
		return binaryExtensions.includes(path.extname(filePath).toLowerCase())
	}
}
