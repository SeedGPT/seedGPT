import express from 'express';
import { loadTasks } from './taskManager';
import fs from 'fs';

const app = express();
app.get('/tasks', (req, res) => {
	res.json(loadTasks('../tasks.yaml'));
});
app.get('/progress', (req, res) => {
	res.send(fs.readFileSync('../PROGRESS.md', 'utf-8'));
});
app.listen(4000, () => console.log('📊 Dashboard running on http://0.0.0.0:4000'));
