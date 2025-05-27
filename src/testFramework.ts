import * as fs from 'fs'
import * as path from 'path'
import { spawn, ChildProcess } from 'child_process'

import logger from './logger.js'
import { WorkspaceManager } from './workspaceManager.js'

let workspaceManager: WorkspaceManager | null = null

export function setWorkspaceManager(manager: WorkspaceManager) {
	workspaceManager = manager
}

function getWorkspacePath(filePath: string): string {
	if (workspaceManager && !path.isAbsolute(filePath)) {
		return workspaceManager.getWorkspaceFilePath(filePath)
	}
	return filePath
}

export interface TestResult {
	testFile: string
	status: 'passed' | 'failed' | 'skipped' | 'error'
	duration: number
	assertions: number
	failures: TestFailure[]
	coverage?: FileCoverage
}

export interface TestFailure {
	test: string
	message: string
	stack?: string
	expected?: any
	actual?: any
}

export interface FileCoverage {
	file: string
	statements: CoverageMetric
	branches: CoverageMetric
	functions: CoverageMetric
	lines: CoverageMetric
}

export interface CoverageMetric {
	total: number
	covered: number
	percentage: number
}

export interface TestSuiteResult {
	suiteName: string
	totalTests: number
	passedTests: number
	failedTests: number
	skippedTests: number
	duration: number
	results: TestResult[]
	coverage: TestCoverage
}

export interface TestCoverage {
	overall: {
		statements: CoverageMetric
		branches: CoverageMetric
		functions: CoverageMetric
		lines: CoverageMetric
	}
	files: FileCoverage[]
	threshold: {
		statements: number
		branches: number
		functions: number
		lines: number
	}
	meetsCriteria: boolean
}

export interface TestFrameworkConfig {
	testDirectory: string
	coverageDirectory: string
	testPattern: string
	coverageThreshold: {
		statements: number
		branches: number
		functions: number
		lines: number
	}
	timeout: number
	maxParallel: number
	reporters: string[]
	collectCoverageFrom: string[]
}

const DEFAULT_CONFIG: TestFrameworkConfig = {
	testDirectory: 'tests',
	coverageDirectory: 'coverage',
	testPattern: '**/*.test.ts',
	coverageThreshold: {
		statements: 95,
		branches: 90,
		functions: 95,
		lines: 95
	},
	timeout: 30000,
	maxParallel: 4,
	reporters: ['text', 'html', 'json'],
	collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts']
}

/**
 * Automated testing framework for running unit tests, integration tests,
 * and generating comprehensive test coverage reports
 */
export class TestFramework {
	private config: TestFrameworkConfig
	private runningProcesses: Map<string, ChildProcess> = new Map()

	constructor(config?: Partial<TestFrameworkConfig>) {
		this.config = { ...DEFAULT_CONFIG, ...config }
		this.validateConfig()
		this.ensureDirectories()
	}

	/**
	 * Validates the test framework configuration
	 * @throws {Error} If configuration is invalid
	 */
	private validateConfig(): void {
		if (!this.config.testDirectory) {
			throw new Error('Test directory must be specified')
		}

		if (this.config.timeout <= 0) {
			throw new Error('Timeout must be greater than 0')
		}

		if (this.config.maxParallel <= 0) {
			throw new Error('Max parallel processes must be greater than 0')
		}

		const thresholds = Object.values(this.config.coverageThreshold)
		if (thresholds.some(t => t < 0 || t > 100)) {
			throw new Error('Coverage thresholds must be between 0 and 100')
		}
	}

	/**
	 * Ensures required directories exist
	 */
	private ensureDirectories(): void {
		const dirs = [
			this.config.testDirectory,
			this.config.coverageDirectory
		]

		dirs.forEach(dir => {
			const workspaceDir = getWorkspacePath(dir)
			if (!fs.existsSync(workspaceDir)) {
				fs.mkdirSync(workspaceDir, { recursive: true })
				logger.info('Created test directory', { directory: workspaceDir })
			}
		})
	}

	/**
	 * Sanitizes file paths to prevent command injection
	 * @param filePath File path to sanitize
	 * @returns Sanitized file path
	 */
	private sanitizeFilePath(filePath: string): string {
		if (!filePath || typeof filePath !== 'string') {
			throw new Error('Invalid file path provided')
		}

		// Remove dangerous characters that could be used for injection
		const sanitized = filePath.replace(/[;&|`$(){}[\]<>]/g, '')

		// Ensure the path is within expected bounds
		const normalized = path.normalize(sanitized)
		if (normalized.includes('..') || path.isAbsolute(normalized)) {
			throw new Error('Invalid file path: path traversal not allowed')
		}

		return sanitized
	}

	/**
	 * Cleans up a running process
	 * @param processId Process identifier
	 */
	private cleanupProcess(processId: string): void {
		const process = this.runningProcesses.get(processId)
		if (process && !process.killed) {
			process.kill('SIGTERM')

			// Force kill after timeout
			setTimeout(() => {
				if (!process.killed) {
					process.kill('SIGKILL')
				}
			}, 5000)
		}
		this.runningProcesses.delete(processId)
	}

	/**
	 * Cleans up all running processes
	 */
	private cleanupAllProcesses(): void {
		for (const processId of this.runningProcesses.keys()) {
			this.cleanupProcess(processId)
		}
	}

	/**
	 * Runs all tests in the test directory
	 * @param pattern Optional test pattern to filter tests
	 * @returns Promise resolving to test suite results
	 */
	async runTests(pattern?: string): Promise<TestSuiteResult> {
		const testPattern = pattern || this.config.testPattern
		const startTime = Date.now()

		try {
			logger.info('Starting test execution', { pattern: testPattern })

			const testFiles = await this.discoverTestFiles(testPattern)
			if (testFiles.length === 0) {
				logger.warn('No test files found', { pattern: testPattern })
				return this.createEmptyTestResult(testPattern, Date.now() - startTime)
			}

			const results = await this.executeTests(testFiles)
			const coverage = await this.generateCoverage()
			const duration = Date.now() - startTime

			const suiteResult: TestSuiteResult = {
				suiteName: 'Test Suite',
				totalTests: results.reduce((sum, r) => sum + r.assertions, 0),
				passedTests: results.filter(r => r.status === 'passed').length,
				failedTests: results.filter(r => r.status === 'failed').length,
				skippedTests: results.filter(r => r.status === 'skipped').length,
				duration,
				results,
				coverage
			}

			logger.info('Test execution completed', {
				totalFiles: testFiles.length,
				passed: suiteResult.passedTests,
				failed: suiteResult.failedTests,
				duration
			})

			return suiteResult
		} catch (error) {
			logger.error('Test execution failed', { error, pattern: testPattern })
			this.cleanupAllProcesses()
			throw error
		}
	}

	/**
	 * Creates an empty test result for when no tests are found
	 * @param pattern Test pattern used
	 * @param duration Execution duration
	 * @returns Empty test suite result
	 */
	private createEmptyTestResult(pattern: string, duration: number): TestSuiteResult {
		return {
			suiteName: 'Test Suite',
			totalTests: 0,
			passedTests: 0,
			failedTests: 0,
			skippedTests: 0,
			duration,
			results: [],
			coverage: this.createEmptyCoverage()
		}
	}

	/**
	 * Creates empty coverage data
	 * @returns Empty test coverage
	 */
	private createEmptyCoverage(): TestCoverage {
		const emptyCoverageMetric: CoverageMetric = {
			total: 0,
			covered: 0,
			percentage: 0
		}

		return {
			overall: {
				statements: emptyCoverageMetric,
				branches: emptyCoverageMetric,
				functions: emptyCoverageMetric,
				lines: emptyCoverageMetric
			},
			files: [],
			threshold: this.config.coverageThreshold,
			meetsCriteria: false
		}
	}

	/**
	 * Discovers test files matching the given pattern
	 * @param pattern Test file pattern
	 * @returns Array of test file paths
	 */
	private async discoverTestFiles(pattern: string): Promise<string[]> {
		const testDir = getWorkspacePath(this.config.testDirectory)

		if (!fs.existsSync(testDir)) {
			logger.warn('Test directory does not exist', { testDir })
			return []
		}

		const files: string[] = []
		const scanDirectory = (dir: string): void => {
			try {
				const entries = fs.readdirSync(dir, { withFileTypes: true })

				for (const entry of entries) {
					const fullPath = path.join(dir, entry.name)

					if (entry.isDirectory()) {
						scanDirectory(fullPath)
					} else if (entry.isFile() && this.matchesPattern(entry.name, pattern)) {
						files.push(path.relative(testDir, fullPath))
					}
				}
			} catch (error) {
				logger.warn('Failed to scan directory', { dir, error })
			}
		}

		scanDirectory(testDir)
		return files.sort()
	}

	/**
	 * Checks if a filename matches the test pattern
	 * @param filename File name to check
	 * @param pattern Pattern to match against
	 * @returns True if filename matches pattern
	 */
	private matchesPattern(filename: string, pattern: string): boolean {
		try {
			// Simple pattern matching - could be enhanced with glob support
			const regex = pattern
				.replace(/\*\*/g, '.*')
				.replace(/\*/g, '[^/]*')
				.replace(/\./g, '\\.')

			return new RegExp(`^${regex}$`).test(filename)
		} catch (error) {
			logger.warn('Invalid pattern', { pattern, error })
			return false
		}
	}

	/**
	 * Executes tests for the given test files
	 * @param testFiles Array of test file paths
	 * @returns Array of test results
	 */
	private async executeTests(testFiles: string[]): Promise<TestResult[]> {
		const results: TestResult[] = []
		const batches = this.createTestBatches(testFiles)

		for (const batch of batches) {
			const batchResults = await Promise.all(
				batch.map(file => this.runSingleTest(file))
			)
			results.push(...batchResults)
		}

		return results
	}

	/**
	 * Creates batches of test files for parallel execution
	 * @param testFiles Array of test file paths
	 * @returns Array of test file batches
	 */
	private createTestBatches(testFiles: string[]): string[][] {
		const batches: string[][] = []
		const batchSize = Math.ceil(testFiles.length / this.config.maxParallel)

		for (let i = 0; i < testFiles.length; i += batchSize) {
			batches.push(testFiles.slice(i, i + batchSize))
		}

		return batches
	}

	/**
	 * Runs a single test file
	 * @param testFile Path to test file
	 * @returns Test result
	 */
	private async runSingleTest(testFile: string): Promise<TestResult> {
		const startTime = Date.now()
		const sanitizedFile = this.sanitizeFilePath(testFile)
		const fullPath = getWorkspacePath(path.join(this.config.testDirectory, sanitizedFile))
		const processId = `test-${Date.now()}-${Math.random()}`

		try {
			logger.debug('Running test file', { testFile: sanitizedFile })

			const output = await this.executeTestCommand(fullPath, processId)
			const result = this.parseTestOutput(sanitizedFile, output)
			result.duration = Date.now() - startTime

			logger.debug('Test completed', {
				testFile: sanitizedFile,
				status: result.status,
				duration: result.duration
			})

			return result
		} catch (error) {
			logger.error('Test execution failed', { testFile: sanitizedFile, error })

			return {
				testFile: sanitizedFile,
				status: 'error',
				duration: Date.now() - startTime,
				assertions: 0,
				failures: [{
					test: sanitizedFile,
					message: error instanceof Error ? error.message : 'Unknown error'
				}]
			}
		} finally {
			this.cleanupProcess(processId)
		}
	}
