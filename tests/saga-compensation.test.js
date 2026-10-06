import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHarness, waitFor, readEvents } from './helpers.js'
import { ORDER_FLOW_TYPES } from '@mateshop/contracts'
import { startShop } from './shop.js'

const h = createHarness()
beforeEach(() => h.flush())
afterEach(() => h.close())

describe('saga con compensación', () => {
  it('un pedido de TERMO-04 termina en CANCELLED y se publica payment.refunded', async () => {
    const redis = h.redis()
    const shop = await startShop(h)
    const order = await shop.orders.placeOrder({ customer: 'Carla', items: [{ sku: 'TERMO-04', qty: 1 }], total: 45000 })

    const final = await waitFor(async () => {
      const o = await shop.orders.getOrder(order.orderId)
      return o.status !== 'PENDING' && o
    }, { message: 'pedido resuelto' })

    expect(final.status).toBe('CANCELLED')
    expect(final.reason).toMatch(/sin stock/)

    const events = (await readEvents(redis)).map((e) => e.event).filter((e) => e.correlationid === `order-${order.orderId}` && ORDER_FLOW_TYPES.includes(e.type))
    expect(events.map((e) => e.type)).toEqual([
      'order.created',
      'payment.approved',
      'stock.failed',
      'payment.refunded',
      'order.cancelled'
    ])
    const refund = events.find((e) => e.type === 'payment.refunded')
    expect(refund.data).toMatchObject({ orderId: order.orderId, total: 45000 })
    expect(await redis.hget(`payments:${order.orderId}`, 'status')).toBe('REFUNDED')
  })

  it('si falta un solo ítem no se descuenta nada (reserva atómica)', async () => {
    const redis = h.redis()
    const shop = await startShop(h)
    const order = await shop.orders.placeOrder({
      customer: 'Dario',
      items: [{ sku: 'MATE-01', qty: 1 }, { sku: 'YERBA-03', qty: 5 }],
      total: 20000
    })
    await waitFor(async () => (await shop.orders.getOrder(order.orderId)).status === 'CANCELLED', { message: 'cancelado' })
    expect(await redis.hget('inventory:stock', 'MATE-01')).toBe('10')
    expect(await redis.hget('inventory:stock', 'YERBA-03')).toBe('2')
  })
})
