import fs from 'fs'

import express from 'express'

import logger from './logger'
import { loadTasks } from './taskManager'

const app = express()
app.get('/tasks', (req, res) => {
	res.json(loadTasks('../tasks.yaml'))
})
app.get('/progress', (req, res) => {
	res.send(fs.readFileSync('../PROGRESS.md', 'utf-8'))
})
app.listen(4000, () => logger.info('📊 Dashboard running on http://0.0.0.0:4000'))
