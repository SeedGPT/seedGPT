import { TestFramework, TestSuite, TestCase, TestResult } from '../../src/testFramework.js'

describe('TestFramework Unit Tests', () => {
	let testFramework: TestFramework

	beforeEach(() => {
		testFramework = new TestFramework()
	})

	describe('Test Suite Registration', () => {
		it('should register a test suite successfully', () => {
			const testSuite: TestSuite = {
				name: 'Sample Test Suite',
				description: 'A sample test suite for testing',
				tests: []
			}

			testFramework.registerTestSuite(testSuite)
			const registeredSuites = testFramework.getRegisteredSuites()

			expect(registeredSuites).toContain('Sample Test Suite')
		})

		it('should handle duplicate test suite registration', () => {
			const testSuite: TestSuite = {
				name: 'Duplicate Suite',
				description: 'Testing duplicate registration',
				tests: []
			}

			testFramework.registerTestSuite(testSuite)
			expect(() => testFramework.registerTestSuite(testSuite)).toThrow('Test suite "Duplicate Suite" is already registered')
		})

		it('should validate test suite structure', () => {
			const invalidSuite = {
				name: '',
				description: 'Invalid suite',
				tests: []
			} as TestSuite

			expect(() => testFramework.registerTestSuite(invalidSuite)).toThrow('Test suite name cannot be empty')
		})
	})

	describe('Individual Test Execution', () => {
		it('should execute a successful test case', async () => {
			const testCase: TestCase = {
				name: 'successful test',
				description: 'A test that should pass',
				testFunction: async () => {
					return { success: true, message: 'Test completed successfully' }
				},
				timeout: 5000
			}

			const result = await testFramework.runSingleTest(testCase)

			expect(result.status).toBe('passed')
			expect(result.message).toBe('Test completed successfully')
			expect(result.executionTime).toBeGreaterThan(0)
			expect(result.error).toBeUndefined()
		})

		it('should handle test case failures', async () => {
			const testCase: TestCase = {
				name: 'failing test',
				description: 'A test that should fail',
				testFunction: async () => {
					throw new Error('Test failure message')
				},
				timeout: 5000
			}

			const result = await testFramework.runSingleTest(testCase)

			expect(result.status).toBe('failed')
			expect(result.error).toContain('Test failure message')
			expect(result.executionTime).toBeGreaterThan(0)
		})

		it('should handle test case timeouts', async () => {
			const testCase: TestCase = {
				name: 'timeout test',
				description: 'A test that should timeout',
				testFunction: async () => {
					await new Promise(resolve => setTimeout(resolve, 2000))
					return { success: true, message: 'Should not reach here' }
				},
				timeout: 500
			}

			const result = await testFramework.runSingleTest(testCase)

			expect(result.status).toBe('timeout')
			expect(result.error).toContain('Test timed out after 500ms')
		})
	})

	describe('Test Suite Execution', () => {
		it('should run all tests in a test suite', async () => {
			const testSuite: TestSuite = {
				name: 'Multi-Test Suite',
				description: 'Suite with multiple tests',
				tests: [
					{
						name: 'test 1',
						description: 'First test',
						testFunction: async () => ({ success: true, message: 'Test 1 passed' }),
						timeout: 5000
					},
					{
						name: 'test 2',
						description: 'Second test',
						testFunction: async () => { throw new Error('Test 2 failed') },
						timeout: 5000
					}
				]
			}

			testFramework.registerTestSuite(testSuite)
			const results = await testFramework.runTestSuite('Multi-Test Suite')

			expect(results).toHaveLength(2)
			expect(results[0].status).toBe('passed')
			expect(results[1].status).toBe('failed')
		})

		it('should execute setup and teardown hooks', async () => {
			const setupSpy = jest.fn()
			const teardownSpy = jest.fn()

			const testSuite: TestSuite = {
				name: 'Hook Test Suite',
				description: 'Testing setup and teardown hooks',
				tests: [
					{
						name: 'simple test',
						description: 'A simple test',
						testFunction: async () => ({ success: true, message: 'Test passed' }),
						timeout: 5000
					}
				],
				setup: setupSpy,
				teardown: teardownSpy
			}

			testFramework.registerTestSuite(testSuite)
			await testFramework.runTestSuite('Hook Test Suite')

			expect(setupSpy).toHaveBeenCalledTimes(1)
			expect(teardownSpy).toHaveBeenCalledTimes(1)
		})

		it('should handle setup and teardown errors gracefully', async () => {
			const failingSetup = jest.fn().mockRejectedValue(new Error('Setup failed'))
			const testSpy = jest.fn().mockResolvedValue({ success: true, message: 'Test passed' })

			const testSuite: TestSuite = {
				name: 'Failing Setup Suite',
				description: 'Testing setup failure handling',
				tests: [
					{
						name: 'test after failing setup',
						description: 'Test that should not run due to setup failure',
						testFunction: testSpy,
						timeout: 5000
					}
				],
				setup: failingSetup
			}

			testFramework.registerTestSuite(testSuite)
			const results = await testFramework.runTestSuite('Failing Setup Suite')

			expect(failingSetup).toHaveBeenCalledTimes(1)
			expect(testSpy).not.toHaveBeenCalled()
			expect(results[0].status).toBe('failed')
			expect(results[0].error).toContain('Setup failed')
		})
	})

	describe('Coverage Analysis', () => {
		it('should calculate coverage metrics', () => {
			const mockCoverageData = {
				statements: { covered: 80, total: 100 },
				functions: { covered: 15, total: 20 },
				branches: { covered: 40, total: 60 },
				lines: { covered: 75, total: 90 }
			}

			const coverage = testFramework.calculateCoverage(mockCoverageData)

			expect(coverage.statements.percentage).toBe(80)
			expect(coverage.functions.percentage).toBe(75)
			expect(coverage.branches.percentage).toBeCloseTo(66.67, 2)
			expect(coverage.lines.percentage).toBeCloseTo(83.33, 2)
		})

		it('should handle zero coverage gracefully', () => {
			const zeroCoverageData = {
				statements: { covered: 0, total: 0 },
				functions: { covered: 0, total: 0 },
				branches: { covered: 0, total: 0 },
				lines: { covered: 0, total: 0 }
			}

			const coverage = testFramework.calculateCoverage(zeroCoverageData)

			expect(coverage.statements.percentage).toBe(0)
			expect(coverage.functions.percentage).toBe(0)
			expect(coverage.branches.percentage).toBe(0)
			expect(coverage.lines.percentage).toBe(0)
		})
	})

	describe('Test Filtering', () => {
		it('should filter tests by tags', async () => {
