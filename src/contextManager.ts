import * as fs from 'fs'
import * as path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'

import logger from './logger.js'
import { AnthropicMessage, Config } from './types.js'
import { WorkspaceManager } from './workspaceManager.js'
import { LLMClient } from './llmClient.js'

const execAsync = promisify(exec)

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
	searchQueries: string[]
	estimatedScope: 'small' | 'medium' | 'large'
}

export interface SearchResult {
	file: string
	line: number
	content: string
	relevanceScore: number
}

export class ContextManager {
	private workspaceManager: WorkspaceManager
	private llmClient: LLMClient
	private maxContextTokens: number = 50000
	
	constructor(workspaceManager: WorkspaceManager, llmClient: LLMClient) {
		this.workspaceManager = workspaceManager
		this.llmClient = llmClient
	}
	async analyzeTaskContext(taskDescription: string): Promise<ContextAnalysis> {
		const keywords = this.extractKeywords(taskDescription)
		const searchQueries = await this.generateSearchQueries(taskDescription, keywords)
		
		const targetFiles = await this.identifyTargetFilesWithSearch(taskDescription, searchQueries)
		const relatedFiles = await this.findRelatedFiles(targetFiles, keywords)
		const enhancedRelatedFiles = await this.enhanceRelatedFilesWithLLM(
			taskDescription, 
			targetFiles, 
			relatedFiles
		)
		
		const scope = this.estimateScope(taskDescription, targetFiles, enhancedRelatedFiles)

		return {
			targetFiles,
			relatedFiles: enhancedRelatedFiles,
			keywords,
			searchQueries,
			estimatedScope: scope
		}
	}

	private async enhanceRelatedFilesWithLLM(
		taskDescription: string,
		targetFiles: string[],
		programmaticRelatedFiles: string[]
	): Promise<string[]> {
		try {
			const allSourceFiles = await this.getAllSourceFiles(this.workspaceManager.getWorkspacePath())
			const candidateFiles = allSourceFiles.filter(file => 
				!targetFiles.includes(file) && 
				!programmaticRelatedFiles.includes(file)
			)

			if (candidateFiles.length === 0) {
				return programmaticRelatedFiles
			}

			const fileSample = this.getRandomSample(candidateFiles, Math.min(30, candidateFiles.length))
			
			const relationshipPrompt = `
Task: ${taskDescription}
Target Files: ${targetFiles.join(', ')}
Current Related Files: ${programmaticRelatedFiles.join(', ')}

Analyze these additional files and identify which ones are architecturally related or could be impacted:

Candidate Files:
${fileSample.map(f => `- ${f}`).join('\n')}

Consider:
- Shared interfaces, types, or base classes
- Similar architectural patterns or responsibilities
- Potential impact from the proposed changes
- Integration points or dependencies
- Cross-cutting concerns

Return JSON array of relevant files:
["file1.ts", "file2.ts"]

Only include files with strong architectural relationships.`

			const response = await this.llmClient.generateResponse([
				{ role: 'user', content: relationshipPrompt }
			], false)

			const llmRelatedFiles = this.llmClient.extractJsonFromResponse(response) as string[]
			const validLLMFiles = llmRelatedFiles.filter(file => 
				candidateFiles.includes(file) && file.length > 0
			)

			return [...programmaticRelatedFiles, ...validLLMFiles]
		} catch (error) {
			return programmaticRelatedFiles
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
		return [...new Set(keywords)]
	}

	private async generateSearchQueries(taskDescription: string, keywords: string[]): Promise<string[]> {
		try {
			const codebaseInfo = await this.extractCodebaseIdentifiers()
			
			const prompt = `Given this task description: "${taskDescription}"

Available codebase identifiers:
Classes: ${codebaseInfo.classes.join(', ')}
Functions: ${codebaseInfo.functions.join(', ')}
Modules: ${codebaseInfo.modules.join(', ')}

Generate 3-5 specific search queries that would help find relevant source code files. Focus on:
1. Function names, class names, or variable names that might be involved (use the available identifiers above)
2. Key concepts or domain terms from the task
3. Error messages or specific functionality mentioned
4. File patterns or modules that might be relevant

Return only the search queries, one per line, without explanations.
Example format:
export class TaskManager
async function loadTasks
task.status = 'completed'
config.memory.store`

			const response = await this.llmClient.generateResponse([{
				role: 'user',
				content: prompt
			}], false)

			const queries = response
				.split('\n')
				.map(line => line.trim())
				.filter(line => line.length > 0 && !line.startsWith('#') && !line.startsWith('//'))
				.slice(0, 5)

			logger.debug('Generated search queries', { taskDescription, queries })
			return queries.length > 0 ? queries : keywords
		} catch (error) {
			logger.warn('Failed to generate search queries, falling back to keywords', { error })
			return keywords
		}
	}

	private getRandomSample<T>(array: T[], size: number): T[] {
		if (array.length <= size) return array
		const shuffled = [...array].sort(() => 0.5 - Math.random())
		return shuffled.slice(0, size)
	}

	private async extractCodebaseIdentifiers(): Promise<{
		classes: string[],
		functions: string[],
		modules: string[]
	}> {
		const workspacePath = this.workspaceManager.getWorkspacePath()
		const sourceFiles = await this.getAllSourceFiles(workspacePath)
		
		const classes = new Set<string>()
		const functions = new Set<string>()
		const modules = new Set<string>()

		for (const file of sourceFiles) {
			try {
				const content = fs.readFileSync(file, 'utf-8')
				const relativePath = path.relative(workspacePath, file)
				
				modules.add(path.basename(file, path.extname(file)))
				
				const classMatches = content.match(/(?:export\s+)?class\s+([A-Za-z][A-Za-z0-9]*)/g)
				if (classMatches) {
					classMatches.forEach(match => {
						const className = match.replace(/(?:export\s+)?class\s+/, '')
						classes.add(className)
					})
				}
				
				const functionMatches = content.match(/(?:export\s+)?(?:async\s+)?function\s+([A-Za-z][A-Za-z0-9]*)|([A-Za-z][a-zA-Z0-9]*)\s*(?::\s*[^=]*)?=\s*(?:async\s+)?\(/g)
				if (functionMatches) {
					functionMatches.forEach(match => {
						const funcName = match.match(/([A-Za-z][A-Za-z0-9]*)/)?.[1]
						if (funcName && !['if', 'for', 'while', 'switch', 'catch'].includes(funcName)) {
							functions.add(funcName)
						}
					})
				}
				
				const methodMatches = content.match(/(?:async\s+)?([A-Za-z][A-Za-z0-9]*)\s*\([^)]*\)\s*(?::\s*[^{]*)?{/g)
				if (methodMatches) {
					methodMatches.forEach(match => {
						const methodName = match.match(/([A-Za-z][A-Za-z0-9]*)/)?.[1]
						if (methodName && !['if', 'for', 'while', 'switch', 'catch', 'constructor'].includes(methodName)) {
							functions.add(methodName)
						}
					})
				}
			} catch (error) {
				// Skip files that can't be read
			}
		}

		return {
			classes: this.getRandomSample(Array.from(classes), 200),
			functions: this.getRandomSample(Array.from(functions), 200),
			modules: this.getRandomSample(Array.from(modules), 200)
		}
	}

	private async identifyTargetFilesWithSearch(taskDescription: string, searchQueries: string[]): Promise<string[]> {
		const searchResults: SearchResult[] = []
		
		for (const query of searchQueries) {
			try {
				const results = await this.searchCodebase(query)
				searchResults.push(...results)
			} catch (error) {
				logger.debug('Search query failed', { query, error })
			}
		}

		const fileScores = new Map<string, number>()
		
		for (const result of searchResults) {
			const currentScore = fileScores.get(result.file) || 0
			fileScores.set(result.file, currentScore + result.relevanceScore)
		}

		const targetFiles = Array.from(fileScores.entries())
			.sort(([, a], [, b]) => b - a)
			.slice(0, 5)
			.map(([file]) => file)

		if (targetFiles.length === 0) {
			return await this.identifyTargetFiles(taskDescription, searchQueries)
		}

		logger.debug('Identified target files through search', { 
			taskDescription, 
			searchQueries, 
			targetFiles,
			totalResults: searchResults.length 
		})

		return targetFiles
	}
	private async searchCodebase(query: string): Promise<SearchResult[]> {
		try {
			const workspacePath = this.workspaceManager.getWorkspacePath()
			const isWindows = process.platform === 'win32'
			
			// Escape wildcards for grep/PowerShell and convert to regex patterns
			const escapedQuery = query.replace(/\*/g, '.*').replace(/\?/g, '.')
			
			const searchCmd = isWindows 
				? `Get-ChildItem -Recurse -Include "*.ts","*.js","*.json","*.md" | Select-String -Pattern "${escapedQuery.replace(/"/g, '`"')}" | ForEach-Object { "$($_.Filename):$($_.LineNumber):$($_.Line)" }`
				: `grep -rn --include="*.ts" --include="*.js" --include="*.json" --include="*.md" "${escapedQuery}" .`
			
			const { stdout } = await execAsync(searchCmd, { 
				cwd: workspacePath,
				shell: isWindows ? 'powershell.exe' : '/bin/bash',
				timeout: 10000
			})

			const results: SearchResult[] = []
			const lines = stdout.split('\n').filter(line => line.trim())

			for (const line of lines) {
				const match = line.match(/^([^:]+):(\d+):(.+)$/)
				if (match) {
					const [, filePath, lineNum, content] = match
					const normalizedPath = path.relative(workspacePath, path.resolve(workspacePath, filePath))
					
					results.push({
						file: normalizedPath.replace(/\\/g, '/'),
						line: parseInt(lineNum),
						content: content.trim(),
						relevanceScore: this.calculateRelevanceScore(content, query)
					})
				}
			}

			return results
		} catch (error) {
			logger.debug('Codebase search failed', { query, error })
			return []
		}
	}

	private calculateRelevanceScore(content: string, query: string): number {
		let score = 1
		
		if (content.toLowerCase().includes(query.toLowerCase())) {
			score += 2
		}
		
		if (content.includes('export') || content.includes('function') || content.includes('class')) {
			score += 1
		}
		
		if (content.includes('import') || content.includes('require')) {
			score += 0.5
		}
		
		return score
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
		const allFiles = await this.getAllSourceFiles(this.workspaceManager.getWorkspacePath())
		const contextFiles: ContextFile[] = []
		let totalTokens = 0

		const targetFilesSet = new Set(analysis.targetFiles)
		const relatedFilesSet = new Set(analysis.relatedFiles)
		for (const file of analysis.targetFiles) {
			if (totalTokens >= this.maxContextTokens) break
			const contextFile = await this.createContextFile(file, file, 100)
			if (contextFile) {
				contextFiles.push(contextFile)
				totalTokens += contextFile.size
			}
		}

		for (const file of analysis.relatedFiles) {
			if (totalTokens >= this.maxContextTokens) break
			if (!targetFilesSet.has(file)) {
				const contextFile = await this.createContextFile(file, file, 75)
				if (contextFile) {
					contextFiles.push(contextFile)
					totalTokens += contextFile.size
				}
			}
		}

		const remainingFiles = allFiles.filter(file => 
			!targetFilesSet.has(file) && !relatedFilesSet.has(file)
		)

		const llmEnhancedFiles = await this.selectFilesWithLLMAssist(
			remainingFiles, 
			analysis, 
			this.maxContextTokens - totalTokens
		)

		contextFiles.push(...llmEnhancedFiles)

		contextFiles.sort((a, b) => b.importance - a.importance)
		return contextFiles
	}

	private async selectFilesWithLLMAssist(
		remainingFiles: string[], 
		analysis: ContextAnalysis, 
		remainingTokens: number
	): Promise<ContextFile[]> {
		if (remainingFiles.length === 0 || remainingTokens < 1000) {
			return []
		}

		try {
			const fileSample = this.getRandomSample(remainingFiles, Math.min(50, remainingFiles.length))
			const fileAnalysisPrompt = `
Task Context: ${analysis.searchQueries.join(', ')}
Keywords: ${analysis.keywords.join(', ')}
Scope: ${analysis.estimatedScope}

Analyze these files and rank them by relevance to the task (0-100 scale):

Files to analyze:
${fileSample.map(f => `- ${f}`).join('\n')}

Return JSON array with format:
[{"file": "path/to/file", "relevance": 85, "reasoning": "why relevant"}]

Focus on files that:
- Contain related functionality or patterns
- Define interfaces or types that might be affected
- Handle similar concerns or use cases
- Are part of the same architectural layer
- Could be impacted by the changes

Only include files with relevance >= 60.`

			const response = await this.llmClient.generateResponse([
				{ role: 'user', content: fileAnalysisPrompt }
			], false)

			const analysisResults = this.llmClient.extractJsonFromResponse(response) as Array<{
				file: string
				relevance: number
				reasoning: string
			}>

			const contextFiles: ContextFile[] = []
			let currentTokens = 0

			for (const result of analysisResults.sort((a, b) => b.relevance - a.relevance)) {
				if (currentTokens >= remainingTokens) break
				
				const contextFile = await this.createContextFile(
					result.file, 
					result.file, 
					Math.min(60, Math.max(30, result.relevance))
				)
				
				if (contextFile && currentTokens + contextFile.size <= remainingTokens) {
					contextFiles.push(contextFile)
					currentTokens += contextFile.size
				}
			}

			return contextFiles
		} catch (error) {
			const fallbackFiles = this.getRandomSample(remainingFiles, 10)
			const contextFiles: ContextFile[] = []
			let currentTokens = 0

			for (const file of fallbackFiles) {
				if (currentTokens >= remainingTokens) break
				const contextFile = await this.createContextFile(file, file, 40)
				if (contextFile && currentTokens + contextFile.size <= remainingTokens) {
					contextFiles.push(contextFile)
					currentTokens += contextFile.size
				}
			}

			return contextFiles
		}
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
