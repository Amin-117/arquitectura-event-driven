import express from 'express'
import { UnknownSkuError } from './service.js'

/**
 * API de administración del propio inventario (solo para la demo: sin login).
 * @param {ReturnType<typeof import('./service.js').createInventoryService>} inventory
 * @param {import('pino').Logger} logger
 */
export function createHttpApp(inventory, logger) {
  const app = express()
  app.use(express.json())

  // CORS abierto: la página de admin de la tienda (otro origen, :8081) repone stock desde el navegador.
  app.use((req, res, next) => {
    res.set({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    })
    if (req.method === 'OPTIONS') return res.sendStatus(204)
    next()
  })

  app.get('/', (_req, res) => {
    res.json({ servicio: 'inventory', endpoints: ['POST /admin/stock/:sku/replenish { qty }', 'GET /health'] })
  })

  app.get('/health', (_req, res) => res.json({ estado: 'ok' }))

  app.post('/admin/stock/:sku/replenish', async (req, res) => {
    const qty = Number(req.body?.qty)
    if (!Number.isInteger(qty) || qty < 1 || qty > 1000) {
      return res.status(400).json({ error: 'qty debe ser un entero entre 1 y 1000' })
    }
    try {
      res.json(await inventory.replenish(req.params.sku, qty))
    } catch (err) {
      if (err instanceof UnknownSkuError) return res.status(404).json({ error: err.message })
      logger.error({ error: err.message }, 'no se pudo reponer stock')
      res.status(500).json({ error: 'error interno' })
    }
  })

  app.use((_req, res) => res.status(404).json({ error: 'ruta no encontrada' }))

  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'el cuerpo no es JSON válido' })
    logger.error({ error: err.message }, 'error inesperado en la API')
    res.status(500).json({ error: 'error interno' })
  })

  return app
}
