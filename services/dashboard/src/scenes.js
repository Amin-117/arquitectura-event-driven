import { randomUUID } from 'node:crypto'
import { buildEvent, validateEvent, STREAM, DLQ_STREAM } from '@mateshop/contracts'
import { DUPLICATES_KEY } from '@mateshop/event-bus'
import { parseEntry } from './state.js'

/**
 * Escenas de demo que el panel ejecuta directamente sobre Redis.
 * (Las escenas de pedidos las dispara el navegador contra la API de orders.)
 * @param {{ bus: ReturnType<typeof import('@mateshop/event-bus').createEventBus>, redis: import('ioredis').Redis, logger: import('pino').Logger, onReset: () => void }} ctx
 */
export function createScenes({ bus, redis, logger, onReset }) {
  /** Reenvía el último evento de negocio válido con el MISMO id: los consumidores deben ignorarlo. */
  async function duplicateLast() {
    const rows = await redis.xrevrange(STREAM, '+', '-', 'COUNT', 100)
    const last = rows
      .map(([, fields]) => parseEntry(fields))
      .find((e) => e?.type !== 'demo.reset' && e?.source !== '/services/dashboard' && validateEvent(e).success)
    if (!last) return { ok: false, mensaje: 'Todavía no hay eventos para reenviar: creá un pedido primero' }
    await bus.publishRaw(last)
    logger.info({ type: last.type, eventId: last.id, correlationid: last.correlationid }, 'escena: evento reenviado (duplicado)')
    return { ok: true, mensaje: `Reenviado ${last.type} con el mismo id ${last.id.slice(0, 8)}…`, type: last.type, eventId: last.id }
  }

  /** Publica un order.created que no cumple el contrato: tiene que terminar en la DLQ. */
  async function poison() {
    const orderId = `veneno-${randomUUID().slice(0, 4)}`
    const event = buildEvent('order.created', { orderId, items: '💀', total: -1 }, { source: '/services/dashboard' })
    await bus.publishRaw(event)
    logger.info({ eventId: event.id }, 'escena: evento envenenado publicado')
    return { ok: true, mensaje: 'Publicado un order.created sin cliente y con ítems inválidos', eventId: event.id }
  }

  /** Vacía los streams (conservando los consumer groups) y avisa a todos con demo.reset. */
  async function reset() {
    await redis.multi().xtrim(STREAM, 'MAXLEN', 0).xtrim(DLQ_STREAM, 'MAXLEN', 0).del(DUPLICATES_KEY).exec()
    onReset()
    await bus.publish('demo.reset', { requestedBy: 'dashboard' }, { correlationid: 'demo', subject: 'demo' })
    logger.info('escena: demo reiniciada')
    return { ok: true, mensaje: 'Demo reiniciada: streams vacíos y stock vuelto a sembrar' }
  }

  return { duplicate: duplicateLast, poison, reset }
}
