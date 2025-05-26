import { LLMTools } from '../src/llmTools.js'
import { BranchRecoveryManager } from '../src/branchRecoveryManager.js'
import { WorkspaceManager } from '../src/workspaceManager.js'

describe('LLMTools', () => {
	let llmTools: LLMTools
	let mockBranchRecovery: BranchRecoveryManager
	let mockWorkspace: WorkspaceManager

	beforeEach(() => {
		mockBranchRecovery = {} as any
		mockWorkspace = {} as any
		llmTools = new LLMTools(mockBranchRecovery, mockWorkspace)
	})

	describe('parseToolRequest', () => {
		it('should parse EXECUTE_SCRIPT tool request correctly', () => {
			const input = 'EXECUTE_SCRIPT: scripts/test.js - Testing script execution'
			const result = llmTools.parseToolRequest(input)
			
			expect(result).toEqual({
				tool: 'EXECUTE_SCRIPT',
				args: 'scripts/test.js',
				reason: 'Testing script execution'
			})
		})

		it('should parse RUN_TESTS tool request correctly', () => {
			const input = 'RUN_TESTS: unit - Running unit tests'
			const result = llmTools.parseToolRequest(input)
			
			expect(result).toEqual({
				tool: 'RUN_TESTS',
				args: 'unit',
				reason: 'Running unit tests'
			})
		})

		it('should parse RUN_TESTS without pattern correctly', () => {
			const input = 'RUN_TESTS: - Running all tests'
			const result = llmTools.parseToolRequest(input)
			
			expect(result).toEqual({
				tool: 'RUN_TESTS',
				args: undefined,
				reason: 'Running all tests'
			})
		})

		it('should parse INSTALL_PACKAGE tool request correctly', () => {
			const input = 'INSTALL_PACKAGE: lodash - Adding utility library'
			const result = llmTools.parseToolRequest(input)
			
			expect(result).toEqual({
				tool: 'INSTALL_PACKAGE',
				args: 'lodash',
				reason: 'Adding utility library'
			})
		})

		it('should parse BUILD_PROJECT tool request correctly', () => {
			const input = 'BUILD_PROJECT: Compiling TypeScript changes'
			const result = llmTools.parseToolRequest(input)
			
			expect(result).toEqual({
				tool: 'BUILD_PROJECT',
				args: undefined,
				reason: 'Compiling TypeScript changes'
			})
		})

		it('should return null for invalid tool request', () => {
			const input = 'INVALID_TOOL: test - Invalid tool'
			const result = llmTools.parseToolRequest(input)
			
			expect(result).toBeNull()
		})

		it('should handle existing tools correctly', () => {
			const input = 'NUKE_BRANCH: Branch is corrupted'
			const result = llmTools.parseToolRequest(input)
			
			expect(result).toEqual({
				tool: 'NUKE_BRANCH',
				args: undefined,
				reason: 'Branch is corrupted'
			})
		})
	})
})
