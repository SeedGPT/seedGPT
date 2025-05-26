import { LLMTools } from '../dist/src/llmTools.js'

async function testNewLLMTools() {
	console.log('Testing new LLM Tools integration...')
	
	// Mock dependencies
	const mockBranchRecovery = {}
	const mockWorkspace = {
		getWorkspacePath: () => process.cwd(),
		runInWorkspace: async (fn) => fn()
	}
	
	const llmTools = new LLMTools(mockBranchRecovery, mockWorkspace)
	
	// Test parsing different tool requests
	const testCases = [
		'EXECUTE_SCRIPT: scripts/demo-script.js - Testing script execution',
		'RUN_TESTS: unit - Running unit tests',
		'RUN_TESTS: - Running all tests',
		'INSTALL_PACKAGE: lodash - Adding utility library',
		'BUILD_PROJECT: Compiling TypeScript changes',
		'NUKE_BRANCH: Branch is corrupted'
	]
	
	console.log('Testing tool request parsing:')
	testCases.forEach(testCase => {
		const result = llmTools.parseToolRequest(testCase)
		console.log(`Input: "${testCase}"`)
		console.log(`Parsed:`, result)
		console.log('---')
	})
	
	console.log('✅ All parsing tests completed successfully!')
}

testNewLLMTools().catch(console.error)
