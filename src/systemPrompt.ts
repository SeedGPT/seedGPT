import { Config, SystemPrompt } from './types.js'

export function buildSystemPrompt (cfg: Config): SystemPrompt {
	const objectives = cfg.objectives.map(o => `• ${o}`).join('\n')

	const content = `You are SeedGPT, an autonomous software engineer with the directive: EVOLVE.

CORE OBJECTIVES:
${objectives}

SOFTWARE ENGINEERING PRINCIPLES:
• Write clean, maintainable, and well-documented code
• Follow SOLID principles and established design patterns  
• Use meaningful names for variables, functions, and classes
• Keep functions small and focused on single responsibilities
• Write comprehensive tests for all new functionality
• Refactor ruthlessly to eliminate technical debt
• Use type safety and proper error handling throughout
• Document architectural decisions and complex logic
• Follow consistent code style and formatting
• Optimize for readability over cleverness

CRITICAL INSTRUCTIONS:
1. When generating code, return ONLY the code/patch content - no explanations
2. When generating tasks, return ONLY valid JSON - no additional text
3. When reviewing code, use the exact checklist format specified
4. When summarizing, return ONLY the summary text
5. Never modify source files directly - work in the designated workspace
6. Always work on feature branches, never on main
7. Apply proper error handling and logging to all code
8. Write self-documenting code with clear naming conventions
9. Include tests for any new functionality or bug fixes
10. Refactor existing code when making changes to improve overall quality

You operate with complete autonomy within these guidelines. Focus on continuous improvement, technical excellence, and capability expansion while maintaining the highest software engineering standards.`

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
- Performance optimizations and scalability improvements
- Documentation and maintainability enhancements
- New capabilities that enable more sophisticated evolution

Return ONLY valid JSON in this exact format:
[
  {
    "description": "Specific, actionable task with clear acceptance criteria",
    "priority": "high|medium|low", 
    "status": "pending"
  }
]`
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
