import fs from 'fs'

import logger from './logger.js'
import { WorkspaceManager } from './workspaceManager.js'
import { Task } from './types.js'

export class BranchRecoveryManager {
	private workspaceManager: WorkspaceManager
	private recoveryLog: string

	constructor(workspaceManager: WorkspaceManager) {
		this.workspaceManager = workspaceManager
		this.recoveryLog = 'recovery.log'
	}

	async nukeBranchIfStuck(task: Task, branchName: string): Promise<boolean> {
		try {
			const shouldNuke = await this.evaluateNukeConditions(task)
			
			if (!shouldNuke) {
				return false
			}

			logger.warn('Nuking stuck branch for recovery', {
				taskId: task.id,
				branchName,
				reason: this.getNukeReason(task)
			})

			await this.performBranchNuke(branchName, task)
			await this.logRecoveryAction(task, branchName, 'BRANCH_NUKED')

			task.metadata = {
				...task.metadata,
				failureCount: (task.metadata?.failureCount || 0) + 1,
				lastAttempt: new Date().toISOString(),
				blockedReason: 'Branch nuked due to unrecoverable state'
			}

			return true
		} catch (error) {
			logger.error('Failed to nuke branch', { error, taskId: task.id, branchName })
			return false
		}
	}

	async performEmergencyReset(): Promise<void> {
		try {
			logger.warn('Performing emergency workspace reset')
			
			await this.workspaceManager.syncWithRemote()
			
			const workspacePath = this.workspaceManager.getWorkspacePath()
			if (fs.existsSync(workspacePath)) {
				fs.rmSync(workspacePath, { recursive: true, force: true })
			}
			
			await this.workspaceManager.initializeWorkspace()
			
			await this.logRecoveryAction(null, 'workspace', 'EMERGENCY_RESET')
			
			logger.info('Emergency workspace reset completed')
		} catch (error) {
			logger.error('Emergency reset failed', { error })
			throw error
		}
	}

	async attemptTaskRecovery(task: Task): Promise<boolean> {
		try {
			if (task.metadata?.failureCount && task.metadata.failureCount >= 3) {
				logger.info('Converting failed task to research task', { taskId: task.id })
				
				task.type = 'research'
				task.status = 'pending'
				task.metadata.blockedReason = 'Converted to research due to repeated failures'
				task.description = `Research: ${task.description}`
				
				await this.logRecoveryAction(task, 'task', 'CONVERTED_TO_RESEARCH')
				return true
			}

			if (task.metadata?.lastAttempt) {
				const hoursSinceAttempt = (Date.now() - new Date(task.metadata.lastAttempt).getTime()) / (1000 * 60 * 60)
				
				if (hoursSinceAttempt > 48) {
					logger.info('Resetting stale task', { taskId: task.id, hoursSinceAttempt })
					
					task.status = 'pending'
					task.metadata.blockedReason = undefined
					task.metadata.lastAttempt = undefined
					
					await this.logRecoveryAction(task, 'task', 'RESET_STALE_TASK')
					return true
				}
			}

			return false
		} catch (error) {
			logger.error('Task recovery failed', { error, taskId: task.id })
			return false
		}
	}
	async getRecoveryHistory(limit: number = 10): Promise<string[]> {
		try {
			const logPath = this.workspaceManager.getWorkspaceFilePath(this.recoveryLog)
			if (!fs.existsSync(logPath)) {
				return []
			}

			const content = fs.readFileSync(logPath, 'utf-8')
			const lines = content.split('\n').filter(line => line.trim())
			return lines.slice(-limit)
		} catch (error) {
			logger.error('Failed to read recovery history', { error })
			return []
		}
	}

	private async evaluateNukeConditions(task: Task): Promise<boolean> {
		const failureCount = task.metadata?.failureCount || 0
		const lastAttempt = task.metadata?.lastAttempt

		if (failureCount >= 3) {
			return true
		}

		if (lastAttempt) {
			const hoursSinceAttempt = (Date.now() - new Date(lastAttempt).getTime()) / (1000 * 60 * 60)
			if (hoursSinceAttempt > 24 && task.status === 'in-progress') {
				return true
			}
		}

		if (task.status === 'blocked' && task.metadata?.blockedReason?.includes('unrecoverable')) {
			return true
		}

		return false
	}

	private getNukeReason(task: Task): string {
		const failureCount = task.metadata?.failureCount || 0
		const lastAttempt = task.metadata?.lastAttempt

		if (failureCount >= 3) {
			return `Multiple failures (${failureCount})`
		}

		if (lastAttempt) {
			const hoursSinceAttempt = (Date.now() - new Date(lastAttempt).getTime()) / (1000 * 60 * 60)
			if (hoursSinceAttempt > 24) {
				return `Stuck for ${Math.round(hoursSinceAttempt)} hours`
			}
		}

		if (task.metadata?.blockedReason) {
			return task.metadata.blockedReason
		}

		return 'Unrecoverable state detected'
	}

	private async performBranchNuke(branchName: string, task: Task): Promise<void> {
		try {
			await this.workspaceManager.syncWithRemote()
			
			await this.workspaceManager.cleanupBranch(branchName)
			
			logger.info('Branch successfully nuked', { branchName, taskId: task.id })
		} catch (error) {
			logger.warn('Branch cleanup during nuke failed, continuing', { error, branchName })
		}
	}

	private async logRecoveryAction(task: Task | null, target: string, action: string): Promise<void> {
		try {
			const timestamp = new Date().toISOString()
			const taskInfo = task ? `Task #${task.id}` : 'System'
			const logEntry = `${timestamp} - ${taskInfo}: ${action} on ${target}\n`
			
			fs.appendFileSync(this.recoveryLog, logEntry)
		} catch (error) {
			logger.warn('Failed to log recovery action', { error })
		}
	}
}
