import * as fs from 'fs'
import * as path from 'path'
import { ContextManager } from '../src/contextManager.js'
import { WorkspaceManager } from '../src/workspaceManager.js'
import { Config } from '../src/types.js'

// Mock WorkspaceManager for testing
class MockWorkspaceManager extends WorkspaceManager {
	private mockWorkspacePath: string
	
	constructor(mockPath: string = '/mock/workspace') {
		// Pass a valid config object to avoid errors
		const mockConfig = { workingDirectory: mockPath } as Config
		super(null as any, mockConfig)
		this.mockWorkspacePath = mockPath
	}
	
	getWorkspacePath(): string {
		return this.mockWorkspacePath
	}
	
	getWorkspaceFilePath(relativePath: string): string {
		return path.join(this.mockWorkspacePath, relativePath)
	}
}

describe('ContextManager', () => {
	let contextManager: ContextManager
	let mockWorkspaceManager: MockWorkspaceManager
	let originalFs: any
	
	beforeEach(() => {
		mockWorkspaceManager = new MockWorkspaceManager()
		contextManager = new ContextManager(mockWorkspaceManager)
		
		// Mock fs.readFileSync and fs.existsSync
		originalFs = { ...fs }
		jest.spyOn(fs, 'readFileSync').mockImplementation((filePath: any) => {
			const pathStr = filePath.toString()
			if (pathStr.includes('taskManager.ts')) {
				return `export function loadTasks() { return [] }
export function saveTasks() { }
import { Task } from './types.js'`
			}
			if (pathStr.includes('llmClient.ts')) {
				return `export class LLMClient {
	async generatePatch() { return 'patch' }
	async generateReview() { return 'review' }
}`
			}
			if (pathStr.includes('memory.ts')) {
				return `export async function loadMemory() { return 'memory' }
export async function updateMemory() { }`
			}
			return 'export default {}'
		})
		
		jest.spyOn(fs, 'existsSync').mockReturnValue(true)
		jest.spyOn(fs, 'readdirSync').mockImplementation((dirPath: any) => {
			const pathStr = dirPath.toString()
			if (pathStr.includes('mock/workspace')) {
				return [
					{ name: 'src', isDirectory: () => true, isFile: () => false },
					{ name: 'package.json', isDirectory: () => false, isFile: () => true }
				] as any
			}
			if (pathStr.includes('src')) {
				return [
					{ name: 'taskManager.ts', isDirectory: () => false, isFile: () => true },
					{ name: 'llmClient.ts', isDirectory: () => false, isFile: () => true },
					{ name: 'memory.ts', isDirectory: () => false, isFile: () => true },
					{ name: 'types.ts', isDirectory: () => false, isFile: () => true }
				] as any
			}
			return []
		})
	})
	
	afterEach(() => {
		jest.restoreAllMocks()
	})
	
	describe('analyzeTaskContext', () => {
		it('should extract relevant keywords from task description', async () => {
			const taskDesc = "Fix the taskManager.ts file to handle TypeScript errors in the LLM client"
			const analysis = await contextManager.analyzeTaskContext(taskDesc)
			
			expect(analysis.keywords).toContain('typescript')
			expect(analysis.keywords).toContain('llm')
			expect(analysis.keywords).toContain('fix')
			expect(analysis.estimatedScope).toBeDefined()
		})
		
		it('should identify target files based on task description', async () => {
			const taskDesc = "Update the taskManager to fix loading issues"
			const analysis = await contextManager.analyzeTaskContext(taskDesc)
			
			expect(analysis.targetFiles).toContain('src/taskManager.ts')
		})
		
		it('should find related files based on imports', async () => {
			const taskDesc = "Fix task management functionality"
			const analysis = await contextManager.analyzeTaskContext(taskDesc)
			
			// Should include related files that import task-related modules
			expect(analysis.relatedFiles.length).toBeGreaterThan(0)
		})
	})
	
	describe('buildContextMessages', () => {
		it('should build context messages with memory and file context', async () => {
			const taskDesc = "Update taskManager.ts to fix TypeScript issues"
			const memoryContext = "Previous task completed: Fixed LLM client"
			
			const messages = await contextManager.buildContextMessages(taskDesc, memoryContext)
			
			expect(messages).toHaveLength(2)
			expect(messages[0].content).toContain('Memory Context')
			expect(messages[1].content).toContain('Codebase Context')
			expect(messages[1].content).toContain('taskManager.ts')
		})
		
		it('should handle missing memory context gracefully', async () => {
			const taskDesc = "Update taskManager.ts"
			
			const messages = await contextManager.buildContextMessages(taskDesc)
			
			expect(messages.length).toBeGreaterThanOrEqual(1)
			expect(messages.some(m => m.content.includes('Codebase Context'))).toBe(true)
		})
		
		it('should limit context size to prevent token overflow', async () => {
			const taskDesc = "Large refactoring task affecting multiple files"
			
			const messages = await contextManager.buildContextMessages(taskDesc)
			
			// Should not exceed reasonable context limits
			const totalContent = messages.map(m => m.content).join('')
			expect(totalContent.length).toBeLessThan(200000) // Reasonable token limit
		})
	})
	
	describe('keyword extraction', () => {
		it('should extract programming language keywords', async () => {
			const taskDesc = "Fix TypeScript compilation errors in React components"
			const analysis = await contextManager.analyzeTaskContext(taskDesc)
			
			expect(analysis.keywords).toContain('typescript')
			expect(analysis.keywords).toContain('react')
		})
		
		it('should extract action keywords', async () => {
			const taskDesc = "Implement new feature and refactor existing code"
			const analysis = await contextManager.analyzeTaskContext(taskDesc)
			
			expect(analysis.keywords).toContain('implement')
			expect(analysis.keywords).toContain('refactor')
		})
		
		it('should extract framework keywords', async () => {
			const taskDesc = "Update Anthropic API integration for LLM calls"
			const analysis = await contextManager.analyzeTaskContext(taskDesc)
			
			expect(analysis.keywords).toContain('anthropic')
			expect(analysis.keywords).toContain('llm')
			expect(analysis.keywords).toContain('api')
		})
	})
	
	describe('scope estimation', () => {
		it('should estimate small scope for simple tasks', async () => {
			const taskDesc = "Fix typo in comment"
			const analysis = await contextManager.analyzeTaskContext(taskDesc)
			
			expect(analysis.estimatedScope).toBe('small')
		})
		
		it('should estimate large scope for architecture changes', async () => {
			const taskDesc = "Refactor the entire system architecture to support new requirements"
			const analysis = await contextManager.analyzeTaskContext(taskDesc)
			
			expect(analysis.estimatedScope).toBe('large')
		})
	})
})
