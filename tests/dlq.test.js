import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHarness, waitFor, readDlq } from './helpers.js'

const h = createHarness()
beforeEach(() => h.flush())
afterEach(() => h.close())

const order = (orderId) => ({ orderId, customer: 'Ana', items: [{ sku: 'MATE-01', qty: 1 }], total: 100 })

describe('reintentos y DLQ', () => {
  it('un handler que siempre falla deja el evento en mateshop.dlq tras 3 intentos', async () => {
    const redis = h.redis()
    let attempts = 0
    const consumer = h.bus('fragil').on('order.created', async () => {
      attempts++
      throw new Error('base de datos caída')
    })
    await consumer.start()

    const event = await h.bus('orders').publish('order.created', order('f1'))

    const [dead] = await waitFor(async () => {
      const dlq = await readDlq(redis)
      return dlq.length ? dlq : null
    }, { message: 'evento en la DLQ' })

    expect(attempts).toBe(3)
    expect(dead.event.id).toBe(event.id)
    expect(dead.error).toBe('base de datos caída')
    expect(dead.group).toBe('fragil')
    expect(dead.deliveries).toBe('3')
    const [pending] = await redis.xpending('mateshop.events', 'fragil')
    expect(pending).toBe(0) // tras moverlo a la DLQ se hace ACK
  })

  it('si el segundo intento funciona, no va a la DLQ', async () => {
    const redis = h.redis()
    let attempts = 0
    const consumer = h.bus('inestable').on('order.created', async () => {
      attempts++
      if (attempts === 1) throw new Error('falla transitoria')
    })
    await consumer.start()
    await h.bus('orders').publish('order.created', order('f2'))

    await waitFor(() => attempts === 2, { message: 'reintento' })
    await waitFor(async () => (await redis.xpending('mateshop.events', 'inestable'))[0] === 0, { message: 'ACK' })
    expect(await redis.xlen('mateshop.dlq')).toBe(0)
  })
})
