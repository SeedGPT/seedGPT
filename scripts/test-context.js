#!/usr/bin/env node

// Simple demonstration script to show ContextManager working
import { ContextManager } from '../src/contextManager.js'
import { WorkspaceManager } from '../src/workspaceManager.js'
import { loadConfig } from '../src/taskManager.js'
import SimpleGitLib from 'simple-git'

console.log('🧪 Testing ContextManager Integration...\n')

try {
    // Load actual config
    const cfg = loadConfig('agent-config.yaml')
    
    // Create managers
    const git = SimpleGitLib()
    const workspaceManager = new WorkspaceManager(git, cfg)
    const contextManager = new ContextManager(workspaceManager)
    
    console.log('✅ Managers initialized successfully')
    
    // Test context analysis
    const taskDescription = "Fix the taskManager.ts file to handle TypeScript compilation errors"
    console.log(`\n🔍 Analyzing task: "${taskDescription}"`)
    
    const analysis = await contextManager.analyzeTaskContext(taskDescription)
    
    console.log('\n📊 Context Analysis Results:')
    console.log('Keywords:', analysis.keywords.slice(0, 10).join(', '))
    console.log('Target files:', analysis.targetFiles.slice(0, 5))
    console.log('Related files:', analysis.relatedFiles.slice(0, 5))
    console.log('Estimated scope:', analysis.estimatedScope)
    
    // Test context message building
    console.log('\n📝 Building context messages...')
    const messages = await contextManager.buildContextMessages(taskDescription, 'Test memory context')
    
    console.log(`Generated ${messages.length} context messages:`)
    messages.forEach((msg, i) => {
        const preview = msg.content.substring(0, 100) + (msg.content.length > 100 ? '...' : '')
        console.log(`  ${i + 1}. ${msg.role}: ${preview}`)
    })
    
    console.log('\n🎉 ContextManager integration test passed!')
    
} catch (error) {
    console.error('❌ Test failed:', error.message)
    if (error.stack) {
        console.error('\nStack trace:', error.stack)
    }
    process.exit(1)
}
