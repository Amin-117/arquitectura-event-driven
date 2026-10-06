import { bootstrap } from '@mateshop/event-bus'
import { createOrdersService } from './service.js'
import { createHttpApp } from './http.js'

const PORT = Number(process.env.PORT ?? 3000)

await bootstrap({
  service: 'orders',
  setup: (ctx) => {
    const orders = createOrdersService(ctx)
    const server = createHttpApp(orders, ctx.logger).listen(PORT, () =>
      ctx.logger.info({ port: PORT }, `API de pedidos en http://localhost:${PORT}`)
    )
    return { close: () => new Promise((resolve) => server.close(() => resolve())) }
  }
})
