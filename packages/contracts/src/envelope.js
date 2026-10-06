import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { DATA_SCHEMAS } from './events.js'

/**
 * Sobre CloudEvents 1.0 que envuelve a todo evento de MateShop.
 * @template [T=unknown]
 * @typedef {Object} CloudEvent
 * @property {'1.0'} specversion
 * @property {string} id               UUID v4, clave de idempotencia
 * @property {import('./events.js').EventType} type
 * @property {string} source           ej. "/services/orders"
 * @property {string} time             ISO-8601
 * @property {string} subject          ej. "order-ab12cd34"
 * @property {'application/json'} datacontenttype
 * @property {string} correlationid    ej. "order-ab12cd34"
 * @property {string} dataversion
 * @property {T} data
 */

const TYPE_NAMES = { string: 'texto', number: 'número', array: 'lista', object: 'objeto', boolean: 'booleano', undefined: 'nada', null: 'null' }

/** Mensajes de validación en español (se ven en la DLQ y en el panel). */
export const spanishErrors = (issue, ctx) => {
  switch (issue.code) {
    case 'invalid_type':
      return {
        message:
          issue.received === 'undefined'
            ? 'requerido'
            : `se esperaba ${TYPE_NAMES[issue.expected] ?? issue.expected}, llegó ${TYPE_NAMES[issue.received] ?? issue.received}`
      }
    case 'too_small':
      if (issue.type === 'array') return { message: `debe tener al menos ${issue.minimum} elemento(s)` }
      if (issue.type === 'string') return { message: 'no puede estar vacío' }
      return { message: `debe ser mayor${issue.inclusive ? ' o igual' : ''} a ${issue.minimum}` }
    case 'invalid_literal':
      return { message: `debe ser ${JSON.stringify(issue.expected)}` }
    case 'invalid_string':
      return { message: 'formato inválido' }
    default:
      return { message: ctx.defaultError }
  }
}

export const STREAM = 'mateshop.events'
export const DLQ_STREAM = 'mateshop.dlq'
export const TELEMETRY_CHANNEL = 'mateshop.telemetry'

export const EnvelopeSchema = z.object({
  specversion: z.literal('1.0'),
  id: z.string().uuid(),
  type: z.string().min(1),
  source: z.string().startsWith('/'),
  time: z.string().datetime({ offset: true }),
  subject: z.string().min(1),
  datacontenttype: z.literal('application/json'),
  correlationid: z.string().min(1),
  dataversion: z.string().min(1),
  data: z.unknown()
})

/** Correlation ID canónico de un pedido. */
export const correlationIdFor = (orderId) => `order-${orderId}`

/**
 * Arma un sobre CloudEvents listo para publicar.
 * @param {import('./events.js').EventType} type
 * @param {object} data
 * @param {{ source: string, correlationid?: string, subject?: string }} opts
 * @returns {CloudEvent}
 */
export function buildEvent(type, data, { source, correlationid, subject }) {
  const corr = correlationid ?? (data?.orderId ? correlationIdFor(data.orderId) : 'system')
  return {
    specversion: '1.0',
    id: randomUUID(),
    type,
    source,
    time: new Date().toISOString(),
    subject: subject ?? corr,
    datacontenttype: 'application/json',
    correlationid: corr,
    dataversion: '1',
    data
  }
}

/**
 * Valida sobre + data según el tipo.
 * @param {unknown} event
 * @returns {{ success: true, event: CloudEvent } | { success: false, error: string }}
 */
export function validateEvent(event) {
  const envelope = EnvelopeSchema.safeParse(event, { errorMap: spanishErrors })
  if (!envelope.success) return { success: false, error: formatIssues(envelope.error) }
  const schema = DATA_SCHEMAS[envelope.data.type]
  if (!schema) return { success: false, error: `tipo de evento desconocido: ${envelope.data.type}` }
  const data = schema.safeParse(envelope.data.data, { errorMap: spanishErrors })
  if (!data.success) return { success: false, error: formatIssues(data.error, 'data') }
  return { success: true, event: { ...envelope.data, data: data.data } }
}

function formatIssues(error, prefix) {
  return error.issues
    .map((i) => `${[prefix, ...i.path].filter((p) => p !== undefined).join('.') || '(raíz)'}: ${i.message}`)
    .join('; ')
}
