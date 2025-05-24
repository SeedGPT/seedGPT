export interface AnthropicMessage {
	role: 'user' | 'assistant';
	content: string;
}

export interface Config {
	objectives: string[];
	memory: {
		store: string;
		summaries: string;
	};
	files: {
		tasks: string;
		progress: string;
		changelog: string;
		dashboard: string;
	};
	prompts: {
		patch: string;
		review: string;
		summarize: string;
	};
}
