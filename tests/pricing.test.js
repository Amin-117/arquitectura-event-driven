import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { CATALOG_BY_SKU } from '@mateshop/contracts'
import { InvalidOrderError } from '../services/orders/src/service.js'
import { createHarness, readEvents } from './helpers.js'
import { startShop } from './shop.js'

const h = createHarness()
beforeEach(() => h.flush())
afterEach(() => h.close())

describe('precio calculado en el servidor', () => {
  it('ignora el total que manda el cliente y usa el catálogo', async () => {
    const redis = h.redis()
    const shop = await startShop(h)
    const order = await shop.orders.placeOrder({
      customer: 'Tramposo',
      email: 'tramposo@ejemplo.com',
      items: [{ sku: 'MATE-06', qty: 2 }, { sku: 'YERBA-08', qty: 3 }],
      total: 1 // intento de pagar $1
    })

    const expected = 2 * CATALOG_BY_SKU['MATE-06'].price + 3 * CATALOG_BY_SKU['YERBA-08'].price
    expect(order.total).toBe(expected)
    expect((await shop.orders.getOrder(order.orderId)).total).toBe(expected)

    const created = (await readEvents(redis)).find((e) => e.event.type === 'order.created').event
    expect(created.data.total).toBe(expected)
  })

  it('rechaza productos que no están en el catálogo', async () => {
    const shop = await startShop(h)
    await expect(
      shop.orders.placeOrder({ customer: 'Ana', items: [{ sku: 'NO-EXISTE', qty: 1 }] })
    ).rejects.toBeInstanceOf(InvalidOrderError)
  })

  it('de la tarjeta solo viajan los últimos 4 dígitos', async () => {
    const redis = h.redis()
    const shop = await startShop(h)
    await shop.orders.placeOrder({
      customer: 'Ana',
      cardNumber: '4111 1111 1111 1234',
      items: [{ sku: 'MATE-01', qty: 1 }]
    })
    const raw = (await redis.xrange('mateshop.events', '-', '+')).map(([, f]) => f.join(' ')).join('\n')
    expect(raw).not.toContain('4111111111111234')
    expect(raw).toContain('"cardLast4":"1234"')
  })
})
