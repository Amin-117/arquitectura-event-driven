import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { Server } from 'socket.io'
import { STREAM, TELEMETRY_CHANNEL } from '@mateshop/contracts'
import { bootstrap } from '@mateshop/event-bus'
import { createDashboardState, parseEntry } from './state.js'
import { collectMetrics } from './metrics.js'
import { createScenes } from './scenes.js'

const PORT = Number(process.env.PORT ?? 8080)
const publicDir = fileURLToPath(new URL('../public', import.meta.url))

await bootstrap({
  service: 'dashboard',
  // El panel es un observador: ve todo (también lo inválido y los duplicados) y nunca participa del negocio.
  busOptions: { startId: '$', validate: false, idempotent: false },
  setup: async ({ bus, redis, logger }) => {
    const state = createDashboardState()
    const app = express()
    const server = createServer(app)
    const io = new Server(server)

    // Si el panel se reinicia en medio de la demo, reconstruye su vista leyendo el stream desde el principio.
    const history = await redis.xrange(STREAM, '-', '+')
    for (const [id, fields] of history) state.apply(id, parseEntry(fields))
    logger.info({ events: history.length }, 'vista reconstruida con XRANGE')

    bus.on('*', (event, { streamId }) => {
      const entry = state.apply(streamId, event)
      if (entry) io.emit('event', { entry, order: state.orderOf(event?.data?.orderId) ?? null })
    })

    // Telemetría del bus (procesado, reintento, duplicado, DLQ) por Pub/Sub: no ensucia el stream de negocio.
    const subscriber = redis.duplicate()
    await subscriber.subscribe(TELEMETRY_CHANNEL)
    subscriber.on('message', (_channel, message) => {
      try {
        io.emit('telemetry', JSON.parse(message))
      } catch {
        /* mensaje ilegible: se ignora */
      }
    })

    let lastMetrics = null
    const metricsTimer = setInterval(async () => {
      try {
        lastMetrics = await collectMetrics(redis)
        io.emit('metrics', lastMetrics)
      } catch (err) {
        logger.warn({ error: err.message }, 'no se pudieron leer las métricas')
      }
    }, 1000)

    const scenes = createScenes({
      bus,
      redis,
      logger,
      onReset: () => {
        state.clear()
        io.emit('snapshot', { ...state.snapshot(), metrics: lastMetrics })
      }
    })

    app.use(express.json())
    app.use(express.static(publicDir))
    app.get('/api/config', (_req, res) => res.json({ ordersApiUrl: process.env.ORDERS_API_URL ?? null }))
    app.get('/api/state', (_req, res) => res.json({ ...state.snapshot(), metrics: lastMetrics }))
    app.post('/api/scenes/:name', async (req, res) => {
      const scene = scenes[req.params.name]
      if (!scene) return res.status(404).json({ ok: false, mensaje: `Escena desconocida: ${req.params.name}` })
      try {
        const result = await scene()
        res.status(result.ok ? 200 : 409).json(result)
      } catch (err) {
        logger.error({ error: err.message }, 'falló la escena')
        res.status(500).json({ ok: false, mensaje: err.message })
      }
    })

    io.on('connection', (socket) => socket.emit('snapshot', { ...state.snapshot(), metrics: lastMetrics }))

    server.listen(PORT, () => logger.info({ port: PORT }, `panel en http://localhost:${PORT}`))

    return {
      close: async () => {
        clearInterval(metricsTimer)
        await subscriber.quit().catch(() => {})
        io.close()
        await new Promise((resolve) => server.close(() => resolve()))
      }
    }
  }
})
