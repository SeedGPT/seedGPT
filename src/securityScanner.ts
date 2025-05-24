import { exec } from 'child_process'

interface SemgrepResult {
	check_id: string
	path: string
	start: { line: number }
	extra: { message: string }
}

export async function runSemgrepScan (): Promise<string[]> {
	return new Promise((resolve) => {
		exec('semgrep --config=auto --quiet --json', (err, stdout) => {
			if (err && !stdout) { return resolve([]) }
			const results = JSON.parse(stdout)
			const issues = results.results.map((r: SemgrepResult) =>
				`${r.check_id} in ${r.path}:${r.start.line} → ${r.extra.message}`
			)
			resolve(issues)
		})
	})
}
