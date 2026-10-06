import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHarness, waitFor } from './helpers.js'
import { startShop } from './shop.js'

const h = createHarness()
beforeEach(() => h.flush())
afterEach(() => h.close())

/** Espera a que el modelo de lectura de la tienda tenga el pedido resuelto. */
const finalOf = (shop, orderId) =>
  waitFor(async () => {
    const o = await shop.storefront.getOrder(orderId)
    return o && o.status !== 'PENDING' && o
  }, { message: `pedido ${orderId} resuelto en la tienda` })

describe('modelo de lectura de la tienda (CQRS)', () => {
  it('refleja un pedido confirmado con todos sus pasos, el stock nuevo y las notificaciones', async () => {
    const redis = h.redis()
    const shop = await startShop(h)
    const { orderId } = await shop.orders.placeOrder({
      customer: 'Ana',
      email: 'Ana@Ejemplo.com',
      cardNumber: '4111111111111111',
      items: [{ sku: 'MATE-05', qty: 2 }]
    })

    const order = await finalOf(shop, orderId)
    expect(order).toMatchObject({ status: 'CONFIRMED', reason: '', failedStep: null, total: 24000, email: 'Ana@Ejemplo.com' })
    expect(Object.keys(order.steps).sort()).toEqual(['confirmed', 'paid', 'received', 'reserved'])
    expect(order.items[0]).toMatchObject({ sku: 'MATE-05', qty: 2, name: 'Mate de algarrobo' })

    await waitFor(async () => (await shop.storefront.catalog()).find((p) => p.sku === 'MATE-05').available === 6, {
      message: 'stock de MATE-05 en 6'
    })
    const mine = await shop.storefront.ordersByEmail('ana@ejemplo.com')
    expect(mine.map((o) => o.orderId)).toEqual([orderId])

    const inbox = await waitFor(async () => {
      const n = await shop.storefront.inbox('ana@ejemplo.com')
      return n.some((x) => x.asunto.startsWith('¡Pedido confirmado')) && n
    }, { message: 'notificación de confirmación' })
    expect(inbox.every((n) => n.orderId === orderId)).toBe(true)

    // La tienda escribe solo bajo su prefijo.
    const keys = await redis.keys('storefront:*')
    expect(keys.length).toBeGreaterThan(0)
  })

  it('refleja un pedido cancelado por falta de stock con la devolución en lenguaje claro', async () => {
    const shop = await startShop(h)
    const { orderId } = await shop.orders.placeOrder({
      customer: 'Bruno',
      email: 'bruno@ejemplo.com',
      items: [{ sku: 'TERMO-04', qty: 1 }]
    })
    const order = await finalOf(shop, orderId)
    expect(order).toMatchObject({
      status: 'CANCELLED',
      failedStep: 'reserved',
      refunded: true,
      reason: 'No había stock suficiente; te devolvimos el dinero'
    })
    expect(order.steps.paid).toBeTruthy()
    expect(order.steps.reserved).toBeUndefined()
  })

  it('refleja un pago rechazado con tarjeta 0000', async () => {
    const shop = await startShop(h)
    const { orderId } = await shop.orders.placeOrder({
      customer: 'Carla',
      email: 'carla@ejemplo.com',
      cardNumber: '5555 4444 3333 0000',
      items: [{ sku: 'YERBA-03', qty: 1 }]
    })
    const order = await finalOf(shop, orderId)
    expect(order).toMatchObject({
      status: 'CANCELLED',
      failedStep: 'paid',
      refunded: false,
      reason: 'Tu pago fue rechazado: fondos insuficientes'
    })
  })

  it('demo.reset limpia el modelo de lectura y el stock vuelve a sembrarse', async () => {
    const redis = h.redis()
    const shop = await startShop(h)
    const { orderId } = await shop.orders.placeOrder({ customer: 'Ana', email: 'ana@ejemplo.com', items: [{ sku: 'MATE-01', qty: 1 }] })
    await finalOf(shop, orderId)

    await shop.buses.orders.publish('demo.reset', { requestedBy: 'test' }, { correlationid: 'demo' })
    await waitFor(async () => !(await shop.storefront.getOrder(orderId)), { message: 'pedido borrado' })
    await waitFor(async () => (await redis.hget('storefront:stock', 'MATE-01')) === '10', { message: 'stock re-sembrado' })
  })
})
