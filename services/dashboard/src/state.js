import { validateEvent, consumersOf } from '@mateshop/contracts'

/**
 * @typedef {Object} TimelineEntry
 * @property {string} streamId
 * @property {any} event            sobre CloudEvents tal cual llegó (puede ser inválido)
 * @property {string} producer
 * @property {string[]} consumers   servicios suscriptos a ese tipo
 * @property {boolean} valid
 * @property {string} [error]
 * @property {boolean} duplicate    mismo event.id que uno anterior
 */

/**
 * @typedef {Object} OrderView
 * @property {string} orderId
 * @property {string} customer
 * @property {{sku:string, qty:number}[]} items
 * @property {number} total
 * @property {'PENDING'|'CONFIRMED'|'CANCELLED'} status
 * @property {string} reason
 * @property {string} lastStep
 * @property {string} updatedAt
 */

const STEP_LABELS = {
  'order.created': 'pedido creado',
  'payment.approved': 'pago aprobado',
  'payment.rejected': 'pago rechazado',
  'stock.reserved': 'stock reservado',
  'stock.failed': 'sin stock',
  'payment.refunded': 'pago devuelto',
  'order.confirmed': 'confirmado',
  'order.cancelled': 'cancelado'
}

/**
 * Vista del panel derivada SOLO de los eventos del stream (no lee el estado de otros servicios).
 * @param {{ maxTimeline?: number }} [opts]
 */
export function createDashboardState({ maxTimeline = 200 } = {}) {
  /** @type {TimelineEntry[]} más nuevo primero */
  let timeline = []
  /** @type {Map<string, OrderView>} */
  let orders = new Map()
  let seenStreamIds = new Set()
  let seenEventIds = new Set()

  function clear() {
    timeline = []
    orders = new Map()
    seenStreamIds = new Set()
    seenEventIds = new Set()
  }

  /**
   * Aplica una entrada del stream. Devuelve null si ya se había visto (p. ej. tras reconstruir con XRANGE).
   * @returns {TimelineEntry|null}
   */
  function apply(streamId, event) {
    if (seenStreamIds.has(streamId)) return null
    if (event?.type === 'demo.reset') clear()
    seenStreamIds.add(streamId)

    const result = validateEvent(event)
    const duplicate = Boolean(event?.id) && seenEventIds.has(event.id)
    if (event?.id) seenEventIds.add(event.id)

    /** @type {TimelineEntry} */
    const entry = {
      streamId,
      event,
      producer: producerOf(event),
      consumers: consumersOf(event?.type),
      valid: result.success,
      error: result.success ? undefined : result.error,
      duplicate
    }
    timeline.unshift(entry)
    if (timeline.length > maxTimeline) timeline.length = maxTimeline

    if (result.success && !duplicate) updateOrder(result.event)
    return entry
  }

  function updateOrder(event) {
    const { orderId } = event.data ?? {}
    if (!orderId || !STEP_LABELS[event.type]) return
    const order = orders.get(orderId) ?? {
      orderId,
      customer: event.data.customer,
      items: event.data.items ?? [],
      total: event.data.total ?? 0,
      status: 'PENDING',
      reason: '',
      lastStep: '',
      updatedAt: event.time
    }
    order.lastStep = STEP_LABELS[event.type]
    order.updatedAt = event.time
    if (event.type === 'order.confirmed') order.status = 'CONFIRMED'
    if (event.type === 'order.cancelled') {
      order.status = 'CANCELLED'
      order.reason = event.data.reason
    }
    orders.set(orderId, order)
  }

  function snapshot() {
    return {
      timeline,
      orders: [...orders.values()].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    }
  }

  const orderOf = (orderId) => orders.get(orderId)

  return { apply, clear, snapshot, orderOf }
}

function producerOf(event) {
  const match = /^\/services\/([\w-]+)/.exec(event?.source ?? '')
  return match ? match[1] : 'desconocido'
}

/** Parsea el campo `event` de una entrada cruda del stream. */
export function parseEntry(fields) {
  for (let i = 0; i < fields.length; i += 2) {
    if (fields[i] === 'event') {
      try {
        return JSON.parse(fields[i + 1])
      } catch {
        return { type: '(JSON inválido)', raw: fields[i + 1] }
      }
    }
  }
  return { type: '(sin campo event)' }
}
