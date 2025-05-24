import fs from 'fs';
import yaml from 'js-yaml';
import Anthropic from '@anthropic-ai/sdk';
import { Task } from './taskManager';

export async function generateNewTasks(
	anthropic: Anthropic,
	cfg: any,
	existingTasks: Task[]
): Promise<Task[]> {
	// 1) Build system message with objectives
	const objectives = (cfg.objectives as string[])
		.map(o => `• ${o}`)
		.join('\n');
	const systemPrompt = `You are an autonomous dev agent.  
Your objectives are:
${objectives}`;

	// 2) Build user prompt: show current tasks & memory summary
	const tasksYaml = yaml.dump(existingTasks);
	const memFile = cfg.memory.summaries + 'latest.txt';
	const memorySummary = fs.existsSync(memFile)
		? fs.readFileSync(memFile, 'utf-8')
		: '';

	const userContent = `Here are the tasks I have so far:
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
`;

	// 3) Call the LLM
	const resp = await anthropic.messages.create({
		model: 'claude-3-5-sonnet-20241022',
		max_tokens: 4096,
		system: systemPrompt,
		messages: [{ role: 'user', content: userContent }]
	});

	// 4) Parse its JSON output
	const content = resp.content[0].type === 'text' ? resp.content[0].text : '[]';
	let newTasks: Task[];
	try {
		newTasks = JSON.parse(content) as Task[];
	} catch (err) {
		console.error('Failed to parse tasks JSON:', err, content);
		return [];
	}

	return newTasks;
}
