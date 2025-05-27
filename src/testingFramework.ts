import { spawn, ChildProcess } from 'child_process'
import { promises as fs } from 'fs'
import { join } from 'path'
import { WorkspaceManager } from './workspaceManager.js'
import { Logger } from './logger.js'

export interface TestResult {
	name: string
	status: 'passed' | 'failed' | 'skipped'
	duration: number
	error?: string
	file: string
}

export interface TestSuite {
	name: string
	tests: TestResult[]
	totalTests: number
	passedTests: number
	failedTests: number
	skippedTests: number
	duration: number
	coverageReport?: CoverageReport
}

export interface CoverageReport {
	totalLines: number
	coveredLines: number
	totalFunctions: number
	coveredFunctions: number
	totalBranches: number
	coveredBranches: number
	totalStatements: number
	coveredStatements: number
	percentage: {
		lines: number
		functions: number
		branches: number
		statements: number
	}
	files: CoverageFileReport[]
}

export interface CoverageFileReport {
	path: string
	lines: { covered: number; total: number }
	functions: { covered: number; total: number }
	branches: { covered: number; total: number }
	statements: { covered: number; total: number }
	percentage: number
}

export interface TestConfiguration {
	testPattern: string
	coverageThreshold: {
		lines: number
		functions: number
		branches: number
		statements: number
	}
	timeout: number
	parallel: boolean
	maxWorkers?: number
	setupFiles?: string[]
	teardownFiles?: string[]
	testEnvironment: 'node' | 'jsdom'
	collectCoverageFrom: string[]
	coverageDirectory: string
}

export interface TestExecutionOptions {
	pattern?: string
	coverage?: boolean
	watch?: boolean
	verbose?: boolean
	bail?: boolean
	maxWorkers?: number
	timeout?: number
}

interface JestTestResult {
	ancestorTitles: string[]
	title: string
	status: 'passed' | 'failed' | 'skipped' | 'pending' | 'todo' | 'disabled'
	duration: number
	failureMessages: string[]
	location?: {
		line: number
		column: number
	}
}

interface JestTestSuiteResult {
	testFilePath: string
	testResults: JestTestResult[]
	perfStats: {
		start: number
		end: number
	}
}

interface JestOutput {
	success: boolean
	numTotalTests: number
	numPassedTests: number
	numFailedTests: number
	numPendingTests: number
	testResults: JestTestSuiteResult[]
}

/**
 * Automated testing framework for running unit tests, integration tests, and generating coverage reports.
 * Provides comprehensive test execution with coverage analysis and threshold validation.
 */
export class TestingFramework {
	private readonly logger: Logger
	private readonly workspace: WorkspaceManager
	private readonly config: TestConfiguration
	private runningProcess: ChildProcess | null = null
	private isRunning = false

	constructor(workspace: WorkspaceManager, config?: Partial<TestConfiguration>) {
		this.logger = Logger.getInstance()
		this.workspace = workspace
		this.config = this.createDefaultConfig(config)
		this.validateConfiguration(this.config)
	}

	/**
	 * Creates default test configuration with optional overrides
	 */
	private createDefaultConfig(overrides?: Partial<TestConfiguration>): TestConfiguration {
		const defaults: TestConfiguration = {
			testPattern: '**/dist/**/*.test.js',
			coverageThreshold: {
				lines: 80,
				functions: 80,
				branches: 70,
				statements: 80
			},
			timeout: 10000,
			parallel: true,
			maxWorkers: 4,
			testEnvironment: 'node',
			collectCoverageFrom: [
				'dist/**/*.js',
				'!dist/**/*.test.js',
				'!dist/**/*.d.ts',
				'!dist/index.js'
			],
			coverageDirectory: 'coverage'
		}

		return { ...defaults, ...overrides }
	}

	/**
	 * Validates test configuration for proper values and constraints
	 */
	private validateConfiguration(config: TestConfiguration): void {
		if (!config.testPattern?.trim()) {
			throw new Error('Test pattern cannot be empty')
		}

		if (config.timeout <= 0) {
			throw new Error('Timeout must be positive')
		}

		if (config.maxWorkers && config.maxWorkers <= 0) {
			throw new Error('Max workers must be positive')
		}

		// Validate coverage thresholds
		const { coverageThreshold } = config
		for (const [key, value] of Object.entries(coverageThreshold)) {
			if (value < 0 || value > 100) {
				throw new Error(`Coverage threshold ${key} must be between 0 and 100, got ${value}`)
			}
		}
	}

	/**
	 * Runs the complete test suite with optional coverage reporting
	 */
	async runTests(options: TestExecutionOptions = {}): Promise<TestSuite> {
		this.logger.info('Starting test execution', {
			options,
			config: this.getLoggableConfig()
		})

		if (this.isRunning) {
			throw new Error('Tests are already running')
		}

		const startTime = performance.now()

		try {
			this.isRunning = true
			await this.ensureTestEnvironment()

			const testResults = await this.executeTests(options)
			const duration = performance.now() - startTime

			let coverageReport: CoverageReport | undefined
			if (options.coverage !== false) {
				try {
					coverageReport = await this.generateCoverageReport()
					await this.validateCoverageThresholds(coverageReport)
				} catch (coverageError) {
					this.logger.warn('Coverage analysis failed', {
						error: this.formatError(coverageError)
					})
				}
			}

			const testSuite: TestSuite = {
				name: 'Test Suite',
				tests: testResults,
				totalTests: testResults.length,
				passedTests: testResults.filter(t => t.status === 'passed').length,
				failedTests: testResults.filter(t => t.status === 'failed').length,
				skippedTests: testResults.filter(t => t.status === 'skipped').length,
				duration,
				coverageReport
			}

			this.logger.info('Test execution completed', {
				totalTests: testSuite.totalTests,
				passed: testSuite.passedTests,
				failed: testSuite.failedTests,
				skipped: testSuite.skippedTests,
				duration: Math.round(testSuite.duration),
				coveragePercentage: coverageReport?.percentage.lines,
				successRate: testSuite.totalTests > 0 ?
					Math.round((testSuite.passedTests / testSuite.totalTests) * 100) : 0
			})

			return testSuite
		} catch (error) {
			this.logger.error('Test execution failed', {
				error: this.formatError(error),
				duration: Math.round(performance.now() - startTime)
			})
			throw new Error(`Test execution failed: ${this.formatError(error)}`)
		} finally {
			this.isRunning = false
		}
	}

	/**
	 * Runs unit tests specifically with optimized configuration
	 */
	async runUnitTests(options: TestExecutionOptions = {}): Promise<TestSuite> {
		this.logger.info('Running unit tests with specific pattern')
		return this.runTests({
			...options,
			pattern: options.pattern || '**/*.unit.test.js'
		})
	}

	/**
	 * Runs integration tests specifically with extended timeout
	 */
	async runIntegrationTests(options: TestExecutionOptions = {}): Promise<TestSuite> {
		this.logger.info('Running integration tests with extended timeout')
		return this.runTests({
			...options,
			pattern: options.pattern || '**/*.integration.test.js',
			timeout: options.timeout || this.config.timeout * 3
		})
	}

	/**
	 * Generates comprehensive coverage report from Jest coverage data
	 */
	async generateCoverageReport(): Promise<CoverageReport> {
		this.logger.info('Generating coverage report')

		try {
			const coverageFile = join(this.workspace.getWorkspaceRoot(),
				this.config.coverageDirectory, 'coverage-final.json')

			const coverageExists = await this.fileExists(coverageFile)

			if (!coverageExists) {
				this.logger.warn('Coverage file not found, running tests with coverage')
				await this.executeTests({ coverage: true })
			}

			const coverageData = await this.parseCoverageData(coverageFile)
			const report = this.processCoverageData(coverageData)

			this.logger.info('Coverage report generated', {
				totalFiles: report.files.length,
				overallCoverage: report.percentage
			})

			return report
		} catch (error) {
			this.logger.error('Failed to generate coverage report', {
				error: this.formatError(error)
			})
			throw new Error(`Coverage report generation failed: ${this.formatError(error)}`)
		}
	}

	/**
	 * Validates that coverage meets configured thresholds
	 */
	async validateCoverageThresholds(coverageReport: CoverageReport): Promise<void> {
		const { percentage } = coverageReport
		const { coverageThreshold } = this.config
		const failures: string[] = []

		const checkThreshold = (type: string, actual: number, required: number) => {
			if (actual < required) {
				failures.push(`${type} coverage ${actual.toFixed(1)}% below threshold ${required}%`)
			}
		}

		checkThreshold('Lines', percentage.lines, coverageThreshold.lines)
		checkThreshold('Functions', percentage.functions, coverageThreshold.functions)
		checkThreshold('Branches', percentage.branches, coverageThreshold.branches)
		checkThreshold('Statements', percentage.statements, coverageThreshold.statements)

		if (failures.length > 0) {
			this.logger.error('Coverage thresholds not met', { failures, actual: percentage })
			throw new Error(`Coverage thresholds not met:\n${failures.join('\n')}`)
		}

		this.logger.info('Coverage thresholds met', { percentage })
	}

	/**
	 * Watches for file changes and runs tests automatically
	 */
	async watchTests(options: TestExecutionOptions = {}): Promise<void> {
		this.logger.info('Starting test watch mode')

		if (this.isRunning) {
			throw new Error('Tests are already running')
		}

		try {
			this.isRunning = true
			await this.executeTestsInWatchMode({ ...options, watch: true })
		} catch (error) {
			this.logger.error('Test watch mode failed', {
				error: this.formatError(error)
			})
			throw new Error(`Test watch mode failed: ${this.formatError(error)}`)
		} finally {
			this.isRunning = false
		}
	}

	/**
	 * Stops any running test processes gracefully
	 */
	async stopTests(): Promise<void> {
		if (this.runningProcess) {
			this.logger.info('Stopping running test process')

			return new Promise((resolve) => {
				if (!this.runningProcess) {
					resolve()
					return
				}

				const timeout = setTimeout(() => {
					this.logger.warn('Force killing test process after timeout')
					this.runningProcess?.kill('SIGKILL')
					this.runningProcess = null
					this.isRunning = false
					resolve()
				}, 5000)

				this.runningProcess.on('close', () => {
					clearTimeout(timeout)
					this.runningProcess = null
					this.isRunning = false
					resolve()
				})

				this.runningProcess.kill('SIGTERM')
			})
		}
	}

	/**
	 * Ensures test environment is properly configured and ready
	 */
	private async ensureTestEnvironment(): Promise<void> {
		const workspaceRoot = this.workspace.getWorkspaceRoot()

		// Ensure coverage directory exists
		const coverageDir = join(workspaceRoot, this.config.coverageDirectory)
		await fs.mkdir(coverageDir, { recursive: true })

		// Verify Jest configuration exists
		const jestConfigPath = join(workspaceRoot, 'jest.config.js')
		const jestConfigExists = await this.fileExists(jestConfigPath)

		if (!jestConfigExists) {
			this.logger.warn('Jest configuration not found, creating default config')
			await this.createDefaultJestConfig(jestConfigPath)
		}

		// Verify Jest is available
		await this.verifyJestAvailability(workspaceRoot)
	}

	/**
	 * Verifies that Jest is installed and accessible
	 */
	private async verifyJestAvailability(workspaceRoot: string): Promise<void> {
		try {
			await new Promise<void>((resolve, reject) => {
				const process = spawn('npx', ['jest', '--version'], {
					cwd: workspaceRoot,
					stdio: 'pipe'
				})

				process.on('close', (code) => {
					if (code === 0) {
						resolve()
					} else {
						reject(new Error(`Jest not available (exit code: ${code})`))
					}
				})

				process.on('error', (error
