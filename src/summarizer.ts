import { AnthropicMessage } from './types.js';
import { callLLM } from './index.js';

export async function summarizeMerge(messages: AnthropicMessage[], systemPrompt?: string): Promise<string> {
	return await callLLM(messages, systemPrompt);
}
