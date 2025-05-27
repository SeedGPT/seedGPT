import { spawn, ChildProcess } from 'child_process'
import { promises as fs } from 'fs'
import { join, relative, resolve, normalize } from 'path'
import { logger } from './logger.js'

/**
 * Test execution results for a single test file or suite
 */
export interface TestResult {
	file: string
	passed: number
	failed: number
	skipped: number
	duration: number
	coverage?: CoverageReport
	errors: TestError[]
}

/**
 * Individual test error information
 */
export interface TestError {
	test: string
	message: string
	stack?: string
}

/**
 * Code coverage report for a file or overall project
 */
export interface CoverageReport {
	statements: CoverageMetric
	branches: CoverageMetric
	functions: CoverageMetric
	lines: CoverageMetric
	files: FileCoverage[]
}

/**
 * Coverage metrics with percentage and counts
 */
export interface CoverageMetric {
	total: number
	covered: number
	percentage: number
}

/**
 * Per-file coverage information
 */
export interface FileCoverage {
	path: string
	statements: CoverageMetric
	branches: CoverageMetric
	functions: CoverageMetric
	lines: CoverageMetric
	uncoveredLines: number[]
}

/**
 * Test framework configuration options
 */
export interface TestConfig {
	testPattern?: string
	coverageThreshold?: number
	timeout?: number
	setupFiles?: string[]
	testEnvironment?: 'node' | 'jsdom'
	collectCoverageFrom?: string[]
	coverageDirectory?: string
	verbose?: boolean
}

/**
 * Test suite execution summary
 */
export interface TestSuite {
	name: string
	results: TestResult[]
	totalDuration: number
	overallCoverage?: CoverageReport
	success: boolean
	summary: {
		totalTests: number
		passed: number
		failed: number
		skipped: number
	}
}

/**
 * Automated testing framework that manages unit tests, integration tests,
 * and provides comprehensive test coverage reporting
 */
export class TestFramework {
	private config: TestConfig
	private workspaceRoot: string

	constructor(workspaceRoot: string, config: TestConfig = {}) {
		this.workspaceRoot = resolve(workspaceRoot)
		this.config = {
			testPattern: '**/*.test.{js,ts}',
			coverageThreshold: 80,
			timeout: 30000,
			testEnvironment: 'node',
			coverageDirectory: 'coverage',
			verbose: false,
			...config
		}

		logger.info('Test framework initialized', {
			workspaceRoot: this.workspaceRoot,
			config: this.config
		})
	}

	/**
	 * Run all tests with coverage reporting
	 * @param pattern Optional test pattern to filter tests
	 * @returns Complete test suite results
	 */
	async runAllTests(pattern?: string): Promise<TestSuite> {
		const startTime = Date.now()
		logger.info('Starting test suite execution', { pattern })

		try {
			const testFiles = await this.discoverTestFiles(pattern)
			if (testFiles.length === 0) {
				logger.warn('No test files found', { pattern, workspaceRoot: this.workspaceRoot })
				return this.createEmptyTestSuite()
			}

			const results: TestResult[] = []
			for (const testFile of testFiles) {
				const result = await this.runTestFile(testFile)
				results.push(result)
			}

			const overallCoverage = await this.generateCoverageReport()
			const suite = this.buildTestSuite(results, overallCoverage, Date.now() - startTime)

			await this.validateCoverageThresholds(overallCoverage)
			logger.info('Test suite completed', {
				duration: suite.totalDuration,
				success: suite.success,
				summary: suite.summary
			})

			return suite
		} catch (error) {
			logger.error('Test suite execution failed', { error: error instanceof Error ? error.message : String(error) })
			throw new Error(`Test execution failed: ${error instanceof Error ? error.message : String(error)}`)
		}
	}

	/**
	 * Run unit tests specifically (excluding integration tests)
	 * @returns Unit test results
	 */
	async runUnitTests(): Promise<TestSuite> {
		logger.info('Running unit tests only')
		return this.runAllTests('**/unit/**/*.test.{js,ts}')
	}

	/**
	 * Run integration tests specifically
	 * @returns Integration test results
	 */
	async runIntegrationTests(): Promise<TestSuite> {
		logger.info('Running integration tests only')
		return this.runAllTests('**/integration/**/*.test.{js,ts}')
	}

	/**
	 * Generate and save coverage report to configured directory
	 * @param format Output format(s) for coverage report
	 * @returns Generated coverage report
	 */
	async generateCoverageReport(format: string[] = ['html', 'lcov', 'text']): Promise<CoverageReport> {
		logger.info('Generating coverage report', { format })

		try {
			const coverage = await this.executeCoverageCollection()
			await this.saveCoverageReport(coverage, format)

			logger.info('Coverage report generated successfully', {
				directory: this.config.coverageDirectory,
				overall: coverage.statements.percentage
			})

			return coverage
		} catch (error) {
			logger.error('Coverage report generation failed', { error: error instanceof Error ? error.message : String(error) })
			throw new Error(`Coverage generation failed: ${error instanceof Error ? error.message : String(error)}`)
		}
	}

	/**
	 * Discover test files based on pattern using recursive directory traversal
	 * Supports glob-like patterns including ** for subdirectories
	 * @param pattern Optional pattern override
	 * @returns Array of test file paths sorted alphabetically
	 */
	private async discoverTestFiles(pattern?: string): Promise<string[]> {
		const searchPattern = pattern || this.config.testPattern!
		logger.debug('Discovering test files', { pattern: searchPattern })

		try {
			const testFiles: string[] = []
			await this.walkDirectory(this.workspaceRoot, searchPattern, testFiles)

			logger.debug('Test files discovered', { count: testFiles.length, files: testFiles })
			return testFiles.sort()
		} catch (error) {
			throw new Error(`Test discovery failed: ${error instanceof Error ? error.message : String(error)}`)
		}
	}

	/**
	 * Execute a single test file with timeout and error handling
	 * @param testFile Path to test file
	 * @returns Test results for the file
	 */
	private async runTestFile(testFile: string): Promise<TestResult> {
		const startTime = Date.now()
		logger.debug('Running test file', { testFile })

		try {
			const result = await this.executeJestForFile(testFile)
			const duration = Date.now() - startTime

			logger.debug('Test file completed', {
				testFile,
				duration,
				passed: result.passed,
				failed: result.failed
			})

			return {
				...result,
				file: testFile,
				duration
			}
		} catch (error) {
			logger.error('Test file execution failed', { testFile, error: error instanceof Error ? error.message : String(error) })
			return {
				file: testFile,
				passed: 0,
				failed: 1,
				skipped: 0,
				duration: Date.now() - startTime,
				errors: [{
					test: 'file execution',
					message: error instanceof Error ? error.message : String(error)
				}]
			}
		}
	}

	/**
	 * Execute Jest for a specific test file with security validation and timeout handling
	 * Validates file path to prevent command injection and implements process timeout
	 * @param testFile Path to test file - validated for security
	 * @returns Parsed test results excluding file path and duration
	 */
	private async executeJestForFile(testFile: string): Promise<Omit<TestResult, 'file' | 'duration'>> {
		// Security: Validate and sanitize test file path to prevent command injection
		const normalizedPath = normalize(testFile)
		if (!this.isValidTestFilePath(normalizedPath)) {
			throw new Error(`Invalid test file path: ${testFile}`)
		}

		return new Promise((resolve, reject) => {
			const jestArgs = [
				'--testPathPattern', normalizedPath,
				'--json',
				'--silent'
			]

			const jest = spawn('npx', ['jest', ...jestArgs], {
				cwd: this.workspaceRoot,
				stdio: ['ignore', 'pipe', 'pipe']
			})

			let stdout = ''
			let stderr = ''

			// Implement timeout to prevent hanging processes
			const timeout = setTimeout(() => {
				logger.warn('Jest process timed out, killing', { testFile, timeout: this.config.timeout })
				jest.kill('SIGTERM')
				reject(new Error(`Jest execution timed out after ${this.config.timeout}ms`))
			}, this.config.timeout)

			jest.stdout?.on('data', (data) => { stdout += data.toString() })
			jest.stderr?.on('data', (data) => { stderr += data.toString() })

			jest.on('close', (code) => {
				clearTimeout(timeout)
				try {
					if (stdout.trim()) {
						const result = this.parseJestOutput(stdout)
						resolve(result)
					} else {
						reject(new Error(`Jest execution failed: ${stderr || 'No output received'}`))
					}
				} catch (error) {
					reject(new Error(`Failed to parse Jest output: ${error instanceof Error ? error.message : String(error)}`))
				}
			})

			jest.on('error', (error) => {
				clearTimeout(timeout)
				reject(new Error(`Jest process error: ${error.message}`))
			})
		})
	}

	/**
	 * Validate test file path for security - prevents command injection
	 * @param filePath Path to validate
	 * @returns True if path is safe to use
	 */
	private isValidTestFilePath(filePath: string): boolean {
		// Allow only alphanumeric, dots, hyphens, underscores, and path separators
		const safePathRegex = /^[a-zA-Z0-9._/-]+$/
		return safePathRegex.test(filePath) &&
			   !filePath.includes('..') &&
			   !filePath.includes(';') &&
			   !filePath.includes('|') &&
			   !filePath.includes('&')
	}

	/**
	 * Parse Jest JSON output with robust error handling for partial/malformed JSON
	 * Handles cases where Jest process was terminated mid-execution
	 */
	private parseJestOutput(output: string): Omit<TestResult, 'file' | 'duration'> {
		try {
			const jestOutput = JSON.parse(output)
			return this.parseJestResult(jestOutput)
		} catch (error) {
			// Handle partial JSON output from terminated processes
			logger.warn('Failed to parse Jest JSON output, attempting recovery', { error: error instanceof Error ? error.message : String(error) })

			// Try to extract any useful information from partial output
			if (output.includes('"numPassedTests"') || output.includes('"numFailedTests"')) {
				// Attempt to parse partial results
				try {
					const partialMatch = output.match(/\{.*\}/s)
					if (partialMatch) {
						const partialOutput = JSON.parse(partialMatch[0])
						return this.parseJestResult(partialOutput)
					}
				} catch {
					// Fall through to default error response
				}
			}

			throw new Error(`Invalid Jest JSON output: ${error instanceof Error ? error.message : String(error)}`)
		}
	}

	/**
	 * Parse Jest JSON output into TestResult format with null safety
	 */
	private parseJestResult(jestOutput: any): Omit<TestResult, 'file' | 'duration'> {
		const testResults = jestOutput.testResults?.[0] || {}
		const assertionResults = testResults.assertionResults || []

		const passed = assertionResults.filter((r: any) => r.status === 'passed').length
		const failed = assertionResults.filter((r: any) => r.status === 'failed').length
		const skipped = assertionResults.filter((r: any) => r.status === 'pending' || r.status === 'disabled').length

		const errors: TestError[] = assertionResults
			.filter((r: any) => r.status === 'failed')
			.map((r: any) => ({
				test: r.title || r.fullName || 'unknown',
				message: r.failureMessages?.[0] || 'Test failed',
				stack: r.failureMessages?.join('\n')
