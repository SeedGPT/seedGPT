import { exec } from 'child_process';

export async function runSemgrepScan(): Promise<string[]> {
	return new Promise((res) => {
		exec('semgrep --config=auto --quiet --json', (err, stdout) => {
			if (err && !stdout) return res([]);
			const results = JSON.parse(stdout);
			const issues = results.results.map((r: any) =>
				`${r.check_id} in ${r.path}:${r.start.line} → ${r.extra.message}`
			);
			res(issues);
		});
	});
}
