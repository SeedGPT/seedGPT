# SeedGPT - Self-Evolving AI Development Agent

An autonomous AI agent that can evolve its own codebase, manage tasks, and deploy changes through GitHub automation.
 
## 🎯 Objective

The agent has one primary directive: **EVOLVE**. It will autonomously:

- **Self-Reflect**: Introspectively analyze its own capabilities and codebase
- **Self-Critique**: Identify areas for improvement in its implementation
- **Search & Discover**: Find patterns and concepts within its own code
- Analyze its current capabilities and system state
- Generate new tasks and improvements based on introspection
- Write and test code with full self-awareness
- Deploy changes via GitHub
- Document its progress and learnings
- Expand its own toolset through self-analysis

## 🏗️ Architecture

- **Introspective AI**: First-person thinking with self-analysis and self-critique capabilities
- **Intelligent Task Management**: Advanced task queue with priority-based selection and context analysis
- **AI Integration**: Claude 3.5 Sonnet for code generation and review
- **Context Manager**: Intelligent file selection for optimal LLM context
- **Dashboard & API**: Real-time monitoring and control interface
- **Recovery System**: Automated branch recovery and task failure handling
- **Research Module**: Autonomous knowledge gathering capabilities
- **Memory**: Persistent summaries and vector embeddings
- **CI/CD**: Automated testing and deployment

## 🖥️ Dashboard Features

The system includes a comprehensive web dashboard with:

- **Task Management**: View, create, edit, and delete tasks
- **Recovery History**: Complete log of all system recovery actions
- **System Status**: Real-time health monitoring and metrics  
- **Context Analysis**: Intelligent analysis of task requirements
- **Task Suggestions**: AI-generated task recommendations
- **Repository State**: Git status and branch information

### Dashboard API Endpoints

- `GET /api/tasks` - List all tasks with statistics
- `POST /api/tasks` - Create new tasks
- `PUT /api/tasks/:id` - Update existing tasks
- `DELETE /api/tasks/:id` - Remove tasks
- `GET /api/recovery-history` - View recovery actions log
- `GET /api/system-status` - System health and metrics
- `GET /api/context-analysis/:taskId` - Task context insights
- `GET /api/suggestions` - AI task suggestions

## 🛠️ LLM Tools

The system includes advanced script execution tools that allow the LLM to interact with the development environment:

### Recovery Tools
- `NUKE_BRANCH: <reason>` - Reset current branch to clean state if stuck or corrupted
- `RESTART_TASK: <reason>` - Mark current task as pending to retry from beginning  
- `BLOCK_TASK: <reason>` - Mark task as blocked with reason if unrecoverable

### Script Execution Tools
- `EXECUTE_SCRIPT: <script_path> - <reason>` - Execute script files in the workspace
- `RUN_TESTS: [test_pattern] - <reason>` - Run test suites with optional pattern matching
- `INSTALL_PACKAGE: <package_name> - <reason>` - Install npm packages as dependencies
- `BUILD_PROJECT: <reason>` - Build/compile the project

### Introspective Tools (NEW)
- `SEARCH_CODEBASE: <query> - <reason>` - Search through codebase for patterns, functions, or concepts
- `ANALYZE_CAPABILITIES: <reason>` - Examine current capabilities, dependencies, and system state
- `INSPECT_STRUCTURE: <file_path> - <reason>` - Analyze structure and metrics of specific code files

### Usage Examples

```bash
EXECUTE_SCRIPT: scripts/setup.js - Initial environment setup
RUN_TESTS: unit - Running unit tests only  
RUN_TESTS: - Running all tests
INSTALL_PACKAGE: lodash - Adding utility library
BUILD_PROJECT: Compiling TypeScript changes
SEARCH_CODEBASE: error handling - Find existing error patterns in codebase
ANALYZE_CAPABILITIES: Understanding current system state and dependencies
INSPECT_STRUCTURE: src/llmTools.ts - Analyzing tool implementation structure
```

These tools enable the LLM to autonomously manage the development workflow, install dependencies, run tests, execute custom scripts, and perform self-reflection and introspective analysis as needed during task execution.

## 🔒 Security

The agent includes built-in security measures:

- **Dashboard Authentication**: bcrypt-hashed password protection
- **Code review** before commits
- **Sandboxed execution** environment
- **Access token validation**
- **Branch recovery** for failed operations

## 📝 Files Structure

- `tasks.yaml` - Task queue and priorities
- `supertasks.yaml` - High-level strategic objectives
- `agent-config.yaml` - Agent objectives and configuration
- `PROGRESS.md` - Historical progress log
- `memory/` - Long-term memory summaries
- `prompts/` - LLM prompt templates
- `docs/` - Technical documentation:
  - `CONTEXT_MANAGER.md` - Intelligent context selection system
  - `DASHBOARD_RECOVERY_HISTORY.md` - Recovery monitoring system
  - `INTROSPECTIVE_AI.md` - Self-reflection and introspective capabilities
- `src/` - Core system modules:
  - `contextManager.ts` - Intelligent file selection
  - `dashboardManager.ts` - Web interface and API
  - `branchRecoveryManager.ts` - Automated recovery
  - `intelligentTaskManager.ts` - Advanced task processing
  - `researchManager.ts` - Knowledge gathering
  - `llmTools.ts` - AI integration tools

## 🚀 Getting Started

1. **Installation**:
   ```bash
   npm install
   ```

2. **Configuration**:
   Copy `.env.example` to `.env` and configure:
   ```bash
   ANTHROPIC_API_KEY=your_api_key
   GITHUB_TOKEN=your_token
   DASHBOARD_PASSWORD_HASH=your_bcrypt_hash
   ```

3. **Start Dashboard**:
   ```bash
   npm run dashboard
   ```

4. **Run Agent**:
   ```bash
   npm start
   ```

## 🤖 How It Works

1. **Context Analysis**: Intelligent analysis of task requirements and codebase
2. **Task Generation**: AI analyzes current state and generates new tasks  
3. **Code Generation**: Creates patches with optimal context selection
4. **Recovery Handling**: Automated recovery from failures and conflicts
5. **Review & Security**: AI reviews code and security scanning
6. **Deploy**: Creates PR, runs CI, merges if successful
7. **Documentation**: Summarizes changes and updates memory
8. **Research**: Gathers knowledge for complex tasks
9. **Monitoring**: Dashboard tracks all activities and system health
10. **Repeat**: Continuous evolution loop

Let the evolution begin! 🧬
