import os from 'node:os'

export const HEARTBEAT_PREFIX = 'heartbeat:'

/**
 * Publica un latido cada `intervalMs` en una clave con TTL: si el servicio muere, la clave expira sola.
 * @param {{ redis: import('ioredis').Redis, service: string, instance?: string, intervalMs?: number, ttlSeconds?: number }} opts
 */
export function startHeartbeat({ redis, service, instance = os.hostname(), intervalMs = 2000, ttlSeconds = 6 }) {
  const key = `${HEARTBEAT_PREFIX}${service}:${instance}`
  const beat = () =>
    redis
      .set(key, JSON.stringify({ service, instance, time: new Date().toISOString() }), 'EX', ttlSeconds)
      .catch(() => {})
  beat()
  const timer = setInterval(beat, intervalMs)
  return {
    async stop() {
      clearInterval(timer)
      await redis.del(key).catch(() => {})
    }
  }
}
