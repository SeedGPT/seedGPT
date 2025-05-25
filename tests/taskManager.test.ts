import fs from 'fs'

import { Task, loadTasks, saveTasks, loadConfig } from '../src/taskManager.js'

jest.mock('fs')
const mockFs = fs as jest.Mocked<typeof fs>

describe('TaskManager', () => {
	beforeEach(() => {
		jest.clearAllMocks()
	})

	describe('loadTasks', () => {
		it('should load tasks from YAML file', () => {
			const mockTasks: Task[] = [
				{ id: 1, description: 'Test task', priority: 'high', status: 'pending' },
				{ id: 2, description: 'Another task', priority: 'medium', status: 'done' }
			]

			const yamlContent = `- id: 1
  description: Test task
  priority: high
  status: pending
- id: 2
  description: Another task
  priority: medium
  status: done`

			mockFs.readFileSync.mockReturnValue(yamlContent)

			const result = loadTasks('tasks.yaml')

			expect(mockFs.readFileSync).toHaveBeenCalledWith('tasks.yaml', 'utf-8')
			expect(result).toEqual(mockTasks)
		})

		it('should handle empty task file', () => {
			mockFs.readFileSync.mockReturnValue('[]')

			const result = loadTasks('tasks.yaml')

			expect(result).toEqual([])
		})
	})

	describe('saveTasks', () => {
		it('should save tasks to YAML file', () => {
			const tasks: Task[] = [
				{ id: 1, description: 'Test task', priority: 'high', status: 'pending' }
			]

			saveTasks('tasks.yaml', tasks)

			expect(mockFs.writeFileSync).toHaveBeenCalledWith(
				'tasks.yaml',
				expect.stringContaining('id: 1')
			)
			expect(mockFs.writeFileSync).toHaveBeenCalledWith(
				'tasks.yaml',
				expect.stringContaining('description: Test task')
			)
		})

		it('should handle empty task array', () => {
			saveTasks('tasks.yaml', [])

			expect(mockFs.writeFileSync).toHaveBeenCalledWith(
				'tasks.yaml',
				'[]\n'
			)
		})
	})

	describe('loadConfig', () => {
		it('should load configuration from YAML file', () => {
			const configYaml = `objectives:
  - "Test objective"
workingDirectory: "./workspace"
git:
  remoteName: "origin"
  mainBranch: "main"
memory:
  store: "./memory.db"
  summaries: "./summaries/"
files:
  tasks: "./tasks.yaml"
  progress: "./PROGRESS.md"
  changelog: "./CHANGELOG.md"
prompts:
  patch: "./prompts/patch_generation.template"
  review: "./prompts/patch_review.template"
  summarize: "./prompts/merge_summarize.template"`

			mockFs.readFileSync.mockReturnValue(configYaml)

			const result = loadConfig('agent-config.yaml')

			expect(mockFs.readFileSync).toHaveBeenCalledWith('agent-config.yaml', 'utf-8')
			expect(result.objectives).toEqual(['Test objective'])
			expect(result.workingDirectory).toBe('./workspace')
			expect(result.git.mainBranch).toBe('main')
		})
	})
})
