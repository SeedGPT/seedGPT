export interface AnthropicMessage {
	role: 'user' | 'assistant';
	content: string;
}

export interface Config {
	objectives: string[];
	workingDirectory: string;
	memory: {
		store: string;
		summaries: string;
	};
	files: {
		tasks: string;
		progress: string;
		changelog: string;
	};
	git: {
		remoteName: string;
		mainBranch: string;
	};
	ci: {
		maxWaitMinutes: number;
		pollIntervalSeconds: number;
	};
	prompts: {
		patch: string;
		review: string;
		summarize: string;
	};
	models: {
		important: string;
		routine: string;
	};
}

export interface SystemPrompt {
	content: string;
	version: string;
}

export interface CIStatus {
	state: 'pending' | 'success' | 'failure' | 'error';
	conclusion?: 'success' | 'failure' | 'neutral' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required' | null;
	description?: string | null;
	target_url?: string;
}

export interface PRStatus {
	mergeable: boolean;
	mergeable_state: string;
	merged: boolean;
	number: number;
}

export interface Task {
	id: number;
	description: string;
	priority?: 'high' | 'medium' | 'low';
	status: 'pending' | 'in-progress' | 'done';
}