import * as fs from 'fs'
import * as path from 'path'

import logger from './logger.js'
import { Config } from './types.js'
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

interface MemorySummary {
	timestamp: string
	type: 'task_completion' | 'system_change' | 'error_recovery' | 'milestone'
	content: string
	metadata: {
		taskId?: number
		prNumber?: number
		filesChanged?: string[]
		importance: 'low' | 'medium' | 'high'
	}
}

function ensureMemoryDirectories (memoryCfg: Config['memory']): void {
	const dirs = [
		path.dirname(memoryCfg.summaries),
		path.dirname(memoryCfg.store),
		path.join(path.dirname(memoryCfg.summaries), 'archives')
	]

	dirs.forEach(dir => {
		const workspaceDir = getWorkspacePath(dir)
		if (!fs.existsSync(workspaceDir)) {
			fs.mkdirSync(workspaceDir, { recursive: true })
		}
	})
}

function getMemoryFiles (summariesDir: string): string[] {
	try {
		const workspaceDir = getWorkspacePath(summariesDir)
		return fs.readdirSync(workspaceDir)
			.filter(f => f.endsWith('.json') || f.endsWith('.md'))
			.sort((a, b) => {
				const aTime = fs.statSync(path.join(workspaceDir, a)).mtime
				const bTime = fs.statSync(path.join(workspaceDir, b)).mtime
				return bTime.getTime() - aTime.getTime()
			})
	} catch (error) {
		logger.warn('Failed to read memory directory', { error, summariesDir })
		return []
	}
}

export async function loadMemory (memoryCfg: Config['memory']): Promise<string> {
	try {
		ensureMemoryDirectories(memoryCfg)

		const summariesDir = path.dirname(memoryCfg.summaries)
		const files = getMemoryFiles(summariesDir)

		if (files.length === 0) {
			return 'System initialization - no previous memory'
		}

		const recentSummaries: string[] = []
		const maxSummaries = 5
		let totalLength = 0
		const maxTotalLength = 3000
		for (const file of files.slice(0, maxSummaries)) {
			try {
				const filePath = getWorkspacePath(path.join(summariesDir, file))
				const content = fs.readFileSync(filePath, 'utf-8')

				if (file.endsWith('.json')) {
					const summary: MemorySummary = JSON.parse(content)
					const summaryText = `[${summary.timestamp}] ${summary.content}`

					if (totalLength + summaryText.length <= maxTotalLength) {
						recentSummaries.push(summaryText)
						totalLength += summaryText.length
					}
				} else {
					const truncated = content.slice(0, Math.min(500, maxTotalLength - totalLength))
					if (truncated.length > 0) {
						recentSummaries.push(truncated)
						totalLength += truncated.length
					}
				}

				if (totalLength >= maxTotalLength) { break }
			} catch (fileError) {
				logger.warn('Failed to read memory file', { error: fileError, file })
			}
		}

		const memoryContext = recentSummaries.length > 0
			? `Recent system memory (${files.length} total entries):\n${recentSummaries.join('\n---\n')}`
			: 'No readable memory summaries available'

		return memoryContext
	} catch (error) {
		logger.error('Failed to load memory', { error })
		return 'Memory system error - operating without context'
	}
}

export async function updateMemory (memoryCfg: Config['memory'], summary: string, metadata?: Partial<MemorySummary['metadata']>): Promise<void> {
	try {
		ensureMemoryDirectories(memoryCfg)

		const timestamp = new Date().toISOString()
		const memorySummary: MemorySummary = {
			timestamp,
			type: metadata?.taskId != null ? 'task_completion' : 'system_change',
			content: summary.trim(),
			metadata: {
				importance: 'medium',
				...metadata
			}
		}
		const summariesDir = path.dirname(memoryCfg.summaries)
		const filename = `${timestamp.replace(/[:.]/g, '-')}.json`
		const filepath = getWorkspacePath(path.join(summariesDir, filename))

		fs.writeFileSync(filepath, JSON.stringify(memorySummary, null, 2))

		const markdownPath = getWorkspacePath(memoryCfg.summaries + 'latest.txt')
		fs.writeFileSync(markdownPath, summary)

		await archiveOldMemories(summariesDir)

		logger.debug('Memory updated', { filepath, contentLength: summary.length })
	} catch (error) {
		logger.error('Failed to update memory', { error, summaryLength: summary.length })
	}
}

async function archiveOldMemories (summariesDir: string): Promise<void> {
	try {
		const files = getMemoryFiles(summariesDir)
		const maxFiles = 20

		if (files.length > maxFiles) {
			const workspaceSummariesDir = getWorkspacePath(summariesDir)
			const archiveDir = getWorkspacePath(path.join(summariesDir, 'archives'))
			const filesToArchive = files.slice(maxFiles)

			for (const file of filesToArchive) {
				const srcPath = path.join(workspaceSummariesDir, file)
				const destPath = path.join(archiveDir, file)
				fs.renameSync(srcPath, destPath)
			}

			logger.info(`Archived ${filesToArchive.length} old memory files`)
		}
	} catch (error) {
		logger.warn('Failed to archive old memories', { error })
	}
}
