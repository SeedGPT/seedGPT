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

	getWorkspacePath(): string {
		return this.workspacePath
	}

	getWorkspaceFilePath(relativePath: string): string {
		return path.join(this.workspacePath, relativePath)
	}

	getGit(): SimpleGit {
		return this.git
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

		const token = process.env.GITHUB_TOKEN!
		const owner = process.env.GITHUB_REPO_OWNER!
		const repo = process.env.GITHUB_REPO_NAME!
		const repoUrl = `https://${token}@github.com/${owner}/${repo}.git`
		
		await this.git.clone(repoUrl, this.workspacePath)
		await this.git.cwd(this.workspacePath)

		// Configure git with credentials for future operations
		await this.git.addConfig('user.name', 'SeedGPT')
		await this.git.addConfig('user.email', 'agent.seedgpt@gmail.com')

		logger.info('Repository cloned to workspace')
	}
	async syncWithRemote (): Promise<void> {
		try {
			const currentBranch = await this.git.branch()

			// Always fetch latest from remote first
			await this.git.fetch(this.cfg.git.remoteName)

			// If not on main branch, switch to it
			if (currentBranch.current !== this.cfg.git.mainBranch) {
				try {
					await this.git.checkout(this.cfg.git.mainBranch)
				} catch (checkoutError) {
					logger.warn(`Failed to checkout ${this.cfg.git.mainBranch}, may not exist locally`, { checkoutError })
					// Try to create local main branch from remote
					await this.git.checkout(['-b', this.cfg.git.mainBranch, `${this.cfg.git.remoteName}/${this.cfg.git.mainBranch}`])
				}
			}

			// Reset to latest remote state
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
			
			// Check current status before creating branch
			const currentBranch = await this.git.branch()
			logger.debug('Creating feature branch', { 
				taskId, 
				newBranch: branchName,
				currentBranch: currentBranch.current,
				workspacePath: this.workspacePath
			})

			// Ensure we're on main branch before creating feature branch
			if (currentBranch.current !== this.cfg.git.mainBranch) {
				await this.git.checkout(this.cfg.git.mainBranch)
			}

			await this.git.checkoutLocalBranch(branchName)

			// Verify branch creation
			const newBranch = await this.git.branch()
			if (newBranch.current !== branchName) {
				throw new Error(`Branch creation failed: expected ${branchName}, got ${newBranch.current}`)
			}

			logger.info('Created feature branch', { branch: branchName, taskId })
			return branchName
		} catch (error) {
			logger.error('Failed to create feature branch', { 
				error, 
				taskId,
				workspacePath: this.workspacePath,
				errorMessage: error instanceof Error ? error.message : String(error)
			})
			throw error
		}
	}

	private sanitizePatch(patchContent: string): string {
		return patchContent
			.split('\n')
			.map(line => line.trimEnd()) // Remove trailing whitespace
			.join('\n')
			.replace(/\n+$/, '\n') // Ensure single trailing newline
	}	private async tryApplyPatchMethods(patchContent: string, taskId: number): Promise<void> {
		const sanitizedPatch = this.sanitizePatch(patchContent)
		const patchFile = path.join(this.workspacePath, `task-${taskId}.patch`)
		
		// Check workspace state before applying
		const status = await this.git.status()
		logger.debug('Workspace state before patch application', { 
			taskId, 
			currentBranch: status.current,
			filesModified: status.files.length,
			isClean: status.isClean()
		})
		
		try {
			// Method 1: Try with --index (staged)
			fs.writeFileSync(patchFile, sanitizedPatch)
			await this.git.raw(['apply', '--index', patchFile])
			logger.debug('Patch applied successfully with --index', { taskId })
			return
		} catch (error1: any) {
			logger.debug('Failed to apply patch with --index, trying without', { 
				taskId, 
				error: error1.message || error1,
				stderr: error1.stderr || 'No stderr'
			})
			
			try {
				// Method 2: Try without --index (working directory only)
				await this.git.raw(['apply', patchFile])
				await this.git.add('.')
				logger.debug('Patch applied successfully without --index', { taskId })
				return
			} catch (error2: any) {
				logger.debug('Failed to apply patch normally, trying with --whitespace=fix', { 
					taskId, 
					error: error2.message || error2,
					stderr: error2.stderr || 'No stderr'
				})
				
				try {
					// Method 3: Try with whitespace fixing
					await this.git.raw(['apply', '--whitespace=fix', patchFile])
					await this.git.add('.')
					logger.debug('Patch applied successfully with --whitespace=fix', { taskId })
					return
				} catch (error3: any) {
					logger.debug('Failed to apply patch with whitespace fix, trying manual application', { 
						taskId, 
						error: error3.message || error3,
						stderr: error3.stderr || 'No stderr'
					})
					
					// Method 4: Manual file application as fallback
					await this.manuallyApplyPatch(sanitizedPatch, taskId)
					logger.debug('Patch applied successfully with manual method', { taskId })
					return
				}
			}
		}
	}
	private async manuallyApplyPatch(patchContent: string, taskId: number): Promise<void> {
		const lines = patchContent.split('\n')
		const fileOperations: Map<string, { additions: string[], deletions: Set<string>, isNewFile: boolean }> = new Map()
		let currentFile: string | null = null
		let currentOperation: { additions: string[], deletions: Set<string>, isNewFile: boolean } | null = null
		
		for (const line of lines) {
			if (line.startsWith('diff --git')) {
				const match = line.match(/diff --git a\/(.+) b\/(.+)/)
				if (match) {
					currentFile = match[2]
					if (currentFile !== '/dev/null') {
						currentOperation = { additions: [], deletions: new Set(), isNewFile: false }
						fileOperations.set(currentFile, currentOperation)
					}
				}
			} else if (line.startsWith('new file mode')) {
				if (currentOperation) {
					currentOperation.isNewFile = true
				}
			} else if (line.startsWith('+++')) {
				const match = line.match(/\+\+\+ b\/(.+)/)
				if (match) {
					currentFile = match[1]
				}
			} else if (line.startsWith('+') && !line.startsWith('+++') && currentOperation) {
				const content = line.substring(1)
				currentOperation.additions.push(content)
			} else if (line.startsWith('-') && !line.startsWith('---') && currentOperation) {
				const content = line.substring(1)
				currentOperation.deletions.add(content)
			}
		}
		
		// Apply changes to files
		let filesModified = 0
		for (const [filePath, operation] of fileOperations) {
			const fullPath = path.join(this.workspacePath, filePath)
			const dir = path.dirname(fullPath)
			
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true })
			}
			
			if (operation.isNewFile || !fs.existsSync(fullPath)) {
				// Create new file with additions
				fs.writeFileSync(fullPath, operation.additions.join('\n') + '\n')
				filesModified++
			} else {
				// Modify existing file
				let content = fs.readFileSync(fullPath, 'utf-8')
				let lines = content.split('\n')
				
				// Remove deleted lines
				for (const deletedLine of operation.deletions) {
					const index = lines.indexOf(deletedLine)
					if (index !== -1) {
						lines.splice(index, 1)
					}
				}
				
				// Add new lines (simple append for now)
				lines.push(...operation.additions)
				
				// Remove empty trailing lines and ensure single newline at end
				while (lines.length > 0 && lines[lines.length - 1] === '') {
					lines.pop()
				}
				
				const newContent = lines.join('\n') + '\n'
				if (newContent !== content) {
					fs.writeFileSync(fullPath, newContent)
					filesModified++
				}
			}
		}
		
		await this.git.add('.')
		logger.info('Applied patch manually', { taskId, filesChanged: filesModified })
	}
	async applyPatch (patchContent: string, taskId: number): Promise<void> {
		try {
			logger.debug('Applying patch', { 
				taskId, 
				patchLength: patchContent.length,
				patchPreview: patchContent.substring(0, 200) + (patchContent.length > 200 ? '...' : '')
			})

			// Validate patch content before attempting to apply
			const patchValidation = this.validatePatchContent(patchContent)
			if (!patchValidation.valid) {
				throw new Error(`Invalid patch content: ${patchValidation.reason}`)
			}

			await this.tryApplyPatchMethods(patchContent, taskId)
			
			// Validate that meaningful changes were made
			const workspaceValidation = await this.validateWorkspaceForCommit()
			if (!workspaceValidation.hasChanges) {
				logger.warn('Patch applied but no meaningful changes detected', { 
					taskId, 
					reason: workspaceValidation.reason 
				})
			}
			
			// Clean up patch file
			const patchFile = path.join(this.workspacePath, `task-${taskId}.patch`)
			try {
				if (fs.existsSync(patchFile)) {
					fs.unlinkSync(patchFile)
				}
			} catch (cleanupError) {
				// Ignore cleanup errors
			}

			logger.debug('Patch applied successfully', { taskId })
		} catch (error) {
			const patchFile = path.join(this.workspacePath, `task-${taskId}.patch`)
			
			// Log patch content for debugging
			let patchPreview = 'Unable to read patch content'
			try {
				const content = fs.readFileSync(patchFile, 'utf-8')
				patchPreview = content.substring(0, 500) + (content.length > 500 ? '...' : '')
			} catch (readError) {
				// Ignore read errors
			}

			// Check workspace status
			let workspaceStatus = 'Unknown'
			try {
				const status = await this.git.status()
				workspaceStatus = `${status.files.length} files changed, current branch: ${status.current || 'unknown'}`
			} catch (statusError) {
				workspaceStatus = `Status check failed: ${statusError}`
			}

			// Clean up patch file
			try {
				if (fs.existsSync(patchFile)) {
					fs.unlinkSync(patchFile)
				}
			} catch (cleanupError) {
				// Ignore cleanup errors
			}

			logger.error('Failed to apply patch', { 
				error, 
				taskId, 
				patchPreview,
				workspaceStatus,
				workspacePath: this.workspacePath
			})
			throw error
		}
	}	async commitAndPush (taskId: number, description: string, branchName: string): Promise<void> {
		try {
			// Use enhanced validation to check for meaningful changes
			const validation = await this.validateWorkspaceForCommit()
			if (!validation.hasChanges) {
				logger.info('No meaningful changes to commit', { 
					taskId, 
					branch: branchName, 
					reason: validation.reason 
				})
				return
			}

			await this.git.add('.')
			
			// Verify files were staged
			const postAddStatus = await this.git.status()
			if (postAddStatus.staged.length === 0) {
				logger.info('No staged changes after git add', { taskId, branch: branchName })
				return
			}

			await this.git.commit(`Task #${taskId}: ${description}`)
			
			// Set up authenticated remote URL for push
			const token = process.env.GITHUB_TOKEN!
			const owner = process.env.GITHUB_REPO_OWNER!
			const repo = process.env.GITHUB_REPO_NAME!
			const authUrl = `https://${token}@github.com/${owner}/${repo}.git`
			
			await this.git.removeRemote(this.cfg.git.remoteName).catch(() => {})
			await this.git.addRemote(this.cfg.git.remoteName, authUrl)
					await this.git.push(['-u', this.cfg.git.remoteName, branchName])

			logger.info('Changes committed and pushed', { 
				taskId, 
				branch: branchName,
				stagedFiles: postAddStatus.staged.length
			})
		} catch (error) {
			logger.error('Failed to commit and push', { error, taskId, branch: branchName })
			throw error
		}
	}
	async cleanupBranch (branchName: string): Promise<void> {
		try {
			await this.syncWithRemote()

			try {
				// Set up authenticated remote URL for deletion
				const token = process.env.GITHUB_TOKEN!
				const owner = process.env.GITHUB_REPO_OWNER!
				const repo = process.env.GITHUB_REPO_NAME!
				const authUrl = `https://${token}@github.com/${owner}/${repo}.git`
				
				await this.git.removeRemote(this.cfg.git.remoteName).catch(() => {})
				await this.git.addRemote(this.cfg.git.remoteName, authUrl)
				
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
		}	}

	async runInWorkspace<T> (command: () => Promise<T>): Promise<T> {
		const originalCwd = process.cwd()
		try {
			process.chdir(this.workspacePath)
			return await command()
		} finally {
			process.chdir(originalCwd)
		}
	}

	async hasCommitsBetweenBranches(sourceBranch: string, targetBranch: string = 'main'): Promise<boolean> {
		try {
			await this.syncWithRemote()
			
			const result = await this.git.raw([
				'rev-list',
				'--count',
				`${this.cfg.git.remoteName}/${targetBranch}..${sourceBranch}`
			])
			
			const commitCount = parseInt(result.trim(), 10)
			logger.debug('Commits between branches', { 
				sourceBranch, 
				targetBranch, 
				commitCount 
			})
			
			return commitCount > 0
		} catch (error) {
			logger.error('Failed to check commits between branches', { 
				error, 
				sourceBranch, 
				targetBranch 
			})
			// Conservative approach: assume there are commits if we can't check
			return true
		}
	}

	async validateBranchForPR(branchName: string): Promise<{ valid: boolean; reason?: string }> {
		try {
			// Check if branch exists locally
			const branches = await this.git.branch()
			if (!branches.all.includes(branchName)) {
				return { valid: false, reason: `Branch ${branchName} does not exist locally` }
			}

			// Check if there are commits between this branch and main
			const hasCommits = await this.hasCommitsBetweenBranches(branchName)
			if (!hasCommits) {
				return { valid: false, reason: `No commits between ${branchName} and main branch` }
			}

			// Check if branch has been pushed to remote
			try {
				await this.git.raw(['ls-remote', '--exit-code', this.cfg.git.remoteName, branchName])
			} catch (error) {
				return { valid: false, reason: `Branch ${branchName} has not been pushed to remote` }
			}

			return { valid: true }
		} catch (error) {
			logger.error('Failed to validate branch for PR', { error, branchName })
			return { valid: false, reason: `Validation failed: ${error}` }
		}
	}
	validatePatchContent(patchContent: string): { valid: boolean; reason?: string } {
		if (!patchContent || patchContent.trim().length === 0) {
			return { valid: false, reason: 'Patch content is empty' }
		}

		const trimmedContent = patchContent.trim()
		
		// Check if it contains actual diff content
		if (!trimmedContent.includes('diff --git') && !trimmedContent.includes('@@')) {
			return { valid: false, reason: 'Patch does not contain valid diff format' }
		}

		// Check for meaningful changes (not just whitespace)
		const hasAdditions = /\n\+(?!\+\+)/.test(trimmedContent)
		const hasDeletions = /\n-(?!--)/.test(trimmedContent)
		const hasModifications = trimmedContent.includes('@@')

		if (!hasAdditions && !hasDeletions && !hasModifications) {
			return { valid: false, reason: 'Patch does not contain meaningful changes' }
		}

		// Check for common patch format issues
		const lines = trimmedContent.split('\n')
		let hasValidDiffHeader = false
		let hasValidFileHeader = false
		
		for (const line of lines) {
			if (line.startsWith('diff --git')) {
				hasValidDiffHeader = true
			}
			if (line.startsWith('+++') || line.startsWith('---')) {
				hasValidFileHeader = true
			}
		}
		
		if (!hasValidDiffHeader) {
			return { valid: false, reason: 'Missing valid diff header (diff --git)' }
		}
		
		if (!hasValidFileHeader) {
			return { valid: false, reason: 'Missing valid file headers (+++ or ---)' }
		}

		return { valid: true }
	}

	async validateWorkspaceForCommit(): Promise<{ hasChanges: boolean; reason?: string }> {
		try {
			const status = await this.git.status()
			
			if (status.files.length === 0) {
				return { hasChanges: false, reason: 'No files have been modified' }
			}

			// Check if changes are meaningful (not just whitespace)
			let meaningfulChanges = false
			for (const file of status.files) {
				try {
					const diff = await this.git.diff([file.path])
					if (diff.trim().length > 0 && !diff.match(/^\s*$/)) {
						meaningfulChanges = true
						break
					}
				} catch (diffError) {
					// If we can't get diff, assume there are meaningful changes
					meaningfulChanges = true
					break
				}
			}

			if (!meaningfulChanges) {
				return { hasChanges: false, reason: 'Only whitespace changes detected' }
			}

			return { hasChanges: true }
		} catch (error) {
			logger.error('Failed to validate workspace for commit', { error })
			// Conservative approach: assume there are changes if we can't check
			return { hasChanges: true }
		}
	}
}
