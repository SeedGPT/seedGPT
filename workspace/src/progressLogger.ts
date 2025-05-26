import fs from 'fs'
import path from 'path'

import logger from './logger.js'
import { WorkspaceManager } from './workspaceManager.js'

let workspaceManager: WorkspaceManager | null = null

export function setWorkspaceManager(manager: WorkspaceManager) {
	workspaceManager = manager
}

function getWorkspacePath(filePath: string): string {
	if (workspaceManager && !path.isAbsolute(filePath)) {
		return workspaceManager.getWorkspaceFilePath(filePath)
	}
	return filePath
}

interface ProgressEntry {
	timestamp: string
	type: 'task_completion' | 'milestone' | 'error' | 'system_update'
	content: string
	metadata?: {
		taskId?: number
		prNumber?: number
		filesChanged?: number
		linesAdded?: number
		linesRemoved?: number
		duration?: number
	}
}

function formatProgressEntry (entry: ProgressEntry): string {
	const { timestamp, content, metadata } = entry

	let header = `## ${timestamp}`
	if (metadata?.taskId != null && metadata.taskId > 0) {
		header += ` - Task #${metadata.taskId}`
	}
	if (metadata?.prNumber != null && metadata.prNumber > 0) {
		header += ` (PR #${metadata.prNumber})`
	}

	let metadataSection = ''
	if (metadata) {
		const metaItems: string[] = []
		if (metadata.filesChanged != null && metadata.filesChanged > 0) { metaItems.push(`${metadata.filesChanged} files changed`) }
		if (metadata.linesAdded !== undefined && metadata.linesRemoved !== undefined) {
			metaItems.push(`+${metadata.linesAdded}/-${metadata.linesRemoved} lines`)
		}
		if (metadata.duration != null && !isNaN(metadata.duration) && metadata.duration > 0) { metaItems.push(`${Math.round(metadata.duration)}s duration`) }

		if (metaItems.length > 0) {
			metadataSection = `\n*${metaItems.join(' • ')}*\n`
		}
	}

	return `${header}\n${metadataSection}\n${content.trim()}\n\n---\n`
}

export function appendProgress (filepath: string, entry: string | ProgressEntry, metadata?: ProgressEntry['metadata']): void {
	try {
		const progressEntry: ProgressEntry = typeof entry === 'string'
			? {
				timestamp: new Date().toISOString(),
				type: 'task_completion',
				content: entry,
				metadata
			}
			: entry

		const formattedEntry = formatProgressEntry(progressEntry)
		ensureProgressFile(filepath)
		const workspacePath = getWorkspacePath(filepath)
		fs.appendFileSync(workspacePath, formattedEntry, 'utf-8')

		rotateProgressLog(filepath)

		logger.debug('Progress logged', {
			type: progressEntry.type,
			contentLength: progressEntry.content.length,
			metadata: progressEntry.metadata
		})
	} catch (error) {
		logger.error('Failed to append progress', { error, filepath })
	}
}

function ensureProgressFile (filepath: string): void {
	const workspacePath = getWorkspacePath(filepath)
	if (!fs.existsSync(workspacePath)) {
		const dir = path.dirname(workspacePath)
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true })
		}

		const header = `# SeedGPT Evolution Progress

This file tracks the autonomous evolution of the SeedGPT system.

**Started:** ${new Date().toISOString()}

---
`
		fs.writeFileSync(workspacePath, header, 'utf-8')
	}
}

function rotateProgressLog (filepath: string): void {
	try {
		const workspacePath = getWorkspacePath(filepath)
		const stats = fs.statSync(workspacePath)
		const maxSizeBytes = 2 * 1024 * 1024

		if (stats.size > maxSizeBytes) {
			const timestamp = new Date().toISOString().slice(0, 10)
			const archivePath = workspacePath.replace('.md', `-${timestamp}.md`)

			fs.renameSync(workspacePath, archivePath)

			const newHeader = `# SeedGPT Evolution Progress (Continued)

Previous logs archived to: ${path.basename(archivePath)}

**Continued:** ${new Date().toISOString()}

---
`
			fs.writeFileSync(workspacePath, newHeader, 'utf-8')

			logger.info('Progress log rotated', { archivePath, newSize: 0 })
		}
	} catch (error) {
		logger.warn('Failed to rotate progress log', { error, filepath })
	}
}

export function getRecentProgress (filepath: string, maxEntries: number = 5): ProgressEntry[] {
	try {
		const workspacePath = getWorkspacePath(filepath)
		if (!fs.existsSync(workspacePath)) {
			return []
		}

		const content = fs.readFileSync(workspacePath, 'utf-8')
		const sections = content.split('---').slice(1, -1)

		return sections
			.slice(-maxEntries)
			.map(section => {
				const lines = section.trim().split('\n')
				const headerLine = lines.find(line => line.startsWith('##'))
				const matchResult = headerLine?.match(/## (.+?)(?:\s-|$)/)
				const timestamp = matchResult?.[1] ?? new Date().toISOString()

				return {
					timestamp,
					type: 'task_completion' as const,
					content: lines.slice(1).join('\n').trim()
				}
			})
			.reverse()
	} catch (error) {
		logger.error('Failed to get recent progress', { error, filepath })
		return []
	}
}