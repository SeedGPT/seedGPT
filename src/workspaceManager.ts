import * as fs from 'fs'
import * as path from 'path'

import { SimpleGit } from 'simple-git'

import logger from './logger.js'
import { Config } from './types.js'

export class WorkspaceManager {
	private git: SimpleGit
	private workspacePath: string
	private cfg: Config

	constructor (git: SimpleGit, cfg: Config) {
		this.git = git
		this.cfg = cfg
		this.workspacePath = path.resolve(cfg.workingDirectory)
	}

	async initializeWorkspace (): Promise<void> {
		try {
			await this.ensureCleanWorkspace()
			await this.git.cwd(this.workspacePath)
			await this.syncWithRemote()

			logger.info('Workspace initialized and synced', { path: this.workspacePath })
		} catch (error) {
			logger.error('Failed to initialize workspace', { error, path: this.workspacePath })
			throw error
		}
	}

	private async ensureCleanWorkspace (): Promise<void> {
		if (fs.existsSync(this.workspacePath)) {
			try {
				await this.git.cwd(this.workspacePath)
				const status = await this.git.status()

				if (status.files.length > 0) {
					logger.warn('Workspace has uncommitted changes, cleaning up')
					await this.git.reset(['--hard', 'HEAD'])
					await this.git.clean(['-fd'])
				}

				logger.debug('Using existing workspace')
			} catch (error) {
				logger.warn('Existing workspace corrupted, recreating', { error })
				fs.rmSync(this.workspacePath, { recursive: true, force: true })
				await this.cloneRepository()
			}
		} else {
			await this.cloneRepository()
		}
	}

	private async cloneRepository (): Promise<void> {
		fs.mkdirSync(this.workspacePath, { recursive: true })

		const repoUrl = `https://github.com/${process.env.GITHUB_REPO_OWNER}/${process.env.GITHUB_REPO_NAME}.git`
		await this.git.clone(repoUrl, this.workspacePath)
		await this.git.cwd(this.workspacePath)

		logger.info('Repository cloned to workspace')
	}

	async syncWithRemote (): Promise<void> {
		try {
			const currentBranch = await this.git.branch()

			if (currentBranch.current !== this.cfg.git.mainBranch) {
				await this.git.checkout(this.cfg.git.mainBranch)
			}

			await this.git.fetch(this.cfg.git.remoteName)
			await this.git.reset(['--hard', `${this.cfg.git.remoteName}/${this.cfg.git.mainBranch}`])

			logger.debug('Synced with remote main branch')
		} catch (error) {
			logger.error('Failed to sync with remote', { error })
			throw error
		}
	}

	async createFeatureBranch (taskId: number): Promise<string> {
		try {
			await this.syncWithRemote()

			const branchName = `feature/task-${taskId}-${Date.now()}`
			await this.git.checkoutLocalBranch(branchName)

			logger.info('Created feature branch', { branch: branchName })
			return branchName
		} catch (error) {
			logger.error('Failed to create feature branch', { error, taskId })
			throw error
		}
	}

	async applyPatch (patchContent: string, taskId: number): Promise<void> {
		try {
			const patchFile = path.join(this.workspacePath, `task-${taskId}.patch`)
			fs.writeFileSync(patchFile, patchContent)

			await this.git.raw(['apply', '--index', patchFile])
			fs.unlinkSync(patchFile)

			logger.debug('Patch applied successfully', { taskId })
		} catch (error) {
			logger.error('Failed to apply patch', { error, taskId })
			throw error
		}
	}

	async commitAndPush (taskId: number, description: string, branchName: string): Promise<void> {
		try {
			await this.git.add('.')
			await this.git.commit(`Task #${taskId}: ${description}`)
			await this.git.push(['-u', this.cfg.git.remoteName, branchName])

			logger.info('Changes committed and pushed', { taskId, branch: branchName })
		} catch (error) {
			logger.error('Failed to commit and push', { error, taskId, branch: branchName })
			throw error
		}
	}

	async cleanupBranch (branchName: string): Promise<void> {
		try {
			await this.syncWithRemote()

			try {
				await this.git.push([this.cfg.git.remoteName, '--delete', branchName])
			} catch (error) {
				logger.debug('Remote branch already deleted or does not exist', { branch: branchName, error })
			}

			try {
				await this.git.deleteLocalBranch(branchName, true)
			} catch (error) {
				logger.debug('Local branch already deleted or does not exist', { branch: branchName, error })
			}

			logger.debug('Cleaned up branch', { branch: branchName })
		} catch (error) {
			logger.warn('Failed to cleanup branch', { error, branch: branchName })
		}
	}

	getWorkspacePath (): string {
		return this.workspacePath
	}

	async runInWorkspace<T> (command: () => Promise<T>): Promise<T> {
		const originalCwd = process.cwd()
		try {
			process.chdir(this.workspacePath)
			return await command()
		} finally {
			process.chdir(originalCwd)
		}
	}
}
