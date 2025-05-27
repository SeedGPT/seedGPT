import fs from 'fs/promises'
import path from 'path'
import { spawn } from 'child_process'
import { promisify } from 'util'

import logger from './logger.js'
import { WorkspaceManager } from './workspaceManager.js'

/**
 * Configuration for test execution
 */
export interface TestConfig {
	/** Root directory for test files */
	testDirectory: string
	/** Pattern to match test files */
	testPattern: string
	/** Timeout for individual tests in milliseconds */
	testTimeout: number
	/** Coverage threshold percentages */
	coverageThresholds: {
		statements: number
		branches: number
		functions: number
		lines: number
	}
	/** Jest configuration overrides */
	jestConfig?: Record<string, any>
}

/**
 * Results from test execution
 */
export interface TestResults {
	/** Whether all tests passed */
	success: boolean
	/** Total number of tests run */
	totalTests: number
	/** Number of passed tests */
	passedTests: number
	/** Number of failed tests */
	failedTests: number
	/** Number of skipped tests */
	skippedTests: number
	/** Execution time in milliseconds */
	duration: number
	/** Coverage information */
	coverage?: CoverageReport
	/** Error details if tests failed */
	errors: string[]
}

/**
 * Test coverage report structure
 */
export interface CoverageReport {
	/** Statement coverage percentage */
	statements: number
	/** Branch coverage percentage */
	branches: number
	/** Function coverage percentage */
	functions: number
	/** Line coverage percentage */
	lines: number
	/** Per-file coverage details */
	files: Record<string, FileCoverage>
}

/**
 * Coverage information for a single file
 */
export interface FileCoverage {
	statements: number
	branches: number
	functions: number
	lines: number
	uncoveredLines: number[]
}

/**
 * Automated testing framework with comprehensive test execution and coverage reporting
 */
export class TestFramework {
	private config: TestConfig
	private workspaceManager: WorkspaceManager

	/**
	 * Initialize the test framework
	 * @param workspaceManager Workspace manager instance
	 * @param config Test configuration
	 */
	constructor(workspaceManager: WorkspaceManager, config: TestConfig) {
		this.workspaceManager = workspaceManager
		this.config = config

		logger.debug('TestFramework initialized', {
			testDirectory: config.testDirectory,
			testPattern: config.testPattern
		})
	}

	/**
	 * Run all tests with coverage reporting
	 * @param pattern Optional pattern to filter tests
	 * @returns Test execution results
	 */
	async runTests(pattern?: string): Promise<TestResults> {
		const startTime = Date.now()
		logger.info('Starting test execution', { pattern })

		try {
			// Ensure test environment is properly set up
			await this.setupTestEnvironment()

			// Execute tests with Jest
			const results = await this.executeJestTests(pattern)

			// Generate coverage report
			const coverage = await this.generateCoverageReport()

			const finalResults: TestResults = {
				...results,
				coverage,
				duration: Date.now() - startTime
			}

			logger.info('Test execution completed', {
				success: finalResults.success,
				totalTests: finalResults.totalTests,
				passedTests: finalResults.passedTests,
				failedTests: finalResults.failedTests,
				duration: finalResults.duration
			})

			return finalResults
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : 'Unknown error'
			logger.error('Test execution failed', { error: errorMessage })

			return {
				success: false,
				totalTests: 0,
				passedTests: 0,
				failedTests: 0,
				skippedTests: 0,
				duration: Date.now() - startTime,
				errors: [errorMessage]
			}
		}
	}

	/**
	 * Run unit tests specifically
	 * @returns Unit test results
	 */
	async runUnitTests(): Promise<TestResults> {
		logger.info('Running unit tests')
		return this.runTests('unit')
	}

	/**
	 * Run integration tests specifically
	 * @returns Integration test results
	 */
	async runIntegrationTests(): Promise<TestResults> {
		logger.info('Running integration tests')
		return this.runTests('integration')
	}

	/**
	 * Validate coverage meets minimum thresholds
	 * @param coverage Coverage report to validate
	 * @returns Whether coverage meets thresholds
	 */
	validateCoverage(coverage: CoverageReport): boolean {
		const { coverageThresholds } = this.config

		const meetsThresholds =
			coverage.statements >= coverageThresholds.statements &&
			coverage.branches >= coverageThresholds.branches &&
			coverage.functions >= coverageThresholds.functions &&
			coverage.lines >= coverageThresholds.lines

		logger.debug('Coverage validation', {
			meetsThresholds,
			actual: {
				statements: coverage.statements,
				branches: coverage.branches,
				functions: coverage.functions,
				lines: coverage.lines
			},
			required: coverageThresholds
		})

		return meetsThresholds
	}

	/**
	 * Set up test environment and dependencies
	 */
	private async setupTestEnvironment(): Promise<void> {
		logger.debug('Setting up test environment')

		try {
			// Ensure test directory exists
			const testDir = this.workspaceManager.getWorkspaceFilePath(this.config.testDirectory)
			await fs.mkdir(testDir, { recursive: true })

			// Check for Jest configuration
			const jestConfigPath = this.workspaceManager.getWorkspaceFilePath('jest.config.js')
			const jestConfigExists = await fs.access(jestConfigPath).then(() => true).catch(() => false)

			if (!jestConfigExists) {
				logger.warn('Jest configuration not found, using defaults')
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : 'Unknown error'
			throw new Error(`Failed to setup test environment: ${errorMessage}`)
		}
	}

	/**
	 * Execute Jest tests and parse results
	 * @param pattern Optional test pattern filter
	 * @returns Parsed test results
	 */
	private async executeJestTests(pattern?: string): Promise<Omit<TestResults, 'duration' | 'coverage'>> {
		const jestArgs = [
			'--json',
			'--coverage',
			'--passWithNoTests'
		]

		if (pattern) {
			jestArgs.push('--testNamePattern', pattern)
		}

		const workingDirectory = this.workspaceManager.getWorkspacePath()

		try {
			const output = await this.runCommand('npx', ['jest', ...jestArgs], workingDirectory)
			return this.parseJestOutput(output)
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : 'Unknown error'
			throw new Error(`Jest execution failed: ${errorMessage}`)
		}
	}

	/**
	 * Parse Jest JSON output into standardized results
	 * @param output Raw Jest output
	 * @returns Parsed test results
	 */
	private parseJestOutput(output: string): Omit<TestResults, 'duration' | 'coverage'> {
		try {
			const jestResults = JSON.parse(output)

			return {
				success: jestResults.success || false,
				totalTests: jestResults.numTotalTests || 0,
				passedTests: jestResults.numPassedTests || 0,
				failedTests: jestResults.numFailedTests || 0,
				skippedTests: jestResults.numPendingTests || 0,
				errors: jestResults.testResults?.flatMap((test: any) =>
					test.message ? [test.message] : []
				) || []
			}
		} catch (error) {
			throw new Error(`Failed to parse Jest output: ${output}`)
		}
	}

	/**
	 * Generate and parse coverage report
	 * @returns Coverage report data
	 */
	private async generateCoverageReport(): Promise<CoverageReport | undefined> {
		const coverageFile = this.workspaceManager.getWorkspaceFilePath('coverage/coverage-summary.json')

		try {
			const coverageData = await fs.readFile(coverageFile, 'utf-8')
			const coverage = JSON.parse(coverageData)

			return {
				statements: coverage.total?.statements?.pct || 0,
				branches: coverage.total?.branches?.pct || 0,
				functions: coverage.total?.functions?.pct || 0,
				lines: coverage.total?.lines?.pct || 0,
				files: this.parseCoverageFiles(coverage)
			}
		} catch (error) {
			logger.warn('Failed to read coverage report', { error: error instanceof Error ? error.message : 'Unknown error' })
			return undefined
		}
	}

	/**
	 * Parse per-file coverage data
	 * @param coverage Raw coverage data
	 * @returns Per-file coverage information
	 */
	private parseCoverageFiles(coverage: any): Record<string, FileCoverage> {
		const files: Record<string, FileCoverage> = {}

		for (const [filePath, fileData] of Object.entries(coverage)) {
			if (filePath === 'total') continue

			const data = fileData as any
			files[filePath] = {
				statements: data.statements?.pct || 0,
				branches: data.branches?.pct || 0,
				functions: data.functions?.pct || 0,
				lines: data.lines?.pct || 0,
				uncoveredLines: data.lines?.uncoveredLines || []
			}
		}

		return files
	}

	/**
	 * Execute a command and return its output
	 * @param command Command to execute
	 * @param args Command arguments
	 * @param cwd Working directory
	 * @returns Command output
	 */
	private async runCommand(command: string, args: string[], cwd: string): Promise<string> {
		return new Promise((resolve, reject) => {
			const process = spawn(command, args, { cwd, stdio: 'pipe' })
			let output = ''
			let errorOutput = ''

			process.stdout?.on('data', (data) => {
				output += data.toString()
			})

			process.stderr?.on('data', (data) => {
				errorOutput += data.toString()
			})

			process.on('close', (code) => {
				if (code === 0) {
					resolve(output)
				} else {
					reject(new Error(`Command failed with code ${code}: ${errorOutput}`))
				}
			})

			process.on('error', reject)
		})
	}
}
