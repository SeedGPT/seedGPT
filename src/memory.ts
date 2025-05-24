import * as fs from 'fs'

import { Config } from './types'

export async function loadMemory (memoryCfg: Config['memory']): Promise<string> {
	return fs.existsSync(memoryCfg.summaries + 'latest.txt')
		? fs.readFileSync(memoryCfg.summaries + 'latest.txt', 'utf-8')
		: ''
}

export async function updateMemory (memoryCfg: Config['memory'], summary: string) {
	fs.writeFileSync(memoryCfg.summaries + Date.now() + '.md', summary)
}
