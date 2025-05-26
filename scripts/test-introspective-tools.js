#!/usr/bin/env node

/**
 * Test script for new introspective LLM tools
 */

import { LLMTools } from '../dist/src/llmTools.js'
import { BranchRecoveryManager } from '../dist/src/branchRecoveryManager.js'
import { WorkspaceManager } from '../dist/src/workspaceManager.js'
import SimpleGit from 'simple-git'

console.log('Testing introspective LLM tools...')

const git = SimpleGit()
const mockCfg = {
    workingDirectory: './workspace',
    git: { remoteName: 'origin', mainBranch: 'main' }
}

const workspaceManager = new WorkspaceManager(git, mockCfg)
const branchRecovery = new BranchRecoveryManager(workspaceManager)
const llmTools = new LLMTools(branchRecovery, workspaceManager)

async function testIntrospectiveTools() {
    console.log('\n=== Testing Introspective Tool Parsing ===')
    
    const testCases = [
        'SEARCH_CODEBASE: logger - Looking for logging patterns',
        'ANALYZE_CAPABILITIES: I need to understand my current state',
        'INSPECT_STRUCTURE: src/llmTools.ts - Analyzing tool implementation'
    ]
    
    for (const input of testCases) {
        console.log(`Input: "${input}"`)
        const parsed = llmTools.parseToolRequest(input)
        console.log('Parsed:', JSON.stringify(parsed, null, 2))
        console.log('---')
    }
    
    console.log('\n=== Testing Introspective Tool Execution ===')
    
    try {
        // Test SEARCH_CODEBASE
        console.log('Testing SEARCH_CODEBASE...')
        const searchResult = await llmTools.searchCodebase('logger', 'Testing codebase search functionality')
        console.log('Search result success:', searchResult.success)
        console.log('Search result message:', searchResult.message)
        if (searchResult.output?.stdout) {
            console.log('Found matches:', searchResult.output.stdout.split('\n').length)
        }
        
        // Test ANALYZE_CAPABILITIES
        console.log('\nTesting ANALYZE_CAPABILITIES...')
        const capabilitiesResult = await llmTools.analyzeCurrentCapabilities('Testing capability analysis')
        console.log('Capabilities result success:', capabilitiesResult.success)
        console.log('Capabilities result message:', capabilitiesResult.message)
        if (capabilitiesResult.output?.stdout) {
            console.log('Analysis length:', capabilitiesResult.output.stdout.length)
        }
        
        // Test INSPECT_STRUCTURE
        console.log('\nTesting INSPECT_STRUCTURE...')
        const structureResult = await llmTools.inspectCodeStructure('src/llmTools.ts', 'Testing structure inspection')
        console.log('Structure result success:', structureResult.success)
        console.log('Structure result message:', structureResult.message)
        if (structureResult.output?.stdout) {
            console.log('Structure analysis:', structureResult.output.stdout)
        }
        
    } catch (error) {
        console.error('Error testing introspective tools:', error.message)
    }
    
    console.log('\n✅ Introspective tools testing completed!')
}

testIntrospectiveTools().catch(console.error)
