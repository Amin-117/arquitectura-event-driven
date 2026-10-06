import { createServer } from 'node:http'
import { Server } from 'socket.io'
import { bootstrap } from '@mateshop/event-bus'
import { createStorefrontReadModel } from './service.js'
import { createHttpApp } from './http.js'

const PORT = Number(process.env.PORT ?? 8081)

await bootstrap({
  service: 'storefront',
  // ID 0: si el grupo se crea por primera vez, el modelo de lectura se arma con toda la historia.
  busOptions: { startId: '0' },
  setup: (ctx) => {
    let io = null
    const store = createStorefrontReadModel({ ...ctx, onChange: (kind, payload) => io?.emit(kind, payload) })
    const server = createServer(createHttpApp(store))
    io = new Server(server)
    server.listen(PORT, () => ctx.logger.info({ port: PORT }, `tienda en http://localhost:${PORT}`))
    return {
      close: async () => {
        io.close()
        await new Promise((resolve) => server.close(() => resolve()))
      }
    }
  }
})
