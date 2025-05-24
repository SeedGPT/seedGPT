import fs from 'fs';
import yaml from 'js-yaml';

export interface Task {
	id: number;
	description: string;
	priority?: 'high' | 'medium' | 'low';
	status: 'pending' | 'in-progress' | 'done';
}

export function loadConfig(path: string) {
	return yaml.load(fs.readFileSync(path, 'utf-8')) as any;
}

export function loadTasks(path: string): Task[] {
	return yaml.load(fs.readFileSync(path, 'utf-8')) as Task[];
}

export function saveTasks(path: string, tasks: Task[]) {
	fs.writeFileSync(path, yaml.dump(tasks));
}
