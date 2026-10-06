import { STREAM, DLQ_STREAM } from '@mateshop/contracts'
import { DUPLICATES_KEY, HEARTBEAT_PREFIX } from '@mateshop/event-bus'

export const SERVICES = ['orders', 'payments', 'inventory', 'notifications', 'analytics', 'dashboard']

/**
 * Junta los contadores que muestra el panel.
 * @param {import('ioredis').Redis} redis
 */
export async function collectMetrics(redis) {
  const [total, dlq, duplicates, groups, heartbeats] = await Promise.all([
    redis.xlen(STREAM),
    redis.xlen(DLQ_STREAM),
    redis.get(DUPLICATES_KEY),
    readGroups(redis),
    readHeartbeats(redis)
  ])
  const services = Object.fromEntries(
    SERVICES.map((s) => [s, { instances: heartbeats.filter((h) => h.service === s).length }])
  )
  return {
    total,
    dlq,
    duplicates: Number(duplicates ?? 0),
    pending: groups.reduce((acc, g) => acc + g.pending, 0),
    groups,
    services,
    at: new Date().toISOString()
  }
}

/** XINFO GROUPS: `pending` = entregados sin ACK; `lag` = todavía no entregados al grupo. */
async function readGroups(redis) {
  let rows
  try {
    rows = await redis.xinfo('GROUPS', STREAM)
  } catch {
    return [] // el stream todavía no existe
  }
  return rows.map((row) => {
    const g = {}
    for (let i = 0; i < row.length; i += 2) g[row[i]] = row[i + 1]
    return { name: g.name, consumers: g.consumers, pending: g.pending, lag: g.lag ?? null }
  })
}

async function readHeartbeats(redis) {
  const keys = []
  let cursor = '0'
  do {
    const [next, batch] = await redis.scan(cursor, 'MATCH', `${HEARTBEAT_PREFIX}*`, 'COUNT', 100)
    cursor = next
    keys.push(...batch)
  } while (cursor !== '0')
  if (keys.length === 0) return []
  const values = await redis.mget(...keys)
  return values.filter(Boolean).map((v) => JSON.parse(v))
}
