import Anthropic from '@anthropic-ai/sdk'

import logger from './logger.js'
import {
	buildSystemPrompt,
	getCodeFixPrompt
} from './systemPrompt.js'
import { AnthropicMessage, Config, Task } from './types.js'

export class LLMClient {
	private anthropic: Anthropic
	private systemPrompt: string
	private cfg: Config

	constructor (anthropic: Anthropic, cfg: Config) {
		this.anthropic = anthropic
		this.cfg = cfg
		this.systemPrompt = buildSystemPrompt(cfg).content
	}

	async generateResponse (messages: AnthropicMessage[], useImportantModel = false): Promise<string> {
		try {
			const model = useImportantModel ? this.cfg.models.important : this.cfg.models.routine

			const resp = await this.anthropic.messages.create({
				model,
				max_tokens: 4096,
				system: this.systemPrompt,
				messages
			})

			const content = resp.content[0].type === 'text' ? resp.content[0].text : ''

			if (!content.trim()) {
				throw new Error('Empty response from LLM')
			}

			return content
		} catch (error) {
			logger.error('LLM request failed', { error })
			throw error
		}
	}
	extractCodeFromResponse (response: string): string {
		const diffMatch = response.match(/```diff\s*([\s\S]*?)\s*```/)
		if (diffMatch) {
			return this.cleanPatch(diffMatch[1])
		}

		const codeMatch = response.match(/```[\w]*\s*([\s\S]*?)\s*```/)
		if (codeMatch) {
			return this.cleanPatch(codeMatch[1])
		}

		const lines = response.split('\n')
		const diffStartIndex = lines.findIndex(line =>
			line.startsWith('diff --git') ||
			line.startsWith('--- ') ||
			line.startsWith('+++ ')
		)

		if (diffStartIndex !== -1) {
			const patchLines = lines.slice(diffStartIndex)
			return this.cleanPatch(patchLines.join('\n'))
		}

		if (response.includes('@@') || response.includes('+++') || response.includes('---')) {
			return this.cleanPatch(response)
		}

		throw new Error('No valid code/patch found in LLM response')
	}

	private cleanPatch(patch: string): string {
		return patch
			.split('\n')
			.map(line => line.trimEnd()) // Remove trailing whitespace
			.join('\n')
			.trim() // Remove leading/trailing empty lines
			.replace(/\n+$/, '\n') // Ensure single trailing newline
	}

	extractJsonFromResponse (response: string): unknown[] {
		try {
			const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/)
			const jsonContent = jsonMatch ? jsonMatch[1] : response

			const arrayMatch = jsonContent.match(/\[[\s\S]*\]/)
			if (arrayMatch) {
				const parsed = JSON.parse(arrayMatch[0])
				if (!Array.isArray(parsed)) {
					throw new Error('Expected JSON array but got different type')
				}
				return parsed
			}

			const parsed = JSON.parse(jsonContent.trim())
			return Array.isArray(parsed) ? parsed : [parsed]
		} catch (error) {
			logger.error('Failed to extract JSON from response', {
				error,
				response: response.slice(0, 200)
			})
			throw error
		}
	}

	async generateTasks (messages: AnthropicMessage[]): Promise<Task[]> {
		const response = await this.generateResponse(messages, true)
		return this.extractJsonFromResponse(response) as Task[]
	}

	async generatePatch (messages: AnthropicMessage[]): Promise<string> {
		const response = await this.generateResponse(messages, true)
		return this.extractCodeFromResponse(response)
	}

	async generateReview (messages: AnthropicMessage[]): Promise<string> {
		return await this.generateResponse(messages, true)
	}

	async generateSummary (messages: AnthropicMessage[]): Promise<string> {
		const response = await this.generateResponse(messages, false)
		return response.trim()
	}

	async generateCodeFix (patch: string, reviewFeedback: string, contextMessages: AnthropicMessage[]): Promise<string> {
		const prompt = getCodeFixPrompt(patch, reviewFeedback)
		const messages = [...contextMessages, { role: 'user' as const, content: prompt }]
		return await this.generatePatch(messages)
	}
}
