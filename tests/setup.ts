import { jest } from '@jest/globals'

process.env.NODE_ENV = 'test'
process.env.ANTHROPIC_API_KEY = 'test-key'
process.env.GITHUB_TOKEN = 'test-token'
process.env.GITHUB_REPO_OWNER = 'test-owner'
process.env.GITHUB_REPO_NAME = 'test-repo'

global.console = {
	...console,
	log: jest.fn(),
	debug: jest.fn(),
	info: jest.fn(),
	warn: jest.fn(),
	error: jest.fn()
}
