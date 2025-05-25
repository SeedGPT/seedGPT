export default {
	testEnvironment: 'node',
	testMatch: ['**/dist/**/*.test.js', '**/dist/**/?(*.)+(spec|test).js'],
	collectCoverageFrom: [
		'dist/**/*.js',
		'!dist/**/*.d.ts',
		'!dist/index.js',
	],
	coverageDirectory: 'coverage',
	coverageReporters: ['text', 'lcov', 'html'],
	setupFilesAfterEnv: ['<rootDir>/dist/tests/setup.js'],
	moduleDirectories: ['node_modules', '<rootDir>/dist'],
	testTimeout: 10000,
	transform: {}
};
