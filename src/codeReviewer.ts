interface ReviewCriteria {
	functionality: boolean
	security: boolean
	performance: boolean
	maintainability: boolean
	testing: boolean
	documentation: boolean
}

interface ReviewResult {
	approved: boolean
	score: number
	issues: string[]
	suggestions: string[]
	criteria: ReviewCriteria
}

function parseReviewResponse (response: string): ReviewResult {
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
				issues.push(trimmed.replace(/^\s*-\s*\[✗\]\s*/, '').trim())

				if (trimmed.toLowerCase().includes('security')) {
					criteria.security = false
				} else if (trimmed.toLowerCase().includes('test')) {
					criteria.testing = false
				} else if (trimmed.toLowerCase().includes('performance')) {
					criteria.performance = false
				} else if (trimmed.toLowerCase().includes('documentation')) {
					criteria.documentation = false
				} else if (trimmed.toLowerCase().includes('maintainability') || trimmed.toLowerCase().includes('readable')) {
					criteria.maintainability = false
				} else {
					criteria.functionality = false
				}
			}
		}

		if (trimmed.startsWith('Suggestion:') || trimmed.startsWith('Recommendation:')) {
			suggestions.push(trimmed.replace(/^(Suggestion|Recommendation):\s*/, ''))
		}
	}

	const finalScore = totalChecks > 0 ? (score / totalChecks) * 100 : 0
	const approved = finalScore >= 80 && !issues.some(issue =>
		issue.toLowerCase().includes('security') ||
		issue.toLowerCase().includes('critical') ||
		issue.toLowerCase().includes('bug')
	)

	return {
		approved,
		score: Math.round(finalScore),
		issues,
		suggestions,
		criteria
	}
}

export function parseCodeReview (reviewResponse: string): ReviewResult {
	return parseReviewResponse(reviewResponse)
}
