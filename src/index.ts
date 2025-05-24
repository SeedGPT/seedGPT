import * as fs from 'fs';
import dotenv from 'dotenv';
import simpleGit, { SimpleGit } from 'simple-git';
import { Octokit } from '@octokit/rest';
import Anthropic from '@anthropic-ai/sdk';

import { runSemgrepScan } from './securityScanner.js';
import { aiReviewPatch } from './codeReviewer.js';
import { summarizeMerge } from './summarizer.js';
import { loadMemory, updateMemory } from './memory.js';
import { loadConfig, loadTasks, saveTasks, Task } from './taskManager.js';
import { appendProgress } from './progressLogger.js';
import { generateNewTasks } from './taskGenerator.js';
import { AnthropicMessage } from './types.js';

dotenv.config();

const git: SimpleGit = simpleGit();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const cfg = loadConfig('agent-config.yaml');

async function buildSystemMessages(): Promise<{ system: string; messages: AnthropicMessage[] }> {
	const objectives = cfg.objectives.map((o: string) => `• ${o}`).join('\n');
	const system = `You are an autonomous agent with these objectives:\n${objectives}`;

	const memSum = await loadMemory(cfg.memory);
	const messages: AnthropicMessage[] = memSum
		? [{ role: 'user', content: `Memory Summary:\n${memSum}` }]
		: [];

	return { system, messages };
}

export async function callLLM(messages: AnthropicMessage[], systemPrompt?: string) {
	const resp = await anthropic.messages.create({
		model: 'claude-3-5-sonnet-20241022',
		max_tokens: 4096,
		system: systemPrompt,
		messages
	});
	return resp.content[0].type === 'text' ? resp.content[0].text : '';
}

async function run() {
	let tasks = loadTasks(cfg.files.tasks);

	const pending = tasks.filter(t => t.status === 'pending');
	if (pending.length === 0) {
		console.log('🧠 Backlog empty – asking LLM to generate new tasks…');
		const newTasks = await generateNewTasks(anthropic, cfg, tasks);
		if (newTasks.length) {
			tasks = tasks.concat(newTasks);
			saveTasks(cfg.files.tasks, tasks);
			console.log(`➕ Added ${newTasks.length} new task(s).`);
		} else {
			console.log('⚠️ LLM did not propose any new tasks. Halting.');
			return;
		}
	}

	const task = tasks.find(t => t.status === 'pending');
	if (!task) {
		console.log('✅ No tasks found after generation.');
		return;
	}

	console.log(`🛠 Working on Task #${task.id}: ${task.description}`);
	task.status = 'in-progress';
	saveTasks(cfg.files.tasks, tasks);

	const { system, messages: systemMsgs } = await buildSystemMessages();

	// PATCH GENERATION
	const patchPrompt = fs.readFileSync(cfg.prompts.patch, 'utf-8')
		.replace('{{TASK_DESC}}', task.description);
	let patch = await callLLM([
		...systemMsgs,
		{ role: 'user', content: patchPrompt }
	], system);

	// REVIEW
	const reviewPrompt = fs.readFileSync(cfg.prompts.review, 'utf-8')
		.replace('{{PATCH}}', patch);
	const reviewFeedback = await aiReviewPatch([
		...systemMsgs,
		{ role: 'user', content: reviewPrompt }
	], system);

	if (reviewFeedback.includes('✗')) {
		const fixPrompt = `Please fix this patch:\n${patch}\n\nBased on the following review:\n${reviewFeedback}`;
		patch = await callLLM([...systemMsgs, { role: 'user', content: fixPrompt }], system);
	}

	// APPLY PATCH
	const branch = `task-${task.id}`;
	await git.checkoutLocalBranch(branch);
	fs.writeFileSync('change.patch', patch);
	try {
		await git.raw(['apply', 'change.patch']);
	} catch (err) {
		console.error('❌ Failed to apply patch:', err);
		return;
	}

	// SECURITY SCAN
	const violations = await runSemgrepScan();
	if (violations.length > 0) {
		console.log(`🔒 Semgrep found issues:\n${violations.join('\n')}`);
		const fixPrompt = `Fix these Semgrep issues:\n${violations.join('\n')}`;
		const secPatch = await callLLM([...systemMsgs, { role: 'user', content: fixPrompt }], system);
		fs.writeFileSync('sec.fix.patch', secPatch);
		await git.raw(['apply', 'sec.fix.patch']);
	}

	// COMMIT & PR
	await git.add('.');
	await git.commit(`Task #${task.id}: ${task.description}`);
	await git.push('origin', branch);
	const pr = await octokit.pulls.create({
		owner: process.env.GITHUB_REPO_OWNER!,
		repo: process.env.GITHUB_REPO_NAME!,
		head: branch,
		base: 'main',
		title: `🔨 Task #${task.id}: ${task.description}`,
		body: patch
	});

	console.log(`📬 PR #${pr.data.number} created. Awaiting CI...`);

	// SIMPLIFIED: assume CI passes – in real use, you'd poll status here

	// SUMMARY
	const summarizePrompt = fs.readFileSync(cfg.prompts.summarize, 'utf-8')
		.replace('{{PR_NUMBER}}', pr.data.number.toString());
	const summary = await summarizeMerge([
		...systemMsgs,
		{ role: 'user', content: summarizePrompt }
	], system);
	appendProgress(cfg.files.progress, summary);
	await updateMemory(cfg.memory, summary);

	// COMPLETE TASK
	task.status = 'done';
	saveTasks(cfg.files.tasks, tasks);
	console.log(`✅ Task #${task.id} completed and logged.`);
}

run().catch(console.error);
