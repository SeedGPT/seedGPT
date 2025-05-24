import OpenAI from 'openai';
import { callLLM } from './index.js';

export async function aiReviewPatch(messages: OpenAI.ChatCompletionMessageParam[]): Promise<string> {
	// Simply re-use callLLM under the hood; return the LLM’s review report
	// You’d import callLLM or wrap it here.
	return await callLLM(messages);
}
