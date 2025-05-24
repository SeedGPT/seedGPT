import { AnthropicMessage } from './types.js'

import { callLLM } from './index.js'

export async function aiReviewPatch (messages: AnthropicMessage[], systemPrompt?: string): Promise<string> {
	return await callLLM(messages, systemPrompt)
}
