import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SUBSCRIPTIONS, validateEvent, buildEvent, EVENT_TYPES, PRODUCERS } from '@mateshop/contracts'
import { createHarness } from './helpers.js'
import { startShop } from './shop.js'

const h = createHarness()
beforeEach(() => h.flush())
afterEach(() => h.close())

describe('contratos', () => {
  it('cada servicio escucha exactamente los tipos declarados en SUBSCRIPTIONS', async () => {
    const shop = await startShop(h)
    for (const [service, types] of Object.entries(SUBSCRIPTIONS)) {
      expect(shop.buses[service].handledTypes().sort()).toEqual([...types].sort())
    }
  })

  it('buildEvent arma un sobre CloudEvents 1.0 válido con correlation ID del pedido', () => {
    const event = buildEvent('order.cancelled', { orderId: 'ab12', customer: 'Ana', reason: 'x' }, { source: '/services/orders' })
    expect(event).toMatchObject({
      specversion: '1.0',
      type: 'order.cancelled',
      source: '/services/orders',
      subject: 'order-ab12',
      correlationid: 'order-ab12',
      datacontenttype: 'application/json',
      dataversion: '1'
    })
    expect(validateEvent(event).success).toBe(true)
  })

  it('todos los tipos tienen productor declarado', () => {
    for (const type of EVENT_TYPES) expect(PRODUCERS[type]).toBeTruthy()
  })
})
