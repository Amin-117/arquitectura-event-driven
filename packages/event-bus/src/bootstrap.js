import { createRedis } from './redis.js'
import { createLogger } from './logger.js'
import { createEventBus } from './bus.js'
import { startHeartbeat } from './heartbeat.js'

/**
 * Arranque estándar de un servicio: Redis + logger + bus + heartbeat + apagado limpio.
 * `setup` registra los handlers y puede devolver `{ close }` para liberar recursos propios (p. ej. HTTP).
 * @param {{
 *   service: string,
 *   busOptions?: Partial<import('./bus.js').EventBusOptions>,
 *   setup: (ctx: { bus: ReturnType<typeof createEventBus>, redis: import('ioredis').Redis, logger: import('pino').Logger }) => Promise<{ close?: () => Promise<void> } | void> | { close?: () => Promise<void> } | void
 * }} opts
 */
export async function bootstrap({ service, busOptions = {}, setup }) {
  const logger = createLogger(service)
  const redis = createRedis()
  const bus = createEventBus({ redis, service, logger, ...busOptions })
  const resources = (await setup({ bus, redis, logger })) ?? {}
  const heartbeat = startHeartbeat({ redis, service })
  await bus.start()
  logger.info({ group: bus.group, consumer: bus.consumer }, 'servicio iniciado')

  let stopping = false
  const shutdown = async (signal) => {
    if (stopping) return
    stopping = true
    logger.info({ signal }, 'apagado limpio: termino el evento en curso y cierro')
    const force = setTimeout(() => process.exit(1), 8000)
    force.unref()
    try {
      await resources.close?.()
      await bus.stop()
      await heartbeat.stop()
      await redis.quit()
    } finally {
      process.exit(0)
    }
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
  return { bus, redis, logger }
}
