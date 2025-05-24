import { OpenAI } from 'openai';
import { callLLM } from './index.js';

export async function summarizeMerge(messages: OpenAI.ChatCompletionMessageParam[]): Promise<string> {
	return await callLLM(messages);
}
