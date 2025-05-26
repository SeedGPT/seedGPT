import { createLogger, format as _format, transports as _transports } from 'winston'

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
					let message = `${logObject.timestamp} ${logObject.level}: ${logObject.message}`
					
					// If there's additional context beyond service, timestamp, level, and message, show it
					const contextKeys = Object.keys(logObject).filter(key => 
						!['timestamp', 'level', 'message', 'service'].includes(key)
					)
					
					if (contextKeys.length > 0) {
						const context: Record<string, any> = {}
						contextKeys.forEach(key => {
							context[key] = logObject[key]
						})
						message += `\n    Context: ${JSON.stringify(context, null, 2).replace(/\n/g, '\n    ')}`
					}
					
					return message
				})
			),
			level: 'debug' // Console transport logs everything from debug level and above
		})
	]
})

// Helper to log context that would have gone to BetterStack for debugging
const logContextForDebugging = (
	originalLevel: 'error' | 'warn' | 'info' | 'debug',
	originalMessage: string,
	context?: Record<string, any>
): void => {
	if (context) {
		let sanitizedContext = { ...context } // Clone to avoid modifying original context if it's reused
		if (context.error instanceof Error) {
			const err = context.error
			sanitizedContext.error = {
				message: err.message,
				stack: err.stack,
				name: err.name
			}
		}
		
		// Log context directly with the winston logger, which will now format it properly
		winstonLogger.debug(
			`[Context for ${originalLevel} log: '${originalMessage.substring(0, 50)}${originalMessage.length > 50 ? '...' : ''}']`,
			sanitizedContext
		)
	}
}

const logger = {
	error: (message: string, context?: Record<string, any>) => {
		winstonLogger.error(message, context)
		logContextForDebugging('error', message, context)
	},
	warn: (message: string, context?: Record<string, any>) => {
		winstonLogger.warn(message, context)
		logContextForDebugging('warn', message, context)
	},
	info: (message: string, context?: Record<string, any>) => {
		winstonLogger.info(message, context)
		logContextForDebugging('info', message, context)
	},
	http: (message: string, context?: Record<string, any>) => {
		winstonLogger.http(message, context)
		// Retain original mapping: http, verbose, debug, silly logs went to BetterStack as 'debug'
		logContextForDebugging('debug', message, context)
	},
	verbose: (message: string, context?: Record<string, any>) => {
		winstonLogger.verbose(message, context)
		logContextForDebugging('debug', message, context)
	},
	debug: (message: string, context?: Record<string, any>) => {
		winstonLogger.debug(message, context)
		logContextForDebugging('debug', message, context)
	},
	silly: (message: string, context?: Record<string, any>) => {
		winstonLogger.silly(message, context)
		logContextForDebugging('debug', message, context)
	}
}

export default logger
