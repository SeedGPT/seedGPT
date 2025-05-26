import logger from './logger.js'
import { Task } from './types.js'

export function validateAndDeduplicateTasks (newTasks: Task[], existingTasks: Task[]): Task[] {
	const existingDescriptions = new Set(
		existingTasks.map(t => t.description.toLowerCase().trim())
	)

	return newTasks.filter(task => {
		if (!task.description || task.description.length < 10) {
			logger.warn('Rejected task with insufficient description', { task })
			return false
		}

		if (existingDescriptions.has(task.description.toLowerCase().trim())) {
			logger.warn('Rejected duplicate task', { task })
			return false
		}

		if (!['high', 'medium', 'low'].includes(task.priority || '')) {
			task.priority = 'medium'
		}

		task.status = 'pending'
		return true
	})
}
