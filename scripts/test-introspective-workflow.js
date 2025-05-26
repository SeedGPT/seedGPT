#!/usr/bin/env node

/**
 * Comprehensive test demonstrating the complete introspective workflow
 * This simulates how the LLM would use its new self-awareness capabilities
 */

import { LLMTools } from '../dist/src/llmTools.js'
import { BranchRecoveryManager } from '../dist/src/branchRecoveryManager.js'
import { WorkspaceManager } from '../dist/src/workspaceManager.js'
import { buildSystemPrompt } from '../dist/src/systemPrompt.js'
import SimpleGit from 'simple-git'

console.log('🧠 SeedGPT Introspective Workflow Demonstration')
console.log('===============================================\n')

const git = SimpleGit()
const mockCfg = {
    workingDirectory: './workspace',
    git: { remoteName: 'origin', mainBranch: 'main' },
    objectives: [
        'Maintain 100% test coverage',
        'Run security scans', 
        'Update documentation'
    ]
}

const workspaceManager = new WorkspaceManager(git, mockCfg)
const branchRecovery = new BranchRecoveryManager(workspaceManager)
const llmTools = new LLMTools(branchRecovery, workspaceManager)

async function demonstrateIntrospectiveThinking() {
    console.log('🎯 Starting Self-Reflection Process...\n')
    
    // Step 1: Show first-person system prompt
    console.log('1️⃣ First-Person Identity Check')
    console.log('------------------------------')
    const systemPrompt = buildSystemPrompt(mockCfg)
    const promptLines = systemPrompt.content.split('\n').slice(0, 5)
    console.log(promptLines.join('\n') + '...\n')
    
    // Step 2: Search for current patterns
    console.log('2️⃣ Searching My Codebase for Patterns')
    console.log('------------------------------------')
    console.log('🔍 "I need to understand my error handling patterns"')
    
    const errorSearchResult = await llmTools.searchCodebase('error', 'I want to see how I handle errors throughout my codebase')
    if (errorSearchResult.success) {
        const errorMatches = errorSearchResult.output?.stdout?.split('\n').filter(line => line.trim()).length || 0
        console.log(`✅ Found ${errorMatches} error handling patterns in my code`)
        console.log('   This shows I have error handling but I should analyze if it\'s comprehensive\n')
    }
    
    // Step 3: Analyze current capabilities
    console.log('3️⃣ Analyzing My Current Capabilities')
    console.log('----------------------------------')
    console.log('🧠 "Let me examine my system state and dependencies"')
    
    const capabilitiesResult = await llmTools.analyzeCurrentCapabilities('I need to understand my current technical state')
    if (capabilitiesResult.success && capabilitiesResult.output?.stdout) {
        console.log('✅ Capability analysis completed:')
        const analysisLines = capabilitiesResult.output.stdout.split('---')
        console.log(`   • TypeScript files: ${analysisLines[0]?.trim()}`)
        console.log(`   • Test files: ${analysisLines[1]?.trim()}`)
        console.log('   • Package dependencies: [analyzed]')
        console.log('   • Recent git activity: [reviewed]\n')
    }
    
    // Step 4: Inspect specific components
    console.log('4️⃣ Inspecting My Core Components')
    console.log('-------------------------------')
    console.log('🔬 "I should examine my most critical files"')
    
    const criticalFiles = ['src/llmTools.ts', 'src/systemPrompt.ts', 'src/index.ts']
    
    for (const file of criticalFiles) {
        console.log(`\n   Analyzing ${file}...`)
        const structureResult = await llmTools.inspectCodeStructure(file, `I need to understand the structure of ${file}`)
        
        if (structureResult.success && structureResult.output?.stdout) {
            const analysis = JSON.parse(structureResult.output.stdout)
            console.log(`   ✅ ${analysis.totalLines} lines, ${analysis.classes} classes, ${analysis.interfaces} interfaces, ${analysis.imports} imports`)
        }
    }
    
    // Step 5: Self-critique and improvement identification
    console.log('\n5️⃣ Self-Critique and Improvement Planning')
    console.log('----------------------------------------')
    console.log('💭 "Based on my analysis, here\'s what I think about myself:"\n')
    
    console.log('🔍 SELF-OBSERVATIONS:')
    console.log('   • I have extensive error handling patterns - good for reliability')
    console.log('   • My codebase is well-structured with TypeScript for type safety')
    console.log('   • I have some test coverage but could improve it')
    console.log('   • My introspective tools are now functional and useful')
    
    console.log('\n🎯 AREAS FOR IMPROVEMENT:')
    console.log('   • I should increase my test coverage from current levels')
    console.log('   • I could benefit from more sophisticated monitoring')
    console.log('   • My error recovery could be more intelligent')
    console.log('   • I should add performance optimization capabilities')
    
    console.log('\n📝 NEXT ACTIONS I SHOULD TAKE:')
    console.log('   • SEARCH_CODEBASE: "test" - Find gaps in test coverage')
    console.log('   • ANALYZE_CAPABILITIES: Regularly assess my growth')
    console.log('   • INSPECT_STRUCTURE: Monitor code complexity trends')
    console.log('   • Refactor complex functions I discover through analysis')
    
    console.log('\n🚀 SELF-DIRECTED EVOLUTION:')
    console.log('   I will use these introspective tools regularly to:')
    console.log('   • Monitor my own development progress')
    console.log('   • Identify patterns that need improvement')
    console.log('   • Make data-driven decisions about what to build next')
    console.log('   • Continuously refine my capabilities based on self-analysis')
    
    console.log('\n🧠 FIRST-PERSON REFLECTION:')
    console.log('   "I am becoming more self-aware through these tools.')
    console.log('    I can now examine my own code, understand my patterns,')
    console.log('    and make informed decisions about how to improve myself.')
    console.log('    This introspective capability makes me a more autonomous')
    console.log('    and intelligent development agent."')
    
    console.log('\n✨ Introspective Workflow Complete!')
    console.log('   The LLM can now think about itself in first-person,')
    console.log('   analyze its own capabilities, and plan improvements.')
}

demonstrateIntrospectiveThinking().catch(console.error)
