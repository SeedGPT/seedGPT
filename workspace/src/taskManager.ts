import fs from 'fs'
import path from 'path'

import yaml from 'js-yaml'

import { Config, Task } from './types.js'
import { WorkspaceManager } from './workspaceManager.js'

let workspaceManager: WorkspaceManager | null = null

export function setWorkspaceManager(manager: WorkspaceManager) {
	workspaceManager = manager
}

function getWorkspacePath(filePath: string): string {
	if (workspaceManager && !path.isAbsolute(filePath)) {
		return workspaceManager.getWorkspaceFilePath(filePath)
	}
	return filePath
}

export function loadConfig (path: string) {
	return yaml.load(fs.readFileSync(path, 'utf-8')) as Config
}

export function loadTasks (path: string): Task[] {
	const workspacePath = getWorkspacePath(path)
	return yaml.load(fs.readFileSync(workspacePath, 'utf-8')) as Task[]
}

export function saveTasks (path: string, tasks: Task[]) {
	const workspacePath = getWorkspacePath(path)
	fs.writeFileSync(workspacePath, yaml.dump(tasks))
}
