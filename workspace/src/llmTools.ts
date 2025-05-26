import { exec } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'
import logger from './logger.js'
import { BranchRecoveryManager } from './branchRecoveryManager.js'
import { WorkspaceManager } from './workspaceManager.js'
import { Task } from './types.js'

const execAsync = promisify(exec)

export interface LLMToolResult {
	success: boolean
	message: string
	action?: string
	output?: {
		stdout?: string
		stderr?: string
		exitCode?: number
	}
}

export class LLMTools {
	constructor(
		private branchRecovery: BranchRecoveryManager,
		private workspace: WorkspaceManager
	) {}

	async nukeBranch(task: Task, branchName: string, reason: string): Promise<LLMToolResult> {
		try {
			logger.info('LLM requested branch nuke', { taskId: task.id, branchName, reason })
			
			const success = await this.branchRecovery.nukeBranchIfStuck(task, branchName)
			
			if (success) {
				return {
					success: true,
					message: `Branch ${branchName} successfully nuked and reset`,
					action: 'BRANCH_NUKED'
				}
			} else {
				return {
					success: false,
					message: `Failed to nuke branch ${branchName}`,
					action: 'NUKE_FAILED'
				}
			}
		} catch (error) {
			logger.error('LLM tool nukeBranch failed', { error, taskId: task.id })
			return {
				success: false,
				message: `Error nuking branch: ${error}`,
				action: 'NUKE_ERROR'
			}
		}
	}

	async restartTask(task: Task, reason: string): Promise<LLMToolResult> {
		try {
			logger.info('LLM requested task restart', { taskId: task.id, reason })
			
			task.status = 'pending'
			task.metadata = task.metadata || {}
			task.metadata.failureCount = 0
			task.metadata.lastAttempt = undefined
			task.metadata.context = task.metadata.context || []
			task.metadata.context.push(`Restarted by LLM: ${reason}`)
			task.updatedAt = new Date().toISOString()
			
			return {
				success: true,
				message: `Task #${task.id} restarted: ${reason}`,
				action: 'TASK_RESTARTED'
			}
		} catch (error) {
			logger.error('LLM tool restartTask failed', { error, taskId: task.id })
			return {
				success: false,
				message: `Error restarting task: ${error}`,
				action: 'RESTART_ERROR'
			}
		}
	}

	async blockTask(task: Task, reason: string): Promise<LLMToolResult> {
		try {
			logger.info('LLM requested task block', { taskId: task.id, reason })
			
			task.status = 'blocked'
			task.metadata = task.metadata || {}
			task.metadata.blockedReason = reason
			task.metadata.context = task.metadata.context || []
			task.metadata.context.push(`Blocked by LLM: ${reason}`)
			task.updatedAt = new Date().toISOString()
			
			return {
				success: true,
				message: `Task #${task.id} blocked: ${reason}`,
				action: 'TASK_BLOCKED'
			}
		} catch (error) {
			logger.error('LLM tool blockTask failed', { error, taskId: task.id })
			return {
				success: false,
				message: `Error blocking task: ${error}`,
				action: 'BLOCK_ERROR'
			}
		}
	}
	async executeScript(scriptPath: string, reason: string, task?: Task): Promise<LLMToolResult> {
		try {
			logger.info('LLM requested script execution', { scriptPath, reason, taskId: task?.id })
			
			const fullPath = path.resolve(this.workspace.getWorkspacePath(), scriptPath)
			
			if (!fs.existsSync(fullPath)) {
				return {
					success: false,
					message: `Script not found: ${scriptPath}`,
					action: 'SCRIPT_NOT_FOUND'
				}
			}			const result = await this.workspace.runInWorkspace(async () => {
				const { stdout, stderr } = await execAsync(`node "${fullPath}"`)
				return { stdout, stderr }
			})

			logger.info('Script execution completed', {
				scriptPath, 
				taskId: task?.id,
				outputLength: result.stdout.length,
				errorLength: result.stderr.length
			})

			return {
				success: true,
				message: `Script ${scriptPath} executed successfully: ${reason}`,
				action: 'SCRIPT_EXECUTED',
				output: {
					stdout: result.stdout,
					stderr: result.stderr
				}
			}
		} catch (error) {
			logger.error('LLM tool executeScript failed', { error, scriptPath, taskId: task?.id })
			return {
				success: false,
				message: `Error executing script ${scriptPath}: ${error}`,
				action: 'SCRIPT_ERROR'
			}
		}
	}

	async runTests(testPattern?: string, reason?: string, task?: Task): Promise<LLMToolResult> {
		try {
			logger.info('LLM requested test execution', { testPattern, reason, taskId: task?.id })
			
			const testCommand = testPattern ? `npm test -- ${testPattern}` : 'npm test'
			
			const result = await this.workspace.runInWorkspace(async () => {
				const { stdout, stderr } = await execAsync(testCommand)
				return { stdout, stderr }
			})

			const isSuccess = result.stdout.includes('passed') && !result.stderr.includes('failed')

			logger.info('Test execution completed', { 
				testPattern, 
				taskId: task?.id,
				success: isSuccess,
				outputLength: result.stdout.length
			})

			return {
				success: isSuccess,
				message: isSuccess 
					? `Tests passed${testPattern ? ` for pattern ${testPattern}` : ''}: ${reason || 'Test execution'}` 
					: `Tests failed${testPattern ? ` for pattern ${testPattern}` : ''}: ${reason || 'Test execution'}`,
				action: isSuccess ? 'TESTS_PASSED' : 'TESTS_FAILED',
				output: {
					stdout: result.stdout,
					stderr: result.stderr
				}
			}
		} catch (error) {
			logger.error('LLM tool runTests failed', { error, testPattern, taskId: task?.id })
			return {
				success: false,
				message: `Error running tests${testPattern ? ` for pattern ${testPattern}` : ''}: ${error}`,
				action: 'TESTS_ERROR'
			}
		}
	}

	async installPackage(packageName: string, reason: string, task?: Task): Promise<LLMToolResult> {
		try {
			logger.info('LLM requested package installation', { packageName, reason, taskId: task?.id })
			
			const installCommand = `npm install ${packageName}`
			
			const result = await this.workspace.runInWorkspace(async () => {
				const { stdout, stderr } = await execAsync(installCommand)
				return { stdout, stderr }
			})

			const isSuccess = result.stdout.includes('added') || result.stdout.includes('updated')

			logger.info('Package installation completed', { 
				packageName, 
				taskId: task?.id,
				success: isSuccess
			})

			return {
				success: isSuccess,
				message: isSuccess 
					? `Package ${packageName} installed successfully: ${reason}` 
					: `Package ${packageName} installation failed: ${reason}`,
				action: isSuccess ? 'PACKAGE_INSTALLED' : 'PACKAGE_INSTALL_FAILED',
				output: {
					stdout: result.stdout,
					stderr: result.stderr
				}
			}
		} catch (error) {
			logger.error('LLM tool installPackage failed', { error, packageName, taskId: task?.id })
			return {
				success: false,
				message: `Error installing package ${packageName}: ${error}`,
				action: 'PACKAGE_INSTALL_ERROR'
			}
		}
	}

	async buildProject(reason: string, task?: Task): Promise<LLMToolResult> {
		try {
			logger.info('LLM requested project build', { reason, taskId: task?.id })
			
			const result = await this.workspace.runInWorkspace(async () => {
				const { stdout, stderr } = await execAsync('npm run build')
				return { stdout, stderr }
			})

			const isSuccess = !result.stderr.includes('error') && !result.stderr.includes('failed')
            
            logger.info('Project build completed', { 
				taskId: task?.id,
				success: isSuccess,
				outputLength: result.stdout.length
			})

			return {
				success: isSuccess,
				message: isSuccess 
					? `Project built successfully: ${reason}` 
					: `Project build failed: ${reason}`,
				action: isSuccess ? 'BUILD_SUCCESS' : 'BUILD_FAILED',
				output: {
					stdout: result.stdout,
					stderr: result.stderr
				}
			}
		} catch (error) {
			logger.error('LLM tool buildProject failed', { error, taskId: task?.id })
			return {
				success: false,
				message: `Error building project: ${error}`,
				action: 'BUILD_ERROR'
			}
		}	}

	async searchCodebase(query: string, reason: string, task?: Task): Promise<LLMToolResult> {
		try {
			logger.info('LLM requested codebase search', { query, reason, taskId: task?.id })
			
			const result = await this.workspace.runInWorkspace(async () => {
				const { stdout, stderr } = await execAsync(`grep -r --include="*.ts" --include="*.js" --include="*.json" --include="*.md" "${query}" .`)
				return { stdout, stderr }
			})

			logger.info('Codebase search completed', {
				query,
				taskId: task?.id,
				resultsCount: result.stdout.split('\n').filter(line => line.trim()).length
			})

			return {
				success: true,
				message: `Found ${result.stdout.split('\n').filter(line => line.trim()).length} matches for "${query}": ${reason}`,
				action: 'CODEBASE_SEARCHED',
				output: {
					stdout: result.stdout,
					stderr: result.stderr
				}
			}
		} catch (error) {
			logger.error('LLM tool searchCodebase failed', { error, query, taskId: task?.id })
			return {
				success: false,
				message: `Error searching codebase for "${query}": ${error}`,
				action: 'SEARCH_ERROR'
			}
		}
	}

	async analyzeCurrentCapabilities(reason: string, task?: Task): Promise<LLMToolResult> {
		try {
			logger.info('LLM requested capability analysis', { reason, taskId: task?.id })
			
			const result = await this.workspace.runInWorkspace(async () => {
				const commands = [
					'find . -name "*.ts" -type f | wc -l',
					'find . -name "*.test.ts" -type f | wc -l',
					'npm list --depth=0 2>/dev/null || echo "Package list unavailable"',
					'git log --oneline -10 || echo "Git history unavailable"'
				]
				
				const results = []
				for (const cmd of commands) {
					try {
						const { stdout } = await execAsync(cmd)
						results.push(stdout.trim())
					} catch (err) {
						results.push(`Error: ${err}`)
					}
				}
				
				return { 
					stdout: results.join('\n---\n'),
					stderr: ''
				}
			})

			logger.info('Capability analysis completed', {
				taskId: task?.id,
				outputLength: result.stdout.length
			})

			return {
				success: true,
				message: `Analyzed current capabilities: ${reason}`,
				action: 'CAPABILITIES_ANALYZED',
				output: {
					stdout: result.stdout,
					stderr: result.stderr
				}
			}
		} catch (error) {
			logger.error('LLM tool analyzeCurrentCapabilities failed', { error, taskId: task?.id })
			return {
				success: false,
				message: `Error analyzing capabilities: ${error}`,
				action: 'ANALYSIS_ERROR'
			}
		}
	}

	async inspectCodeStructure(filePath: string, reason: string, task?: Task): Promise<LLMToolResult> {
		try {
			logger.info('LLM requested code structure inspection', { filePath, reason, taskId: task?.id })
			
			const fullPath = path.resolve(this.workspace.getWorkspacePath(), filePath)
			
			if (!fs.existsSync(fullPath)) {
				return {
					success: false,
					message: `File not found: ${filePath}`,
					action: 'FILE_NOT_FOUND'
				}
			}

			const content = fs.readFileSync(fullPath, 'utf8')
			const lines = content.split('\n')
			
			const analysis = {
				totalLines: lines.length,
				nonEmptyLines: lines.filter(line => line.trim()).length,
				functions: content.match(/function\s+\w+|const\s+\w+\s*=\s*\(/g)?.length || 0,
				classes: content.match(/class\s+\w+/g)?.length || 0,
				interfaces: content.match(/interface\s+\w+/g)?.length || 0,
				imports: content.match(/import\s+.*from/g)?.length || 0
			}

			logger.info('Code structure inspection completed', {
				filePath,
				taskId: task?.id,
				analysis
			})

			return {
				success: true,
				message: `Inspected ${filePath} structure: ${reason}`,
				action: 'STRUCTURE_INSPECTED',
				output: {
					stdout: JSON.stringify(analysis, null, 2),
					stderr: ''
				}
			}
		} catch (error) {
			logger.error('LLM tool inspectCodeStructure failed', { error, filePath, taskId: task?.id })
			return {
				success: false,
				message: `Error inspecting ${filePath}: ${error}`,
				action: 'INSPECTION_ERROR'
			}
		}
	}

	parseToolRequest(response: string): { tool: string; reason: string; args?: string } | null {		const toolPatterns = [
			{ pattern: /NUKE_BRANCH:\s*(.+)/i, tool: 'NUKE_BRANCH' },
			{ pattern: /RESTART_TASK:\s*(.+)/i, tool: 'RESTART_TASK' },
			{ pattern: /BLOCK_TASK:\s*(.+)/i, tool: 'BLOCK_TASK' },
			{ pattern: /EXECUTE_SCRIPT:\s*([^\s]+)\s*-\s*(.+)/i, tool: 'EXECUTE_SCRIPT' },
			{ pattern: /RUN_TESTS:\s*([^\s-]*)\s*-\s*(.+)/i, tool: 'RUN_TESTS' },
			{ pattern: /INSTALL_PACKAGE:\s*([^\s]+)\s*-\s*(.+)/i, tool: 'INSTALL_PACKAGE' },
			{ pattern: /BUILD_PROJECT:\s*(.+)/i, tool: 'BUILD_PROJECT' },
			{ pattern: /SEARCH_CODEBASE:\s*([^\s]+)\s*-\s*(.+)/i, tool: 'SEARCH_CODEBASE' },
			{ pattern: /ANALYZE_CAPABILITIES:\s*(.+)/i, tool: 'ANALYZE_CAPABILITIES' },
			{ pattern: /INSPECT_STRUCTURE:\s*([^\s]+)\s*-\s*(.+)/i, tool: 'INSPECT_STRUCTURE' }
		]

		for (const { pattern, tool } of toolPatterns) {
			const match = response.match(pattern)
			if (match) {				if (tool === 'EXECUTE_SCRIPT') {
					return { tool, args: match[1].trim(), reason: match[2].trim() }
				} else if (tool === 'RUN_TESTS') {
					const args = match[1]?.trim()
					return { tool, args: args || undefined, reason: match[2].trim() }
				} else if (tool === 'INSTALL_PACKAGE') {
					return { tool, args: match[1].trim(), reason: match[2].trim() }
				} else if (tool === 'SEARCH_CODEBASE') {
					return { tool, args: match[1].trim(), reason: match[2].trim() }
				} else if (tool === 'INSPECT_STRUCTURE') {
					return { tool, args: match[1].trim(), reason: match[2].trim() }
				} else {
					return { tool, reason: match[1].trim() }
				}
			}
		}

		return null
	}
}
