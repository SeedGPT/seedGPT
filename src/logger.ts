import { Logtail } from '@logtail/node'
import { createLogger, format as _format, transports as _transports } from 'winston'

const { BETTERSTACK_LOG_TOKEN } = process.env as Record<string, string>

console.log('BETTERSTACK_LOG_TOKEN:', BETTERSTACK_LOG_TOKEN)

const logLevel = {
	development: 'silly',
	production: 'info',
	staging: 'info',
	test: 'debug'
}

const winstonLogger = createLogger({
	levels: {
		error: 0,
		warn: 1,
		info: 2,
		http: 3,
		verbose: 4,
		debug: 5,
		silly: 6
	},
	format: _format.combine(
		_format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:SSS' }),
		_format.json()
	),
	defaultMeta: { service: 'seedGPT' },
	transports: [
		new _transports.Console({
			format: _format.combine(
				_format.colorize(),
				_format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
				_format.printf((logObject) => {
					return `${logObject.timestamp} ${logObject.level}: ${logObject.message}`
				})
			),
			level: logLevel[process.env.NODE_ENV as keyof typeof logLevel] ?? 'info'
		})
	]
})

// Instantiate betterStackLogger lazily only in production/staging
let betterStackLogger: Logtail | null = null

// Helper to handle BetterStack logging non-blocking
const logToBetterStackNonBlocking = (
	level: 'error' | 'warn' | 'info' | 'debug',
	message: string,
	context?: Record<string, any>
): void => {
	if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'staging') {
		return
	}

	if (!betterStackLogger) {
		// Diagnostic log for the token
		if (BETTERSTACK_LOG_TOKEN) {
			const tokenPrefix = BETTERSTACK_LOG_TOKEN.substring(0, 5);
			const tokenSuffix = BETTERSTACK_LOG_TOKEN.substring(BETTERSTACK_LOG_TOKEN.length - 5);
			const tokenLength = BETTERSTACK_LOG_TOKEN.length;
			winstonLogger.debug(`Verifying BETTERSTACK_LOG_TOKEN: First5='${tokenPrefix}', Last5='${tokenSuffix}', Length=${tokenLength}`);
		} else {
			winstonLogger.warn('BETTERSTACK_LOG_TOKEN is not defined when attempting to create Logtail instance.');
		}
		betterStackLogger = new Logtail(BETTERSTACK_LOG_TOKEN)
	}

	// Sanitize context, especially Error objects
	let sanitizedContext = context
	if (context?.error instanceof Error) {
		sanitizedContext = { ...context }
		const err = context.error
		sanitizedContext.error = {
			message: err.message,
			stack: err.stack,
			name: err.name
		}
	}

	// Use a non-blocking approach with .catch()
	betterStackLogger[level](message, sanitizedContext).catch((error) => {
		// Log BetterStack errors to Winston to avoid infinite loops
		winstonLogger.error(`Error logging to BetterStack: ${error instanceof Error ? error.toString() : String(error)}`, { error })
	})
}

const logger = {
	error: (message: string, context?: Record<string, any>) => {
		winstonLogger.error(message, context)
		logToBetterStackNonBlocking('error', message, context)
	},
	warn: (message: string, context?: Record<string, any>) => {
		winstonLogger.warn(message, context)
		logToBetterStackNonBlocking('warn', message, context)
	},
	info: (message: string, context?: Record<string, any>) => {
		winstonLogger.info(message, context)
		logToBetterStackNonBlocking('info', message, context)
	},
	http: (message: string, context?: Record<string, any>) => {
		winstonLogger.http(message, context)
		logToBetterStackNonBlocking('debug', message, context)
	},
	verbose: (message: string, context?: Record<string, any>) => {
		winstonLogger.verbose(message, context)
		logToBetterStackNonBlocking('debug', message, context)
	},
	debug: (message: string, context?: Record<string, any>) => {
		winstonLogger.debug(message, context)
		logToBetterStackNonBlocking('debug', message, context)
	},
	silly: (message: string, context?: Record<string, any>) => {
		winstonLogger.silly(message, context)
		logToBetterStackNonBlocking('debug', message, context)
	}
}

export default logger
