import {
	buildSystemPrompt,
	getTaskGenerationPrompt,
	getPatchGenerationPrompt,
	getReviewPrompt,
	getSummarizePrompt
} from '../src/systemPrompt.js'
import { Config } from '../src/types.js'

describe('SystemPrompt', () => {
	const mockConfig: Config = {
		objectives: [
			'Maintain 100% test coverage',
			'Run security scans',
			'Update documentation'
		],
		workingDirectory: './workspace',
		git: {
			remoteName: 'origin',
			mainBranch: 'main'
		},
		memory: {
			store: './memory.db',
			summaries: './summaries/'
		},
		files: {
			tasks: './tasks.yaml',
			progress: './PROGRESS.md',
			changelog: './CHANGELOG.md'
		},
		prompts: {
			patch: './prompts/patch_generation.template',
			review: './prompts/patch_review.template',
			summarize: './prompts/merge_summarize.template'
		},
		ci: {
			maxWaitMinutes: 30,
			pollIntervalSeconds: 60
		},
		models: {
			important: 'claude-2',
			routine: 'claude-instant-100k'
		}
	}

	describe('buildSystemPrompt', () => {
		it('should create system prompt with objectives', () => {
			const result = buildSystemPrompt(mockConfig)

			expect(result.content).toContain('SeedGPT')
			expect(result.content).toContain('autonomous software engineer')
			expect(result.content).toContain('Maintain 100% test coverage')
			expect(result.content).toContain('Run security scans')
			expect(result.content).toContain('Update documentation')
			expect(result.version).toBe('2.0.1')
		})
		it('should include critical instructions', () => {
			const result = buildSystemPrompt(mockConfig)

			expect(result.content).toContain('CRITICAL INSTRUCTIONS')
			expect(result.content).toContain('return ONLY the code/patch content')
			expect(result.content).toContain('I never modify source files directly')
			expect(result.content).toContain('I always work on feature branches')
		})
	})
	describe('getTaskGenerationPrompt', () => {
		it('should return task generation prompt', () => {
			const result = getTaskGenerationPrompt()

			expect(result).toContain('generate 3-5 strategic tasks')
			expect(result).toContain('Return ONLY valid JSON')
			expect(result).toContain('Clear description')
			expect(result).toContain('priority')
		})
	})

	describe('getPatchGenerationPrompt', () => {
		it('should return patch generation prompt with task description', () => {
			const taskDesc = 'Add unit tests for task manager'
			const result = getPatchGenerationPrompt(taskDesc)

			expect(result).toContain(`Task: ${taskDesc}`)
			expect(result).toContain('Generate a clean, well-structured git patch')
			expect(result).toContain('unified diff format')
			expect(result).toContain('Return ONLY the patch content')
		})
	})

	describe('getReviewPrompt', () => {
		it('should return review prompt with patch content', () => {
			const patch = 'diff --git a/test.ts b/test.ts\n+console.log("test");'
			const result = getReviewPrompt(patch)

			expect(result).toContain('Conduct a thorough code review')
			expect(result).toContain('[✓/✗]')
			expect(result).toContain('Implements intended functionality correctly')
			expect(result).toContain(patch)
		})
	})

	describe('getSummarizePrompt', () => {
		it('should return summarize prompt with PR details', () => {
			const prNumber = '123'
			const taskDesc = 'Add unit tests'
			const result = getSummarizePrompt(prNumber, taskDesc)

			expect(result).toContain(`PR #${prNumber}`)
			expect(result).toContain(`task: ${taskDesc}`)
			expect(result).toContain('What functionality was implemented')
			expect(result).toContain('Key architectural or design decisions')
			expect(result).toContain('Return ONLY the summary text')
		})
	})
})
