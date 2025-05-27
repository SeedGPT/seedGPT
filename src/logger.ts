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

const logger = {
	error: (message: string, context?: Record<string, any>) => {
		winstonLogger.error(message, context)	},
	warn: (message: string, context?: Record<string, any>) => {
		winstonLogger.warn(message, context)
	},
	info: (message: string, context?: Record<string, any>) => {
		winstonLogger.info(message, context)
	},
	http: (message: string, context?: Record<string, any>) => {
		winstonLogger.http(message, context)
	},
	verbose: (message: string, context?: Record<string, any>) => {
		winstonLogger.verbose(message, context)
	},
	debug: (message: string, context?: Record<string, any>) => {
		winstonLogger.debug(message, context)
	},
	silly: (message: string, context?: Record<string, any>) => {
		winstonLogger.silly(message, context)
	}
}

export default logger
