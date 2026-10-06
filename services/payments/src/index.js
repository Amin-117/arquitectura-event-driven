import { bootstrap } from '@mateshop/event-bus'
import { createPaymentsService } from './service.js'

await bootstrap({
  service: 'payments',
  setup: (ctx) => createPaymentsService(ctx)
})
