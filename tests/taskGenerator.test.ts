import { validateAndDeduplicateTasks } from '../src/taskGenerator.js'
import { Task } from '../src/taskManager.js'

jest.mock('../src/logger.js', () => ({
	default: {
		warn: jest.fn(),
		error: jest.fn(),
		info: jest.fn(),
		debug: jest.fn()
	}
}))

describe('TaskGenerator', () => {
	describe('validateAndDeduplicateTasks', () => {
		const existingTasks: Task[] = [
			{ id: 1, description: 'Existing task', priority: 'high', status: 'done' },
			{ id: 2, description: 'Another existing task', priority: 'medium', status: 'pending' }
		]

		it('should validate and return valid tasks', () => {
			const newTasks: Task[] = [
				{ id: 3, description: 'New valid task', priority: 'high', status: 'pending' },
				{ id: 4, description: 'Another new task', priority: 'medium', status: 'pending' }
			]

			const result = validateAndDeduplicateTasks(newTasks, existingTasks)

			expect(result).toHaveLength(2)
			expect(result[0].description).toBe('New valid task')
			expect(result[1].description).toBe('Another new task')
		})

		it('should reject tasks with insufficient description', () => {
			const newTasks: Task[] = [
				{ id: 3, description: 'Short', priority: 'high', status: 'pending' },
				{ id: 4, description: 'This is a valid long description', priority: 'medium', status: 'pending' }
			]

			const result = validateAndDeduplicateTasks(newTasks, existingTasks)

			expect(result).toHaveLength(1)
			expect(result[0].description).toBe('This is a valid long description')
		})

		it('should reject duplicate tasks', () => {
			const newTasks: Task[] = [
				{ id: 3, description: 'Existing task', priority: 'high', status: 'pending' },
				{ id: 4, description: 'Completely new task description', priority: 'medium', status: 'pending' }
			]

			const result = validateAndDeduplicateTasks(newTasks, existingTasks)

			expect(result).toHaveLength(1)
			expect(result[0].description).toBe('Completely new task description')
		})

		it('should set default priority for invalid priority', () => {
			const newTasks: Task[] = [
				{ id: 3, description: 'Task with invalid priority', status: 'pending' }
			]

			const result = validateAndDeduplicateTasks(newTasks, existingTasks)

			expect(result).toHaveLength(1)
			expect(result[0].priority).toBe('medium')
		})

		it('should set status to pending for all new tasks', () => {
			const newTasks: Task[] = [
				{ id: 3, description: 'Task with different status', priority: 'high', status: 'done' }
			]

			const result = validateAndDeduplicateTasks(newTasks, existingTasks)

			expect(result).toHaveLength(1)
			expect(result[0].status).toBe('pending')
		})

		it('should handle empty arrays', () => {
			expect(validateAndDeduplicateTasks([], existingTasks)).toEqual([])
			expect(validateAndDeduplicateTasks([], [])).toEqual([])
		})
	})
})
