# ADR 0003 — CloudEvents 1.0 como formato de eventos

- **Estado:** aceptada
- **Fecha:** 2026-10-06

## Contexto

Todos los servicios leen los mismos eventos. Necesitamos un sobre común con metadatos (quién lo publicó, cuándo, de qué pedido es, versión del contenido) separado de los datos de negocio, y una forma de rechazar eventos mal formados.

## Decisión

- Cada evento es un sobre **CloudEvents 1.0** serializado como JSON en el campo `event` de la entrada del stream (más un campo `type` para inspeccionar con `redis-cli`).
- Atributos usados: `specversion`, `id` (UUID v4), `type`, `source` (`/services/<servicio>`), `time`, `subject`, `datacontenttype`, y las extensiones `correlationid` (`order-<id>`) y `dataversion`.
- Los contratos viven en `packages/contracts`: un schema **zod** por tipo + `@typedef` JSDoc para autocompletado en VS Code sin TypeScript.
- Se valida **al publicar** (`bus.publish` lanza error) y **al consumir** (un evento inválido va directo a la DLQ, sin reintentos: reintentarlo nunca lo va a arreglar).
- La documentación formal está en `docs/asyncapi.yaml` (AsyncAPI 3.0).

## Consecuencias

- ✅ Formato estándar y reconocible; herramientas y SDKs de CloudEvents podrían leerlo.
- ✅ `id` sirve como clave de idempotencia y `correlationid` une logs y eventos de un pedido.
- ✅ `dataversion` deja lugar para evolucionar `data` sin romper consumidores.
- ⚠️ Hay que mantener sincronizados zod, JSDoc y AsyncAPI (el test `contracts.test.js` controla parte de esa consistencia).
