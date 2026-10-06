import { createEventBus, createRedis, createLogger } from '@mateshop/event-bus'
import { STREAM, DLQ_STREAM } from '@mateshop/contracts'

/** Los tests usan la base 15 para no tocar los datos de la demo (base 0). */
export const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/15'

/** Opciones rápidas: reintentos en ~200 ms en lugar de 5 s. */
export const FAST = { blockMs: 100, claimIntervalMs: 100, idleMs: 200 }

/** Arnés que crea buses/conexiones y los cierra todos al final de cada test. */
export function createHarness() {
  const redisConns = []
  const buses = []
  const logger = createLogger('test')

  const redis = () => {
    const r = createRedis(TEST_REDIS_URL)
    redisConns.push(r)
    return r
  }

  const bus = (service, opts = {}) => {
    const b = createEventBus({ redis: redis(), service, logger: logger.child({ service }), ...FAST, ...opts })
    buses.push(b)
    return b
  }

  return {
    logger,
    redis,
    bus,
    async flush() {
      await redis().flushdb()
    },
    async close() {
      await Promise.all(buses.map((b) => b.stop()))
      await Promise.all(redisConns.map((r) => r.quit().catch(() => {})))
      buses.length = 0
      redisConns.length = 0
    }
  }
}

/** Espera hasta que `fn` devuelva algo truthy (o falla por timeout). */
export async function waitFor(fn, { timeout = 10000, interval = 50, message = 'condición' } = {}) {
  const start = Date.now()
  for (;;) {
    const value = await fn()
    if (value) return value
    if (Date.now() - start > timeout) throw new Error(`timeout esperando: ${message}`)
    await new Promise((r) => setTimeout(r, interval))
  }
}

/** Lee un stream completo y devuelve las entradas con el evento ya parseado. */
export async function readEvents(redis, stream = STREAM) {
  const rows = await redis.xrange(stream, '-', '+')
  return rows.map(([id, fields]) => {
    const obj = {}
    for (let i = 0; i < fields.length; i += 2) obj[fields[i]] = fields[i + 1]
    return { streamId: id, ...obj, event: safeParse(obj.event) }
  })
}

export const readDlq = (redis) => readEvents(redis, DLQ_STREAM)

function safeParse(raw) {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}
