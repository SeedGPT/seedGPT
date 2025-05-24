import fs from 'fs';
import yaml from 'js-yaml';
import { OpenAI } from 'openai';
import { Task } from './taskManager';

export async function generateNewTasks(
	llm: OpenAI,
	cfg: any,
	existingTasks: Task[]
): Promise<Task[]> {
	// 1) Build system message with objectives
	const objectives = (cfg.objectives as string[])
		.map(o => `• ${o}`)
		.join('\n');
	const systemMsg: OpenAI.Chat.Completions.ChatCompletionMessageParam = {
		role: 'system',
		content: `You are an autonomous dev agent.  
Your objectives are:
${objectives}`
	};

	// 2) Build user prompt: show current tasks & memory summary
	const tasksYaml = yaml.dump(existingTasks);
	const memFile = cfg.memory.summaries + 'latest.txt';
	const memorySummary = fs.existsSync(memFile)
		? fs.readFileSync(memFile, 'utf-8')
		: '';

	const userMsg: OpenAI.Chat.Completions.ChatCompletionMessageParam = {
		role: 'user',
		content: `Here are the tasks I have so far:
\`\`\`yaml
${tasksYaml}
\`\`\`

Memory summary:
\`\`\`
${memorySummary}
\`\`\`

Please propose up to 5 new, non-duplicate tasks (id, description, priority: high|medium|low) that I can work on next to keep evolving.  
**Output ONLY valid JSON** in the format:

\`\`\`json
[
  { "id": 7, "description": "...", "priority": "medium", "status": "pending" },
  …
]
\`\`\`
`
	};

	// 3) Call the LLM
	const resp = await llm.chat.completions.create({
		model: 'gpt-4',
		messages: [systemMsg, userMsg],
		temperature: 0.7
	});

	// 4) Parse its JSON output
	const content = resp.choices[0].message?.content || '[]';
	let newTasks: Task[];
	try {
		newTasks = JSON.parse(content) as Task[];
	} catch (err) {
		console.error('Failed to parse tasks JSON:', err, content);
		return [];
	}

	return newTasks;
}
