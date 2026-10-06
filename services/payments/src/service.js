import { randomUUID } from 'node:crypto'
import { deleteKeys } from '@mateshop/event-bus'

/** Monto máximo que aprueba el "banco" (en pesos). */
export const PAYMENT_LIMIT = 100000

const paymentKey = (orderId) => `payments:${orderId}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Reglas del "banco" simulado: devuelve el motivo del rechazo, o null si el pago se aprueba. */
export function rejectionReason({ total, cardLast4 }) {
  if (cardLast4 === '0000') return 'fondos insuficientes'
  if (total > PAYMENT_LIMIT) return 'límite excedido'
  return null
}

/**
 * Servicio de pagos: dueño del estado `payments:*`.
 * @param {{ bus: ReturnType<typeof import('@mateshop/event-bus').createEventBus>, redis: import('ioredis').Redis, delayMs?: [number, number] }} ctx
 */
export function createPaymentsService({ bus, redis, delayMs = [300, 900] }) {
  bus.on('order.created', async (event) => {
    const { orderId, customer, items, total, cardLast4 } = event.data

    // Demora simulada del "banco" para que el flujo se vea en el panel.
    const [min, max] = delayMs
    await sleep(min + Math.random() * (max - min))

    const reason = rejectionReason({ total, cardLast4 })
    if (reason) {
      await redis.hset(paymentKey(orderId), { status: 'REJECTED', total: String(total), customer, reason })
      await bus.publish('payment.rejected', { orderId, customer, total, reason }, { correlationid: event.correlationid })
      return
    }

    const paymentId = `pay-${randomUUID().slice(0, 8)}`
    await redis.hset(paymentKey(orderId), { status: 'APPROVED', paymentId, total: String(total), customer })
    await bus.publish(
      'payment.approved',
      { orderId, customer, items, total, paymentId },
      { correlationid: event.correlationid }
    )
  })

  // Compensación: en una saga no hay rollback global; cada servicio deshace lo suyo publicando un evento.
  bus.on('stock.failed', async (event, { logger }) => {
    const { orderId, customer, reason } = event.data
    const payment = await redis.hgetall(paymentKey(orderId))
    if (payment.status !== 'APPROVED') {
      logger.info({ orderId, status: payment.status ?? 'sin pago' }, 'no hay pago aprobado para devolver')
      return
    }
    await redis.hset(paymentKey(orderId), { status: 'REFUNDED' })
    logger.info({ orderId, paymentId: payment.paymentId }, 'compensación: pago devuelto')
    await bus.publish(
      'payment.refunded',
      { orderId, customer, total: Number(payment.total), paymentId: payment.paymentId, reason },
      { correlationid: event.correlationid }
    )
  })

  bus.on('demo.reset', async (_event, { logger }) => {
    const deleted = await deleteKeys(redis, 'payments:*')
    logger.info({ deleted }, 'estado de pagos reiniciado')
  })
}
