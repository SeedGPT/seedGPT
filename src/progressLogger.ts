import fs from 'fs'

export function appendProgress (filepath: string, entry: string): void {
	const now = new Date().toISOString()
	const formatted = `## ${now}\n\n${entry.trim()}\n\n---\n`
	fs.appendFileSync(filepath, formatted, 'utf-8')
}