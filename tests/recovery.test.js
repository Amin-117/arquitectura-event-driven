import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHarness, waitFor } from './helpers.js'

const h = createHarness()
beforeEach(() => h.flush())
afterEach(() => h.close())

describe('recuperación tras caída', () => {
  it('al arrancar procesa primero sus pendientes (ID 0)', async () => {
    const redis = h.redis()
    // Simulamos una caída: el consumidor leyó el evento pero murió antes del ACK.
    await redis.xgroup('CREATE', 'mateshop.events', 'notifications', '$', 'MKSTREAM')
    await h.bus('orders').publish('order.cancelled', { orderId: 'r1', customer: 'Ana', reason: 'prueba' })
    await redis.xreadgroup('GROUP', 'notifications', 'notif-1', 'COUNT', 10, 'STREAMS', 'mateshop.events', '>')
    expect((await redis.xpending('mateshop.events', 'notifications'))[0]).toBe(1)

    const seen = []
    const revived = h.bus('notifications', { consumer: 'notif-1', idleMs: 60000 })
    revived.on('order.cancelled', (e) => void seen.push(e.data.orderId))
    await revived.start()

    await waitFor(() => seen.length === 1, { message: 'pendiente recuperado' })
    expect(seen).toEqual(['r1'])
    expect((await redis.xpending('mateshop.events', 'notifications'))[0]).toBe(0)
  })
})
