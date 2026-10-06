import pino from 'pino'

/**
 * Logger JSON estructurado. Cada línea lleva `service`; los handlers agregan `correlationid` y `type`.
 * @param {string} service
 */
export function createLogger(service) {
  return pino({
    level: process.env.LOG_LEVEL ?? 'info',
    base: { service },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) }
  })
}
