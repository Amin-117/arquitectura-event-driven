import express from 'express'
import { InvalidOrderError } from './service.js'

/**
 * API REST de pedidos.
 * @param {ReturnType<typeof import('./service.js').createOrdersService>} orders
 * @param {import('pino').Logger} logger
 */
export function createHttpApp(orders, logger) {
  const app = express()
  app.use(express.json())

  // CORS abierto: el panel (otro origen, :8080) crea pedidos desde el navegador.
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
    res.json({
      servicio: 'orders',
      endpoints: ['POST /orders', 'GET /orders', 'GET /orders/:id', 'GET /health'],
      ejemplo: { customer: 'Ana', email: 'ana@ejemplo.com', cardNumber: '4111111111111111', items: [{ sku: 'MATE-01', qty: 1 }] },
      nota: 'el total lo calcula el servidor con el catálogo'
    })
  })

  app.get('/health', (_req, res) => res.json({ estado: 'ok' }))

  app.post('/orders', async (req, res) => {
    try {
      const order = await orders.placeOrder(req.body)
      // 202 Accepted: el pedido quedó registrado, pero el resultado llega después vía eventos.
      res
        .status(202)
        .location(`/orders/${order.orderId}`)
        .json({
          orderId: order.orderId,
          status: order.status,
          total: order.total,
          correlationid: `order-${order.orderId}`,
          mensaje: 'Pedido recibido: se procesa de forma asíncrona'
        })
    } catch (err) {
      if (err instanceof InvalidOrderError) {
        return res.status(400).json({ error: 'pedido inválido', detalles: err.details })
      }
      logger.error({ error: err.message }, 'no se pudo crear el pedido')
      res.status(500).json({ error: 'error interno' })
    }
  })

  app.get('/orders', async (_req, res) => {
    res.json(await orders.listOrders())
  })

  app.get('/orders/:id', async (req, res) => {
    const order = await orders.getOrder(req.params.id)
    if (!order) return res.status(404).json({ error: 'pedido no encontrado' })
    res.json(order)
  })

  app.use((_req, res) => res.status(404).json({ error: 'ruta no encontrada' }))

  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'el cuerpo no es JSON válido' })
    logger.error({ error: err.message }, 'error inesperado en la API')
    res.status(500).json({ error: 'error interno' })
  })

  return app
}
