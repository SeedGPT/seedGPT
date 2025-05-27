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
			const mockProcess = createMockProcess({
				success: true
