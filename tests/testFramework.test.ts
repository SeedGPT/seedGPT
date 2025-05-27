import { jest } from '@jest/globals'
import { TestFramework, TestConfig, TestResults, CoverageReport } from '../src/testFramework.js'
import { WorkspaceManager } from '../src/workspaceManager.js'
import fs from 'fs/promises'
import { spawn } from 'child_process'
import { EventEmitter } from 'events'

// Mock dependencies
jest.mock('fs/promises')
jest.mock('child_process')
jest.mock('../src/logger.js', () => ({
	default: {
		debug: jest.fn(),
		info: jest.fn(),
		warn: jest.fn(),
		error: jest.fn()
	}
}))

const mockFs = fs as jest.Mocked<typeof fs>
const mockSpawn = spawn as jest.MockedFunction<typeof spawn>

describe('TestFramework', () => {
	let testFramework: TestFramework
	let mockWorkspaceManager: jest.Mocked<WorkspaceManager>
	let testConfig: TestConfig

	beforeEach(() => {
		// Reset all mocks
		jest.clearAllMocks()

		// Setup mock workspace manager
		mockWorkspaceManager = {
			getWorkspaceFilePath: jest.fn((path: string) => `/workspace/${path}`),
			getWorkspacePath: jest.fn(() => '/workspace')
		} as any

		// Setup test configuration
		testConfig = {
			testDirectory: 'tests',
			testPattern: '**/*.test.ts',
			testTimeout: 10000,
			coverageThresholds: {
				statements: 80,
				branches: 80,
				functions: 80,
				lines: 80
			}
		}

		testFramework = new TestFramework(mockWorkspaceManager, testConfig)
	})

	describe('constructor', () => {
		it('should initialize with workspace manager and config', () => {
			expect(testFramework).toBeDefined()
			expect(mockWorkspaceManager.getWorkspaceFilePath).not.toHaveBeenCalled()
		})
	})

	describe('runTests', () => {
		beforeEach(() => {
			// Mock fs operations
			mockFs.mkdir.mockResolvedValue(undefined)
			mockFs.access.mockResolvedValue(undefined)
			mockFs.readFile.mockResolvedValue(JSON.stringify({
				total: {
					statements: { pct: 85 },
					branches: { pct: 82 },
					functions: { pct: 90 },
					lines: { pct: 88 }
				}
			}))
		})

		it('should run tests successfully with coverage', async () => {
			// Mock successful Jest execution


	it('should throw error when workspace manager is not provided', () => {
		expect(() => new TestFramework(null as any, testConfig)).toThrow('WorkspaceManager is required')
	})

	it('should throw error when config is not provided', () => {
		expect(() => new TestFramework(mockWorkspaceManager, null as any)).toThrow('TestConfig is required')
	})

	describe('getConfig', () => {
		it('should return a copy of current configuration', () => {
			const config = testFramework.getConfig()
			expect(config).toEqual(testConfig)
			expect(config).not.toBe(testConfig) // Should be a copy
		})
	})

	describe('updateConfig', () => {
		it('should update configuration partially', () => {
			const updates = { testTimeout: 15000 }
			testFramework.updateConfig(updates)
			const updatedConfig = testFramework.getConfig()
			expect(updatedConfig.testTimeout).toBe(15000)
		})
	})
			const jestOutput = JSON.stringify({
				success: true,
				numTotalTests: 10,
				numPassedTests: 10,
				numFailedTests: 0,
				numPendingTests: 0
			})

			const mockProcess = createMockProcess(0, jestOutput, '')
			mockSpawn.mockReturnValue(mockProcess as any)

			const results = await testFramework.runTests()

			expect(results.success).toBe(true)
			expect(results.totalTests).toBe(10)
			expect(results.passedTests).toBe(10)
			expect(results.failedTests).toBe(0)
			expect(results.coverage).toBeDefined()
		})

		it('should handle test failures correctly', async () => {
			const jestOutput = JSON.stringify({
				success: false,
				numTotalTests: 10,
				numPassedTests: 8,
				numFailedTests: 2,
				numPendingTests: 0,
				testResults: [{
					message: 'Test failed',
					assertionResults: [{
						status: 'failed',
						failureMessages: ['Assertion failed']
					}]
				}]
			})

			const mockProcess = createMockProcess(1, jestOutput, '')
			mockSpawn.mockReturnValue(mockProcess as any)

			const results = await testFramework.runTests()

			expect(results.success).toBe(false)
			expect(results.errors).toContain('Test failed')
			expect(results.errors).toContain('Assertion failed')
		})

		it('should handle empty Jest output', async () => {
			const mockProcess = createMockProcess(0, '', '')
			mockSpawn.mockReturnValue(mockProcess as any)

			const results = await testFramework.runTests()

			expect(results.success).toBe(false)
			expect(results.errors).toContain('Empty Jest output received')
		})

		it('should include test pattern in Jest args', async () => {
			const jestOutput = JSON.stringify({ success: true, numTotalTests: 0 })
			const mockProcess = createMockProcess(0, jestOutput, '')
			mockSpawn.mockReturnValue(mockProcess as any)

			await testFramework.runTests('unit')

			expect(mockSpawn).toHaveBeenCalledWith('npx',
				expect.arrayContaining(['--testNamePattern', 'unit']),
				expect.any(Object)
			)
		})
	})

	describe('runUnitTests', () => {
		it('should run unit tests with correct pattern', async () => {
			const jestOutput = JSON.stringify({ success: true, numTotalTests: 5 })
			const mockProcess = createMockProcess(0, jestOutput, '')
			mockSpawn.mockReturnValue(mockProcess as any)

			await testFramework.runUnitTests()

			expect(mockSpawn).toHaveBeenCalledWith('npx',
				expect.arrayContaining(['--testNamePattern', '.*\\.unit\\.']),
				expect.any(Object)
			)
		})
	})

	describe('runIntegrationTests', () => {
		it('should run integration tests with correct pattern', async () => {
			const jestOutput = JSON.stringify({ success: true, numTotalTests: 3 })
			const mockProcess = createMockProcess(0, jestOutput, '')
			mockSpawn.mockReturnValue(mockProcess as any)

			await testFramework.runIntegrationTests()

			expect(mockSpawn).toHaveBeenCalledWith('npx',
				expect.arrayContaining(['--testNamePattern', '.*\\.integration\\.']),
				expect.any(Object)
			)
