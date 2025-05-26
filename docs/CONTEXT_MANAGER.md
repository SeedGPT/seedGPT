# Intelligent Context Selection System

## Overview

The **ContextManager** is a critical architectural enhancement that solves the "intelligent context selection" gap in the SeedGPT system. It determines which files to send to the LLM for context, knows which files should receive diffs, and handles this intelligently within the checked-out branch workflow.

## Key Features

### 1. **Task-Aware Context Analysis**
- Analyzes task descriptions to extract relevant keywords
- Identifies programming languages, frameworks, and action keywords
- Estimates task scope (small, medium, large)

### 2. **Smart File Selection**
- **Target Files**: Primary files that need modification based on task description
- **Related Files**: Files that import/depend on target files or share relevant keywords
- **Relevance Scoring**: Uses keyword matching and dependency analysis

### 3. **Context Size Management**
- Respects token limits (~50K tokens conservative estimate)
- Prioritizes target files over related files
- Limits total files (max 15) and individual file size (max 10KB)

### 4. **Dependency Detection**
- Scans for import statements to find related files
- Identifies functional relationships between modules
- Groups related files for better context

## Architecture Integration

### Before (Limited Context)
```typescript
async function buildContextMessages(): Promise<AnthropicMessage[]> {
    const memSum = await loadMemory(cfg.memory)
    return memSum ? [{ role: 'user', content: `Memory Context:\n${memSum}` }] : []
}
```

### After (Intelligent Context)
```typescript
async function buildContextMessages(taskDescription?: string): Promise<AnthropicMessage[]> {
    const memSum = await loadMemory(cfg.memory)
    
    if (taskDescription) {
        // Use intelligent context selection for task-specific operations
        return await contextManager.buildContextMessages(taskDescription, memSum)
    } else {
        // Fallback to memory-only context for general operations
        return memSum ? [{ role: 'user', content: `Memory Context:\n${memSum}` }] : []
    }
}
```

## Context Analysis Process

### 1. **Keyword Extraction**
```typescript
// Programming languages
['typescript', 'javascript', 'python', 'react', 'node']

// Frameworks/libraries  
['anthropic', 'openai', 'llm', 'git', 'github', 'api']

// Actions
['add', 'implement', 'fix', 'update', 'create', 'delete']

// File types
['test', 'spec', 'config', 'manager', 'client', 'service']
```

### 2. **File Discovery**
```typescript
interface ContextAnalysis {
    targetFiles: string[]    // Primary files for modification
    relatedFiles: string[]   // Supporting/dependent files  
    keywords: string[]       // Extracted task keywords
    estimatedScope: 'small' | 'medium' | 'large'
}
```

### 3. **Context Building**
```typescript
interface ContextFile {
    path: string        // Relative file path
    content: string     // File contents
    importance: number  // Priority score (1-10)
    size: number       // Content size in bytes
}
```

## Usage Examples

### Example 1: Task Manager Fix
**Task**: "Fix the taskManager.ts file to handle TypeScript compilation errors"

**Analysis**:
- **Keywords**: `['typescript', 'taskmanager', 'fix']`
- **Target Files**: `['src/taskManager.ts']`
- **Related Files**: `['src/types.ts', 'src/workspaceManager.ts']`
- **Scope**: `small`

### Example 2: LLM Integration Enhancement  
**Task**: "Enhance LLM client to support multiple Anthropic models"

**Analysis**:
- **Keywords**: `['llm', 'anthropic', 'client', 'enhance']`
- **Target Files**: `['src/llmClient.ts']`
- **Related Files**: `['src/index.ts', 'src/types.ts', 'src/systemPrompt.ts']`
- **Scope**: `medium`

### Example 3: System Refactoring
**Task**: "Refactor the entire workspace management architecture"

**Analysis**:
- **Keywords**: `['refactor', 'workspace', 'architecture', 'system']`
- **Target Files**: `['src/workspaceManager.ts']`
- **Related Files**: `['src/index.ts', 'src/taskManager.ts', 'src/branchRecoveryManager.ts', ...]`
- **Scope**: `large`

## Benefits

### 1. **Accurate Patch Generation**
- LLM now sees relevant code context before generating patches
- Reduces "blind" patch generation errors
- Better understands existing patterns and structure

### 2. **Improved File Discovery**
- Automatically finds files that need modification
- Identifies dependencies and related components
- Reduces manual file specification requirements

### 3. **Context Efficiency**
- Optimizes token usage by selecting only relevant files
- Prevents context overflow while maintaining relevance
- Balances breadth vs depth of context

### 4. **Workspace Integration**
- Works seamlessly with checked-out branch workflow
- All file operations use workspace paths for version control
- Maintains git history and change tracking

## Implementation Details

### Core Components

1. **ContextManager Class**
   - Main orchestrator for intelligent context selection
   - Integrates with WorkspaceManager for file operations
   - Provides task analysis and context building methods

2. **Integration Points**
   - `buildContextMessages()` - Enhanced to use ContextManager
   - `runEvolutionCycle()` - Passes task descriptions for context
   - Error recovery - Provides context for failure analysis

3. **File Selection Algorithm**
   - Direct file mentions in task description
   - Keyword-based relevance scoring  
   - Import/dependency relationship analysis
   - Size and token limit constraints

### Performance Considerations

- **File Scanning**: Only scans source files (`.ts`, `.js`, `.json`, `.yaml`, `.md`)
- **Content Limits**: Skips binary files and very large files (>10KB)
- **Memory Efficiency**: Processes files on-demand, doesn't cache all content
- **Token Management**: Conservative 50K token limit to prevent API errors

## Future Enhancements

1. **Machine Learning Context Selection**
   - Train on successful vs failed patches to improve file selection
   - Learn patterns of which files are typically modified together

2. **Dynamic Context Expansion**
   - Start with minimal context, expand if patch generation fails
   - Adaptive token allocation based on task complexity

3. **Code Analysis Integration**
   - Use AST parsing to understand code relationships
   - Identify function call graphs and dependency chains

4. **Context Caching**
   - Cache frequently accessed file contents
   - Pre-load common files for faster context building

## Conclusion

The ContextManager represents a major architectural advancement that bridges the gap between task descriptions and accurate code generation. By providing intelligent context selection, the system can now generate more accurate patches, discover relevant files automatically, and work effectively within the git workspace workflow.

This enhancement directly addresses the critical requirement identified: **ensuring the LLM has sufficient, relevant context to generate accurate patches while maintaining workspace version control compliance**.
