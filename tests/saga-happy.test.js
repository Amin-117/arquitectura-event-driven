import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHarness, waitFor, readEvents } from './helpers.js'
import { startShop } from './shop.js'

const h = createHarness()
beforeEach(() => h.flush())
afterEach(() => h.close())

const typesFor = async (redis, orderId) =>
  (await readEvents(redis)).filter((e) => e.event.correlationid === `order-${orderId}`).map((e) => e.event.type)

describe('saga feliz', () => {
  it('un pedido válido termina en CONFIRMED', async () => {
    const redis = h.redis()
    const shop = await startShop(h)

    const order = await shop.orders.placeOrder({
      customer: 'Ana',
      items: [{ sku: 'MATE-01', qty: 2 }, { sku: 'YERBA-03', qty: 1 }],
      total: 30000
    })
    expect(order.status).toBe('PENDING')

    const final = await waitFor(async () => {
      const o = await shop.orders.getOrder(order.orderId)
      return o.status !== 'PENDING' && o
    }, { message: 'pedido resuelto' })

    expect(final.status).toBe('CONFIRMED')
    expect(await typesFor(redis, order.orderId)).toEqual([
      'order.created',
      'payment.approved',
      'stock.reserved',
      'order.confirmed'
    ])
    expect(await redis.hget('inventory:stock', 'MATE-01')).toBe('8')
    expect(await redis.hget('inventory:stock', 'YERBA-03')).toBe('1')
    await waitFor(() => shop.notifications.sent.some((m) => m.includes('está confirmado')), { message: 'email' })
    await waitFor(async () => (await shop.analytics.summary()).orders === 1, { message: 'analytics' })
  })

  it('un pedido que excede el límite termina en CANCELLED sin tocar el stock', async () => {
    const redis = h.redis()
    const shop = await startShop(h)
    const order = await shop.orders.placeOrder({ customer: 'Bruno', items: [{ sku: 'MATE-01', qty: 1 }], total: 150000 })

    const final = await waitFor(async () => {
      const o = await shop.orders.getOrder(order.orderId)
      return o.status !== 'PENDING' && o
    }, { message: 'pedido resuelto' })

    expect(final.status).toBe('CANCELLED')
    expect(final.reason).toMatch(/límite excedido/)
    expect(await typesFor(redis, order.orderId)).toEqual(['order.created', 'payment.rejected', 'order.cancelled'])
    expect(await redis.hget('inventory:stock', 'MATE-01')).toBe('10')
  })
})
