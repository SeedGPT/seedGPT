import { Octokit } from '@octokit/rest'

import logger from './logger.js'
import { CIStatus, Config, PRStatus } from './types.js'

export class CIManager {
	private octokit: Octokit
	private owner: string
	private repo: string
	private cfg: Config

	constructor (octokit: Octokit, cfg: Config) {
		this.octokit = octokit
		this.owner = process.env.GITHUB_REPO_OWNER!
		this.repo = process.env.GITHUB_REPO_NAME!
		this.cfg = cfg
	}
	async waitForCIAndMerge (prNumber: number): Promise<boolean> {
		const maxWaitMs = this.cfg.ci.maxWaitMinutes * 60 * 1000
		const pollIntervalMs = this.cfg.ci.pollIntervalSeconds * 1000
		const startTime = Date.now()

		logger.info(`Monitoring CI for PR #${prNumber}`, {
			maxWaitMinutes: this.cfg.ci.maxWaitMinutes,
			pollIntervalSeconds: this.cfg.ci.pollIntervalSeconds
		})

		while (Date.now() - startTime < maxWaitMs) {
			try {
				const ciStatus = await this.getCIStatus(prNumber)
				const prStatus = await this.getPRStatus(prNumber)

				if (prStatus.merged) {
					logger.info(`PR #${prNumber} already merged`)
					return true
				}

				if (ciStatus.state === 'success' && prStatus.mergeable) {
					logger.info(`CI passed for PR #${prNumber}, attempting merge`)
					return await this.mergePR(prNumber)
				}

				if (ciStatus.state === 'failure' || ciStatus.state === 'error') {
					logger.error(`CI failed for PR #${prNumber}`, {
						state: ciStatus.state,
						conclusion: ciStatus.conclusion,
						description: ciStatus.description
					})
					return false
				}

				if (ciStatus.state === 'pending') {
					const elapsed = Math.round((Date.now() - startTime) / 1000)
					logger.debug(`CI still running for PR #${prNumber} (${elapsed}s elapsed)`, {
						description: ciStatus.description
					})
				}

				await this.sleep(pollIntervalMs)
			} catch (error) {
				logger.error('Error monitoring CI status', { error, prNumber })
				await this.sleep(pollIntervalMs)
			}
		}

		logger.warn(`CI monitoring timed out for PR #${prNumber}`)
		return false
	}
	async getCIStatus (prNumber: number): Promise<CIStatus> {
		const { data: pr } = await this.octokit.pulls.get({
			owner: this.owner,
			repo: this.repo,
			pull_number: prNumber
		})

		const { data: workflows } = await this.octokit.actions.listWorkflowRunsForRepo({
			owner: this.owner,
			repo: this.repo,
			head_sha: pr.head.sha,
			per_page: 100
		})
		const relevantWorkflows = workflows.workflow_runs.filter(run => 
			run.head_sha === pr.head.sha && 
			run.event === 'pull_request' &&
			run.name && (run.name === 'Development Testing CI' || run.name.includes('CI') || run.name.includes('Test'))
		)

		if (relevantWorkflows.length === 0) {
			logger.debug(`No workflows found for PR #${prNumber}, checking legacy checks/statuses`)
			
			const { data: checks } = await this.octokit.checks.listForRef({
				owner: this.owner,
				repo: this.repo,
				ref: pr.head.sha
			})

			const { data: statuses } = await this.octokit.repos.listCommitStatusesForRef({
				owner: this.owner,
				repo: this.repo,
				ref: pr.head.sha
			})

			if (checks.check_runs.length === 0 && statuses.length === 0) {
				logger.warn(`No CI checks or workflows found for PR #${prNumber}`)
				return { state: 'pending', description: 'Waiting for CI workflows to start' }
			}

			const checkStates = checks.check_runs.map(check => ({
				state: check.status === 'completed'
					? (check.conclusion === 'success' ? 'success' : 'failure')
					: 'pending',
				conclusion: check.conclusion,
				description: check.output?.title ?? null
			}))

			const statusStates = statuses.map(status => ({
				state: status.state as 'pending' | 'success' | 'failure' | 'error',
				description: status.description ?? null
			}))

			const allStates = [...checkStates, ...statusStates]
			
			if (allStates.some(s => s.state === 'failure' || s.state === 'error')) {
				const failedCheck = allStates.find(s => s.state === 'failure' || s.state === 'error')
				return {
					state: 'failure',
					conclusion: (failedCheck && 'conclusion' in failedCheck && failedCheck.conclusion !== null) ?
						failedCheck.conclusion as CIStatus['conclusion'] : null,
					description: failedCheck?.description ?? null
				}
			}

			if (allStates.some(s => s.state === 'pending')) {
				return { state: 'pending' }
			}

			return { state: 'success' }
		}
		logger.debug(`Found ${relevantWorkflows.length} workflows for PR #${prNumber}`, {
			workflows: relevantWorkflows.map(w => ({ name: w.name || 'Unknown', status: w.status, conclusion: w.conclusion }))
		})

		const pendingWorkflows = relevantWorkflows.filter(run => 
			run.status === 'queued' || run.status === 'in_progress' || run.status === 'waiting'
		)

		const failedWorkflows = relevantWorkflows.filter(run => 
			run.status === 'completed' && (run.conclusion === 'failure' || run.conclusion === 'cancelled' || run.conclusion === 'timed_out')
		)

		const successfulWorkflows = relevantWorkflows.filter(run => 
			run.status === 'completed' && run.conclusion === 'success'
		)
		if (failedWorkflows.length > 0) {
			const failedWorkflow = failedWorkflows[0]
			logger.error(`Workflow failed for PR #${prNumber}`, {
			workflowName: failedWorkflow.name,
			conclusion: failedWorkflow.conclusion,
			url: failedWorkflow.html_url
		})
		
		return {
				state: 'failure',
				conclusion: failedWorkflow.conclusion as CIStatus['conclusion'],
				description: `Workflow '${failedWorkflow.name || 'Unknown'}' ${failedWorkflow.conclusion}`,
				target_url: failedWorkflow.html_url
			}
		}
		if (pendingWorkflows.length > 0) {
			return { 
				state: 'pending', 
				description: `${pendingWorkflows.length} workflow(s) still running: ${pendingWorkflows.map(w => w.name || 'Unknown').join(', ')}`
			}
		}
		if (successfulWorkflows.length > 0 && relevantWorkflows.every(run => run.status === 'completed')) {
			logger.info(`All workflows completed successfully for PR #${prNumber}`, {
				completedWorkflows: successfulWorkflows.map(w => w.name || 'Unknown')
			})
			return { state: 'success' }
		}

		return { 
			state: 'pending', 
			description: 'Waiting for workflow status to be determined'
		}
	}

	async getPRStatus (prNumber: number): Promise<PRStatus> {
		const { data: pr } = await this.octokit.pulls.get({
			owner: this.owner,
			repo: this.repo,
			pull_number: prNumber
		})

		return {
			mergeable: pr.mergeable ?? false,
			mergeable_state: pr.mergeable_state ?? 'unknown',
			merged: pr.merged,
			number: pr.number
		}
	}

	private async mergePR (prNumber: number): Promise<boolean> {
		try {
			const { data: pr } = await this.octokit.pulls.get({
				owner: this.owner,
				repo: this.repo,
				pull_number: prNumber
			})

			await this.octokit.pulls.merge({
				owner: this.owner,
				repo: this.repo,
				pull_number: prNumber,
				merge_method: 'squash'
			})

			logger.info(`Successfully merged PR #${prNumber}`)
			
			const branchName = pr.head.ref
			try {
				await this.octokit.git.deleteRef({
					owner: this.owner,
					repo: this.repo,
					ref: `heads/${branchName}`
				})
				logger.info(`Successfully deleted branch ${branchName} after merge`)
			} catch (deleteError) {
				logger.warn(`Failed to delete branch ${branchName} after merge`, { deleteError })
			}

			return true
		} catch (error) {
			logger.error(`Failed to merge PR #${prNumber}`, { error })
			return false
		}
	}

	private sleep (ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms))
	}

	async getWorkflowLogs(prNumber: number): Promise<string> {
		try {
			const { data: pr } = await this.octokit.pulls.get({
				owner: this.owner,
				repo: this.repo,
				pull_number: prNumber
			})

			const { data: workflows } = await this.octokit.actions.listWorkflowRunsForRepo({
				owner: this.owner,
				repo: this.repo,
				head_sha: pr.head.sha,
				per_page: 100
			})

			const relevantWorkflows = workflows.workflow_runs.filter(run => 
				run.head_sha === pr.head.sha && 
				run.event === 'pull_request' &&
				run.name && (run.name === 'Development Testing CI' || run.name.includes('CI') || run.name.includes('Test'))
			)

			if (relevantWorkflows.length === 0) {
				return 'No CI workflows found for this PR'
			}

			const failedWorkflows = relevantWorkflows.filter(run => 
				run.status === 'completed' && (run.conclusion === 'failure' || run.conclusion === 'cancelled' || run.conclusion === 'timed_out')
			)

			if (failedWorkflows.length === 0) {
				return 'No failed workflows found for this PR'
			}

			let allLogs = ''
			
			for (const workflow of failedWorkflows) {
				try {
					allLogs += `\n=== WORKFLOW: ${workflow.name || 'Unknown'} (${workflow.conclusion}) ===\n`
					allLogs += `URL: ${workflow.html_url}\n`
					allLogs += `Started: ${workflow.run_started_at}\n`
					allLogs += `Completed: ${workflow.updated_at}\n\n`

					const { data: jobs } = await this.octokit.actions.listJobsForWorkflowRun({
						owner: this.owner,
						repo: this.repo,
						run_id: workflow.id
					})

					for (const job of jobs.jobs) {
						if (job.conclusion === 'failure' || job.conclusion === 'cancelled') {
							allLogs += `--- JOB: ${job.name} (${job.conclusion}) ---\n`
							allLogs += `Started: ${job.started_at}\n`
							allLogs += `Completed: ${job.completed_at}\n\n`

							try {
								const { data: logData } = await this.octokit.actions.downloadJobLogsForWorkflowRun({
									owner: this.owner,
									repo: this.repo,
									job_id: job.id
								})

								if (typeof logData === 'string') {
									const lines = logData.split('\n')
									const errorLines = lines.filter(line => 
										line.toLowerCase().includes('error') ||
										line.toLowerCase().includes('fail') ||
										line.toLowerCase().includes('✗') ||
										line.toLowerCase().includes('×') ||
										line.includes('FAIL') ||
										line.includes('ERROR')
									)

									if (errorLines.length > 0) {
										allLogs += 'ERROR LINES:\n'
										allLogs += errorLines.slice(0, 50).join('\n') + '\n\n'
									}

									const lastLines = lines.slice(-100)
									allLogs += 'LAST 100 LINES:\n'
									allLogs += lastLines.join('\n') + '\n\n'
								}
							} catch (logError) {
								allLogs += `Failed to fetch job logs: ${logError}\n\n`
							}
						}
					}
				} catch (workflowError) {
					logger.error(`Failed to fetch logs for workflow ${workflow.id}`, { error: workflowError })
					allLogs += `Failed to fetch logs for workflow ${workflow.name}: ${workflowError}\n\n`
				}
			}

			return allLogs || 'No detailed logs available'
		} catch (error) {
			logger.error('Failed to fetch workflow logs', { error, prNumber })
			return `Failed to fetch workflow logs: ${error}`
		}
	}
}
