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
	};	dashboard?: {
		enabled: boolean;
		port: number;
	};
	research?: {
		enabled: boolean;
		directory: string;
		maxResearchTasks: number;
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
	priority?: 'critical' | 'high' | 'medium' | 'low';
	status: 'pending' | 'in-progress' | 'blocked' | 'done' | 'cancelled';
	type?: 'feature' | 'refactor' | 'fix' | 'research' | 'tool' | 'super' | 'subtask' | 'standard';
	parentId?: number;
	children?: number[];
	dependencies?: number[];
	estimatedEffort?: 'small' | 'medium' | 'large' | 'epic';
	tags?: string[];
	createdAt: string;
	updatedAt: string;
	completedAt?: string;
	metadata?: {
		branchCount?: number;
		lastAttempt?: string;
		failureCount?: number;
		blockedReason?: string;
		context?: string[];
		requiredTools?: string[];
		impact?: 'low' | 'medium' | 'high' | 'critical';
		complexity?: 'simple' | 'moderate' | 'complex' | 'expert';
		generationSource?: 'intelligent' | 'memory-insight' | 'research' | 'manual';
	};
}

export interface SuperTask {
	id: number;
	title: string;
	description: string;
	longTermVision: string;
	priority: 'critical' | 'high' | 'medium' | 'low';
	status: 'active' | 'planned' | 'completed' | 'archived';
	subtasks: number[];
	milestones: TaskMilestone[];
	createdAt: string;
	updatedAt: string;
	targetCompletionDate?: string;
	completionCriteria: string[];
	metrics?: {
		progressPercentage: number;
		blockedTasks: number;
		completedTasks: number;
		totalTasks: number;
	};
}

export interface TaskMilestone {
	id: number;
	name: string;
	description: string;
	criteria: string[];
	completed: boolean;
	completedAt?: string;
	dependentTasks: number[];
}

export interface RepositoryState {
	codebaseSize: number;
	testCoverage: number;
	technicalDebt: number;
	lastAnalysis: string;
	capabilities: string[];
	missingTools: string[];
	architecturalConcerns: string[];
	opportunityAreas: string[];
}

export interface TaskSuggestion {
	description: string;
	rationale: string;
	priority: 'critical' | 'high' | 'medium' | 'low';
	type: 'feature' | 'refactor' | 'fix' | 'research' | 'tool';
	estimatedEffort: 'small' | 'medium' | 'large' | 'epic';
	dependencies: string[];
	impact: 'low' | 'medium' | 'high' | 'critical';
	urgency: number;
	prerequisites: string[];
}

export interface ResearchTask {
	id: number;
	topic: string;
	questions: string[];
	sources: string[];
	findings: string;
	recommendations: string[];
	createdAt: string;
	completedAt?: string;
	relatedTasks: number[];
	impact: 'low' | 'medium' | 'high' | 'critical';
}

export interface SystemCapability {
	name: string;
	description: string;
	implemented: boolean;
	dependencies: string[];
	priority: 'critical' | 'high' | 'medium' | 'low';
	complexity: 'simple' | 'moderate' | 'complex' | 'expert';
}