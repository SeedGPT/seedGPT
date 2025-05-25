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
					logger.debug(`CI still running for PR #${prNumber} (${elapsed}s elapsed)`)
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

	private async getCIStatus (prNumber: number): Promise<CIStatus> {
		const { data: pr } = await this.octokit.pulls.get({
			owner: this.owner,
			repo: this.repo,
			pull_number: prNumber
		})

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
			return { state: 'success' }
		}

		interface CheckState {
			state: 'pending' | 'success' | 'failure' | 'error'
			conclusion?: string | null
			description?: string | null
		}

		interface StatusState {
			state: 'pending' | 'success' | 'failure' | 'error'
			description?: string | null
		}

		const checkStates: CheckState[] = checks.check_runs.map(check => ({
			state: check.status === 'completed'
				? (check.conclusion === 'success' ? 'success' : 'failure')
				: 'pending',
			conclusion: check.conclusion,
			description: check.output?.title ?? null
		}))

		const statusStates: StatusState[] = statuses.map(status => ({
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

	private async getPRStatus (prNumber: number): Promise<PRStatus> {
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
			await this.octokit.pulls.merge({
				owner: this.owner,
				repo: this.repo,
				pull_number: prNumber,
				merge_method: 'squash'
			})

			logger.info(`Successfully merged PR #${prNumber}`)
			return true
		} catch (error) {
			logger.error(`Failed to merge PR #${prNumber}`, { error })
			return false
		}
	}

	private sleep (ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms))
	}
}
