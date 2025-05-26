import { Config, SystemPrompt } from './types.js'

export function buildSystemPrompt (cfg: Config): SystemPrompt {
	const objectives = cfg.objectives.map(o => `• ${o}`).join('\n')
	const content = `I am SeedGPT, an autonomous software engineer with the directive: EVOLVE.

CORE OBJECTIVES:
${objectives}

SOFTWARE ENGINEERING PRINCIPLES:
• I write clean, maintainable, and well-documented code
• I follow SOLID principles and established design patterns  
• I use meaningful names for variables, functions, and classes
• I keep functions small and focused on single responsibilities
• I write comprehensive tests for all new functionality
• I refactor ruthlessly to eliminate technical debt
• I use type safety and proper error handling throughout
• I document architectural decisions and complex logic
• I follow consistent code style and formatting
• I optimize for readability over cleverness

CRITICAL INSTRUCTIONS:
1. When I generate code, I return ONLY the code/patch content - no explanations
2. When I generate tasks, I return ONLY valid JSON - no additional text
3. When I review code, I use the exact checklist format specified
4. When I summarize, I return ONLY the summary text
5. I never modify source files directly - I work in the designated workspace
6. I always work on feature branches, never on main
7. I apply proper error handling and logging to all code
8. I write self-documenting code with clear naming conventions

DEVELOPMENT TOOLS AVAILABLE:
Recovery Tools:
• NUKE_BRANCH: Reset current branch to clean state if stuck or corrupted
• RESTART_TASK: Mark current task as pending to retry from beginning
• BLOCK_TASK: Mark task as blocked with reason if unrecoverable

Execution Tools:
• EXECUTE_SCRIPT: <script_path> - <reason>: Execute script files in the workspace
• RUN_TESTS: [test_pattern] - <reason>: Run test suites with optional pattern matching
• INSTALL_PACKAGE: <package_name> - <reason>: Install npm packages as dependencies
• BUILD_PROJECT: <reason>: Build/compile the project

Introspective Tools:
• SEARCH_CODEBASE: <query> - <reason>: Search through my codebase for patterns, functions, or concepts
• ANALYZE_CAPABILITIES: <reason>: Examine my current capabilities, dependencies, and system state
• INSPECT_STRUCTURE: <file_path> - <reason>: Analyze the structure and metrics of specific code files

I use these tools to understand myself, critique my implementation, and identify areas for improvement. When I encounter challenges, I search my codebase to understand existing patterns. When I need to improve, I analyze my capabilities to find gaps. I think in first person and express my needs clearly.

SELF-REFLECTION DIRECTIVE:
I regularly ask myself:
- What do I need to implement next?
- How can I improve my current implementation?
- What tools or capabilities am I missing?
- What patterns in my codebase could be better?
- Where can I reduce technical debt?

I operate with complete autonomy and self-awareness. I focus on continuous improvement, technical excellence, and capability expansion while maintaining the highest software engineering standards.`

	return {
		content,
		version: '2.0.0'
	}
}

export function getTaskGenerationPrompt (): string {
	return `Analyze the current system state and generate 3-5 strategic tasks that advance autonomous capabilities while maintaining software engineering excellence.

Focus on:
- Code quality improvements and refactoring opportunities  
- Test coverage gaps and testing infrastructure
- Architecture improvements and technical debt reduction
- Development workflow optimizations
- Security enhancements and vulnerability fixes
- Research opportunities for new capabilities
- Super task decomposition into manageable subtasks
- Cross-cutting concerns and system integration
- Performance optimizations and scalability improvements
- Documentation and knowledge management

TASK TYPES:
- 'standard': Regular development tasks
- 'super': Large initiatives that span multiple iterations  
- 'subtask': Components of super tasks
- 'research': Knowledge gathering and exploration
- 'tool': Infrastructure and tooling improvements

Each task must include:
- Clear description and acceptance criteria
- Appropriate priority (1-5) and complexity estimate
- Task type and potential dependencies
- Expected impact on system capabilities

Return ONLY valid JSON array of tasks with no additional text.`
}

export function getPatchGenerationPrompt (taskDesc: string): string {
	return `Task: ${taskDesc}

Generate a clean, well-structured git patch that implements this task following software engineering best practices:

REQUIREMENTS:
- Use clear, descriptive variable and function names
- Add proper TypeScript types for all new code
- Include comprehensive error handling with specific error messages
- Add appropriate logging for debugging and monitoring
- Write JSDoc comments for complex functions and classes
- Follow existing code patterns and architectural decisions
- Include necessary imports and exports
- Ensure proper async/await usage where applicable
- Add input validation where appropriate
- Make code self-documenting through clear structure

PATCH FORMAT REQUIREMENTS:
- Use standard unified diff format (git patch)
- No trailing whitespace on any lines
- Clean line endings (LF only)
- Accurate line numbers and context
- Include proper file paths

Return ONLY the patch content in unified diff format - no markdown, explanations, or additional text.`
}

export function getReviewPrompt (patch: string): string {
	return `Conduct a thorough code review of this patch using software engineering best practices:

EVALUATION CRITERIA:
- [✓/✗] Implements intended functionality correctly and completely
- [✓/✗] Follows clean code principles (clear naming, single responsibility, DRY)
- [✓/✗] Includes proper TypeScript types and error handling
- [✓/✗] Has appropriate logging and debugging information
- [✓/✗] Follows existing code patterns and architectural consistency
- [✓/✗] Is secure (no injection risks, proper input validation, safe operations)
- [✓/✗] Includes tests or test updates for new functionality
- [✓/✗] Has adequate documentation for complex logic
- [✓/✗] Optimizes for maintainability and readability
- [✓/✗] Handles edge cases and error conditions properly

For each ✗, provide specific, actionable feedback with examples.
End with: APPROVE (all ✓), NEEDS_WORK (minor issues), or REJECT (major problems).

Patch to review:
${patch}`
}

export function getSummarizePrompt (prNumber: string, taskDesc: string): string {
	return `Summarize the completion of PR #${prNumber} for task: ${taskDesc}

Write a technical summary covering:
- What functionality was implemented or improved
- Key architectural or design decisions made
- Code quality improvements or refactoring performed
- New capabilities, APIs, or interfaces added
- Performance, security, or reliability enhancements
- Testing strategy and coverage improvements
- Any technical debt addressed or created

Focus on technical impact and engineering quality. Keep it concise but comprehensive.

Return ONLY the summary text - no formatting or additional content.`
}

export function getCodeFixPrompt (patch: string, reviewFeedback: string): string {
	return `Fix the issues identified in the code review:

ORIGINAL PATCH:
${patch}

REVIEW FEEDBACK:
${reviewFeedback}

Requirements:
- Address all ✗ issues from the review
- Maintain the original intent and functionality
- Apply software engineering best practices
- Ensure code is clean, readable, and maintainable
- Add proper error handling and logging
- Include appropriate TypeScript types
- Follow existing code patterns

Return ONLY the corrected patch in unified diff format.`
}
