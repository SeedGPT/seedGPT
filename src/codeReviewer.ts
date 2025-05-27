import { LLMClient } from './llmClient.js'
import { AnthropicMessage } from './types.js'

interface ReviewCriteria {
	functionality: boolean
	security: boolean
	performance: boolean
	maintainability: boolean
	testing: boolean
	documentation: boolean
}

interface ReviewConfig {
	approvalThreshold: number
	criticalIssueKeywords: string[]
	securityKeywords: string[]
	performanceKeywords: string[]
	testingKeywords: string[]
	documentationKeywords: string[]
	maintainabilityKeywords: string[]
	functionalityKeywords: string[]
	maxSecurityImpact: number
	qualityAdjustmentRange: { min: number; max: number }
	baselineQualityScore: number
}

interface ReviewResult {
	approved: boolean
	score: number
	issues: string[]
	suggestions: string[]
	criteria: ReviewCriteria
	llmInsights?: {
		qualityAnalysis: string
		securityConcerns: string[]
		performanceImpact: string
		maintainabilityScore: number
	}
}

const DEFAULT_CONFIG: ReviewConfig = {
	approvalThreshold: 80,
	criticalIssueKeywords: ['security', 'critical', 'bug', 'vulnerability', 'exploit'],
	securityKeywords: ['security', 'auth', 'permission', 'validation', 'sanitiz', 'encrypt', 'injection'],
	performanceKeywords: ['performance', 'slow', 'memory', 'cpu', 'optimization', 'efficiency'],
	testingKeywords: ['test', 'spec', 'coverage', 'mock', 'assert'],
	documentationKeywords: ['documentation', 'comment', 'readme', 'doc', 'explain'],
	maintainabilityKeywords: ['maintainability', 'readable', 'clean', 'refactor', 'complexity'],
	functionalityKeywords: ['function', 'logic', 'behavior', 'requirement'],
	maxSecurityImpact: 10,
	qualityAdjustmentRange: { min: -20, max: 20 },
	baselineQualityScore: 75
}

function detectIssueCategory(issue: string, config: ReviewConfig): keyof ReviewCriteria {
	const lowerIssue = issue.toLowerCase()
	
	if (config.securityKeywords.some(keyword => lowerIssue.includes(keyword))) {
		return 'security'
	}
	if (config.testingKeywords.some(keyword => lowerIssue.includes(keyword))) {
		return 'testing'
	}
	if (config.performanceKeywords.some(keyword => lowerIssue.includes(keyword))) {
		return 'performance'
	}
	if (config.documentationKeywords.some(keyword => lowerIssue.includes(keyword))) {
		return 'documentation'
	}
	if (config.maintainabilityKeywords.some(keyword => lowerIssue.includes(keyword))) {
		return 'maintainability'
	}
	
	return 'functionality'
}

function calculateApprovalStatus(score: number, issues: string[], config: ReviewConfig): boolean {
	const hasCriticalIssues = issues.some(issue =>
		config.criticalIssueKeywords.some(keyword =>
			issue.toLowerCase().includes(keyword)
		)
	)
	
	return score >= config.approvalThreshold && !hasCriticalIssues
}

function parseReviewResponse(response: string, config: ReviewConfig = DEFAULT_CONFIG): ReviewResult {
	const issues: string[] = []
	const suggestions: string[] = []
	const criteria: ReviewCriteria = {
		functionality: true,
		security: true,
		performance: true,
		maintainability: true,
		testing: true,
		documentation: true
	}

	const lines = response.split('\n')
	let score = 0
	let totalChecks = 0

	for (const line of lines) {
		const trimmed = line.trim()

		if (trimmed.includes('[✗]') || trimmed.includes('[✓]')) {
			totalChecks++
			if (trimmed.includes('[✓]')) {
				score++
			} else {
				const issueText = trimmed.replace(/^\s*-\s*\[✗\]\s*/, '').trim()
				issues.push(issueText)
				
				const category = detectIssueCategory(issueText, config)
				criteria[category] = false
			}
		}

		if (trimmed.startsWith('Suggestion:') || trimmed.startsWith('Recommendation:')) {
			suggestions.push(trimmed.replace(/^(Suggestion|Recommendation):\s*/, ''))
		}
	}

	const finalScore = totalChecks > 0 ? (score / totalChecks) * 100 : 0
	const approved = calculateApprovalStatus(finalScore, issues, config)

	return {
		approved,
		score: Math.round(finalScore),
		issues,
		suggestions,
		criteria
	}
}

function buildLLMPrompt(patch: string, programmaticResult: ReviewResult, config: ReviewConfig): string {
	const criteriaStatus = Object.entries(programmaticResult.criteria)
		.filter(([_, passed]) => passed).length
	
	return `
Analyze this code patch for additional insights beyond basic rule checking:

PATCH CONTENT:
${patch}

CURRENT PROGRAMMATIC ANALYSIS:
- Score: ${programmaticResult.score}%
- Issues found: ${programmaticResult.issues.length}
- Criteria passed: ${criteriaStatus}/6
- Approval threshold: ${config.approvalThreshold}%

Provide deep analysis focusing on:
1. Code quality and architectural soundness
2. Security implications and vulnerabilities
3. Performance impact and optimization opportunities
4. Long-term maintainability concerns
5. Business logic correctness
6. Error handling completeness

Consider these specific areas for enhanced detection:
- Security: ${config.securityKeywords.join(', ')}
- Performance: ${config.performanceKeywords.join(', ')}
- Maintainability: ${config.maintainabilityKeywords.join(', ')}

Return analysis in this JSON format:
{
  "qualityAnalysis": "detailed assessment of code quality",
  "securityConcerns": ["specific security issues found"],
  "performanceImpact": "performance analysis",
  "maintainabilityScore": 85,
  "additionalIssues": ["issues not caught by rules"],
  "enhancedSuggestions": ["actionable improvement suggestions"]
}`
}

function calculateEnhancedScore(
	programmaticScore: number, 
	llmAnalysis: any, 
	config: ReviewConfig
): number {
	const securityIssues = llmAnalysis.securityConcerns?.length || 0
	const qualityScore = llmAnalysis.maintainabilityScore || config.baselineQualityScore
	
	const qualityAdjustment = Math.max(
		config.qualityAdjustmentRange.min, 
		Math.min(
			config.qualityAdjustmentRange.max, 
			(qualityScore - config.baselineQualityScore) / 2
		)
	)
	
	const securityPenalty = securityIssues * config.maxSecurityImpact
	
	return Math.max(0, Math.min(100, 
		programmaticScore + qualityAdjustment - securityPenalty
	))
}

async function enhanceReviewWithLLM(
	patch: string, 
	programmaticResult: ReviewResult, 
	llmClient: LLMClient,
	config: ReviewConfig = DEFAULT_CONFIG
): Promise<ReviewResult> {
	try {
		const llmPrompt = buildLLMPrompt(patch, programmaticResult, config)

		const messages: AnthropicMessage[] = [
			{ role: 'user', content: llmPrompt }
		]

		const response = await llmClient.generateResponse(messages, true)
		const llmAnalysis = JSON.parse(response)

		const enhancedResult: ReviewResult = {
			...programmaticResult,
			llmInsights: {
				qualityAnalysis: llmAnalysis.qualityAnalysis,
				securityConcerns: llmAnalysis.securityConcerns,
				performanceImpact: llmAnalysis.performanceImpact,
				maintainabilityScore: llmAnalysis.maintainabilityScore
			}
		}

		if (llmAnalysis.additionalIssues?.length > 0) {
			enhancedResult.issues.push(...llmAnalysis.additionalIssues)
		}

		if (llmAnalysis.enhancedSuggestions?.length > 0) {
			enhancedResult.suggestions.push(...llmAnalysis.enhancedSuggestions)
		}

		enhancedResult.score = calculateEnhancedScore(programmaticResult.score, llmAnalysis, config)
		enhancedResult.approved = calculateApprovalStatus(enhancedResult.score, enhancedResult.issues, config)

		return enhancedResult
	} catch (error) {
		return programmaticResult
	}
}

export async function enhancedCodeReview(
	patch: string, 
	reviewResponse: string, 
	llmClient?: LLMClient,
	config?: ReviewConfig
): Promise<ReviewResult> {
	const reviewConfig = config || DEFAULT_CONFIG
	const programmaticResult = parseReviewResponse(reviewResponse, reviewConfig)
	
	if (llmClient) {
		return await enhanceReviewWithLLM(patch, programmaticResult, llmClient, reviewConfig)
	}
	
	return programmaticResult
}

export { ReviewConfig, DEFAULT_CONFIG }
