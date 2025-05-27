import { TestFramework, TestSuite, TestCase, TestResult } from '../../src/testFramework.js'
import fs from 'fs'
import path from 'path'

describe('TestFramework Integration Tests', () => {
	let testFramework: TestFramework
	let tempTestDir: string
	let consoleSpy: jest.SpyInstance

	beforeEach(() => {
		testFramework = new TestFramework()
		tempTestDir = path.join(process.cwd(), 'temp-test-output')
		consoleSpy = jest.spyOn(console, 'log').mockImplementation()

		// Clean up any existing temp directory
		if (fs.existsSync(tempTestDir)) {
			fs.rmSync(tempTestDir, { recursive: true, force: true })
		}
		fs.mkdirSync(tempTestDir, { recursive: true })
	})

	afterEach(() => {
		consoleSpy.mockRestore()
		// Clean up temp directory
		if (fs.existsSync(tempTestDir)) {
			fs.rmSync(tempTestDir, { recursive: true, force: true })
		}
	})

	describe('End-to-End Test Execution', () => {
		it('should execute complete test suite with coverage reporting', async () => {
			// Create a comprehensive test suite
			const testSuite: TestSuite = {
				name: 'Integration Test Suite',
				description: 'Comprehensive integration testing',
				tests: [
					{
						name: 'successful test',
						description: 'Test that should pass',
						testFunction: async () => {
							return { success: true, message: 'Test passed' }
						},
						timeout: 5000,
						tags: ['integration', 'success']
					},
					{
						name: 'failing test',
						description: 'Test that should fail',
						testFunction: async () => {
							throw new Error('Intentional test failure')
						},
						timeout: 5000,
						tags: ['integration', 'failure']
					},
					{
						name: 'timeout test',
						description: 'Test that should timeout',
						testFunction: async () => {
							await new Promise(resolve => setTimeout(resolve, 6000))
							return { success: true, message: 'Should not reach here' }
						},
						timeout: 1000,
						tags: ['integration', 'timeout']
					}
				],
				setup: async () => {
					// Test suite setup - no console output in tests
				},
				teardown: async () => {
					// Test suite teardown - no console output in tests
				}
			}

			// Register and run the test suite
			testFramework.registerTestSuite(testSuite)
			const results = await testFramework.runAllTests()

			// Verify results structure
			expect(results).toHaveProperty('summary')
			expect(results).toHaveProperty('testResults')
			expect(results).toHaveProperty('coverage')
			expect(results).toHaveProperty('executionTime')

			// Verify summary statistics
			expect(results.summary.totalTests).toBe(3)
			expect(results.summary.passed).toBe(1)
			expect(results.summary.failed).toBe(1)
			expect(results.summary.timedOut).toBe(1)
			expect(results.summary.successRate).toBeCloseTo(33.33, 1)

			// Verify individual test results
			const testResults = results.testResults['Integration Test Suite']
			expect(testResults).toHaveLength(3)

			const successTest = testResults.find(r => r.testName === 'successful test')
			expect(successTest?.status).toBe('passed')
			expect(successTest?.message).toBe('Test passed')

			const failingTest = testResults.find(r => r.testName === 'failing test')
			expect(failingTest?.status).toBe('failed')
			expect(failingTest?.error).toContain('Intentional test failure')

			const timeoutTest = testResults.find(r => r.testName === 'timeout test')
			expect(timeoutTest?.status).toBe('timeout')
		})

		it('should generate comprehensive coverage report', async () => {
			const reportPath = path.join(tempTestDir, 'coverage-report.html')

			// Mock coverage data for testing
			const mockCoverage = {
				statements: { covered: 150, total: 200, percentage: 75 },
				functions: { covered: 45, total: 60, percentage: 75 },
				branches: { covered: 80, total: 120, percentage: 66.67 },
				lines: { covered: 140, total: 180, percentage: 77.78 }
			}

			await testFramework.generateCoverageReport(mockCoverage, reportPath)

			// Verify report file was created
			expect(fs.existsSync(reportPath)).toBe(true)

			// Verify report content structure and key metrics
			const reportContent = fs.readFileSync(reportPath, 'utf-8')
			expect(reportContent).toContain('Test Coverage Report')
			expect(reportContent).toContain('75.00%')
			expect(reportContent).toContain('66.67%')
			expect(reportContent).toContain('Coverage Summary')
			expect(reportContent).toContain('Statements')
			expect(reportContent).toContain('Functions')
