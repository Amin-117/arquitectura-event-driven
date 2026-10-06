import os from 'node:os'
import {
  buildEvent,
  validateEvent,
  STREAM,
  DLQ_STREAM,
  TELEMETRY_CHANNEL
} from '@mateshop/contracts'

/** Contador global de duplicados ignorados (lo muestra el panel). */
export const DUPLICATES_KEY = 'metrics:duplicates'

/**
 * @typedef {Object} HandlerContext
 * @property {import('pino').Logger} logger   logger con correlationid/type ya cargados
 * @property {number} deliveries              número de entrega (1 = primera vez)
 * @property {string} streamId                ID de la entrada en el stream
 */

/**
 * @callback EventHandler
 * @param {import('@mateshop/contracts').CloudEvent<any>} event
 * @param {HandlerContext} ctx
 * @returns {Promise<void>|void}
 */

/**
 * @typedef {Object} EventBusOptions
 * @property {import('ioredis').Redis} redis
 * @property {string} service             nombre del servicio (también define `source`)
 * @property {string} [group]             consumer group (por defecto = service)
 * @property {string} [consumer]          nombre del consumidor dentro del grupo
 * @property {string} [startId]           '$' = solo eventos nuevos, '0' = toda la historia
 * @property {number} [idleMs]            inactividad mínima para reclamar un pendiente
 * @property {number} [maxDeliveries]     al fallar esta entrega, el evento va a la DLQ
 * @property {number} [blockMs]
 * @property {number} [claimIntervalMs]
 * @property {number} [batchSize]
 * @property {boolean} [validate]         validar con zod antes de entregar al handler
 * @property {boolean} [idempotent]       ignorar eventos con un id ya procesado
 * @property {import('pino').Logger} logger
 */

/**
 * Crea un bus de eventos sobre Redis Streams para un servicio.
 * @param {EventBusOptions} opts
 */
export function createEventBus({
  redis,
  service,
  group = service,
  consumer = `${service}-${os.hostname()}`,
  stream = STREAM,
  dlqStream = DLQ_STREAM,
  startId = '$',
  idleMs = 5000,
  maxDeliveries = 3,
  blockMs = 2000,
  claimIntervalMs = 2000,
  batchSize = 10,
  validate = true,
  idempotent = true,
  logger
}) {
  /** @type {Map<string, EventHandler>} */
  const handlers = new Map()
  const source = `/services/${service}`
  // XREADGROUP con BLOCK ocupa la conexión: usamos una dedicada para no frenar el resto de comandos.
  const reader = redis.duplicate()
  let running = false
  /** @type {Promise<void>|null} */
  let loop = null
  let lastClaim = 0

  /**
   * Registra un handler para un tipo de evento ('*' = todos).
   * @param {import('@mateshop/contracts').EventType|'*'} type
   * @param {EventHandler} handler
   */
  function on(type, handler) {
    handlers.set(type, handler)
    return api
  }

  /**
   * Publica un evento validado en el stream compartido.
   * @param {import('@mateshop/contracts').EventType} type
   * @param {object} data
   * @param {{ correlationid?: string, subject?: string }} [opts]
   */
  async function publish(type, data, opts = {}) {
    const event = buildEvent(type, data, { source, ...opts })
    const result = validateEvent(event)
    if (!result.success) throw new Error(`evento inválido al publicar ${type}: ${result.error}`)
    await publishRaw(event)
    return event
  }

  /** Publica un sobre tal cual, sin validar (lo usan las escenas de demo). */
  async function publishRaw(event) {
    const streamId = await redis.xadd(stream, '*', 'event', JSON.stringify(event), 'type', String(event?.type ?? ''))
    logger.info(
      { correlationid: event?.correlationid, type: event?.type, eventId: event?.id, streamId },
      `publicado ${event?.type}`
    )
    return streamId
  }

  async function ensureGroup() {
    try {
      await redis.xgroup('CREATE', stream, group, startId, 'MKSTREAM')
      logger.info({ group, startId }, 'consumer group creado')
    } catch (err) {
      if (!String(err.message).includes('BUSYGROUP')) throw err
    }
  }

  async function telemetry(payload) {
    const message = { ...payload, service, group, consumer, time: new Date().toISOString() }
    await redis.publish(TELEMETRY_CHANNEL, JSON.stringify(message)).catch(() => {})
  }

  const ack = (streamId) => redis.xack(stream, group, streamId)

  async function deliveryCount(streamId) {
    const rows = await redis.xpending(stream, group, streamId, streamId, 1)
    return Number(rows?.[0]?.[3] ?? 1)
  }

  async function sendToDlq(streamId, raw, error, deliveries, event, log) {
    await redis.xadd(
      dlqStream, '*',
      'event', raw ?? '',
      'error', error,
      'group', group,
      'service', service,
      'deliveries', String(deliveries),
      'originalId', streamId,
      'failedAt', new Date().toISOString()
    )
    // ACK recién después de dejar el evento a salvo en la DLQ: así nunca se pierde.
    await ack(streamId)
    if (event?.id) await redis.del(`processed:${group}:${event.id}`)
    log.error({ error, deliveries }, 'evento movido a la DLQ')
    await telemetry({ kind: 'dlq', eventId: event?.id, type: event?.type, correlationid: event?.correlationid, error, deliveries })
  }

  async function processEntry(streamId, fields, deliveries) {
    const raw = fieldOf(fields, 'event')
    let event
    try {
      event = JSON.parse(raw)
    } catch {
      return sendToDlq(streamId, raw, 'JSON inválido', deliveries, null, logger)
    }

    const handler = handlers.get(event?.type) ?? handlers.get('*')
    if (!handler) {
      // Difusión: cada grupo recibe todo, pero solo procesa los tipos que le interesan.
      await ack(streamId)
      return
    }

    let log = logger.child({ correlationid: event?.correlationid, type: event?.type, eventId: event?.id })

    if (validate) {
      const result = validateEvent(event)
      if (!result.success) {
        // Un evento que no cumple el contrato nunca va a funcionar: reintentarlo no sirve, va directo a la DLQ.
        return sendToDlq(streamId, raw, `schema inválido: ${result.error}`, deliveries, event, log)
      }
      event = result.event
    }

    if (idempotent) {
      // Idempotencia: con at-least-once el mismo evento puede llegar dos veces.
      // Guardamos el ID de la entrada que "ganó" el evento: si llega otra entrada con el mismo
      // event.id es un duplicado; si es la misma entrada re-entregada (reintento o caída) se reprocesa.
      const key = `processed:${group}:${event.id}`
      const fresh = await redis.set(key, streamId, 'EX', 86400, 'NX')
      if (!fresh && (await redis.get(key)) !== streamId) {
        log.warn('duplicado ignorado')
        await ack(streamId)
        await redis.incr(DUPLICATES_KEY)
        await telemetry({ kind: 'duplicate', eventId: event.id, type: event.type, correlationid: event.correlationid })
        return
      }
    }

    try {
      await handler(event, { logger: log, deliveries, streamId })
    } catch (err) {
      // Sin ACK: el evento queda pendiente en el PEL del grupo y el loop de XAUTOCLAIM lo reintenta.
      log.warn({ error: err.message, deliveries }, `falló el procesamiento (entrega ${deliveries}/${maxDeliveries})`)
      if (deliveries >= maxDeliveries) {
        return sendToDlq(streamId, raw, err.message, deliveries, event, log)
      }
      await telemetry({ kind: 'retry', eventId: event.id, type: event.type, correlationid: event.correlationid, error: err.message, deliveries })
      return
    }

    // At-least-once: ACK solo después de procesar con éxito. Si el proceso muere antes, el evento sigue pendiente.
    await ack(streamId)
    log.debug({ deliveries }, 'evento procesado')
    await telemetry({ kind: 'processed', eventId: event.id, type: event.type, correlationid: event.correlationid, deliveries })
  }

  /** Lee las entradas que ya eran de este consumidor y quedaron sin ACK (p. ej. tras una caída). */
  async function drainOwnPending() {
    let lastId = '0'
    while (running) {
      const res = await reader.xreadgroup('GROUP', group, consumer, 'COUNT', batchSize, 'STREAMS', stream, lastId)
      const entries = res?.[0]?.[1] ?? []
      if (entries.length === 0) break
      for (const [id, fields] of entries) {
        lastId = id
        if (!running) return
        if (!fields) {
          await ack(id) // la entrada ya no existe en el stream (fue recortada)
          continue
        }
        await processEntry(id, fields, await deliveryCount(id))
      }
    }
    if (lastId !== '0') logger.info('pendientes recuperados tras el reinicio')
  }

  /** Reclama pendientes "olvidados" (de este u otro consumidor del grupo) y los reintenta. */
  async function reclaimStale() {
    let cursor = '0-0'
    do {
      const [next, entries] = await redis.call(
        'XAUTOCLAIM', stream, group, consumer, String(idleMs), cursor, 'COUNT', String(batchSize)
      )
      cursor = next
      for (const [id, fields] of entries) {
        if (!running) return
        if (!fields) continue
        await processEntry(id, fields, await deliveryCount(id))
      }
    } while (cursor !== '0-0' && running)
  }

  async function runLoop() {
    while (running) {
      try {
        if (Date.now() - lastClaim >= claimIntervalMs) {
          lastClaim = Date.now()
          await reclaimStale()
        }
        const res = await reader.xreadgroup(
          'GROUP', group, consumer, 'COUNT', batchSize, 'BLOCK', blockMs, 'STREAMS', stream, '>'
        )
        for (const [id, fields] of res?.[0]?.[1] ?? []) {
          // Si nos piden apagar, dejamos el resto pendiente: se recupera al volver (o lo reclama otra réplica).
          if (!running) break
          await processEntry(id, fields, 1)
        }
      } catch (err) {
        if (!running) break
        if (String(err.message).includes('NOGROUP')) {
          await ensureGroup().catch(() => {})
          continue
        }
        logger.error({ error: err.message }, 'error en el loop de consumo')
        await sleep(1000)
      }
    }
  }

  async function start() {
    await ensureGroup()
    running = true
    // Recuperación tras caída: primero lo pendiente propio (ID 0) y después lo nuevo (>).
    await drainOwnPending()
    loop = runLoop()
  }

  /** Apagado limpio: deja de leer, espera a que termine el evento en curso y cierra la conexión. */
  async function stop() {
    if (!running && !loop) return
    running = false
    await loop?.catch(() => {})
    loop = null
    reader.disconnect()
  }

  const handledTypes = () => [...handlers.keys()]

  const api = { on, publish, publishRaw, start, stop, handledTypes, service, group, consumer, stream, dlqStream }
  return api
}

function fieldOf(fields, name) {
  for (let i = 0; i < fields.length; i += 2) if (fields[i] === name) return fields[i + 1]
  return undefined
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
