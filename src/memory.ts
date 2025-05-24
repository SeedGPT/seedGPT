import * as fs from 'fs';

export async function loadMemory(cfg: any): Promise<string> {
	// e.g. read last summary file or query a vector DB for top-k memories
	return fs.existsSync(cfg.summaries + 'latest.txt')
		? fs.readFileSync(cfg.summaries + 'latest.txt', 'utf-8')
		: '';
}

export async function updateMemory(cfg: any, summary: string) {
	// append new summary and optionally embed into vector store
	fs.writeFileSync(cfg.summaries + Date.now() + '.md', summary);
	// also push into a vector DB here...
}
