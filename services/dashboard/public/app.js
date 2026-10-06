import { buildOrder } from './presets.js'

/* global io */

// ---------------------------------------------------------------------------
// Configuración visual
// ---------------------------------------------------------------------------

const SVG_NS = 'http://www.w3.org/2000/svg'
const BROKER = { x: 500, y: 300 }

const NODES = {
  orders: { x: 165, y: 95, sub: 'API REST · :3000' },
  payments: { x: 500, y: 70, sub: 'cobra y devuelve' },
  inventory: { x: 835, y: 95, sub: 'reserva stock' },
  notifications: { x: 860, y: 305, sub: 'manda emails' },
  analytics: { x: 780, y: 520, sub: 'ventas · perfil extra' },
  dashboard: { x: 220, y: 520, sub: 'este panel (observa)', observer: true },
  storefront: { x: 500, y: 545, sub: 'tienda · modelo de lectura' },
  dlq: { x: 140, y: 305, label: 'DLQ', sub: 'mateshop.dlq' }
}

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()
const serviceColor = (name) => css(`--c-${name}`) || css('--muted')

const TYPE_COLORS = {
  'order.created': '#60a5fa',
  'payment.approved': '#34d399',
  'payment.rejected': '#f87171',
  'stock.reserved': '#a3e635',
  'stock.failed': '#fb923c',
  'payment.refunded': '#fbbf24',
  'order.confirmed': '#22c55e',
  'order.cancelled': '#f43f5e',
  'stock.updated': '#7dd3fc',
  'stock.replenished': '#a78bfa',
  'notification.sent': '#5eead4',
  'demo.reset': '#94a3b8'
}
const typeColor = (type) => TYPE_COLORS[type] ?? '#e879f9'

const TERMINAL_COMMANDS = [
  { what: 'Apagar notifications (resiliencia)', cmd: 'npm run kill-notifications', alt: 'make kill-notifications' },
  { what: 'Volver a prender notifications', cmd: 'npm run revive-notifications', alt: 'make revive-notifications' },
  { what: 'Sumar analytics en vivo (reprocesa la historia)', cmd: 'npm run add-analytics', alt: 'make add-analytics' },
  { what: 'Escalar payments a 2 réplicas', cmd: 'npm run scale-payments', alt: 'make scale-payments' }
]

const STATUS_LABEL = { PENDING: 'PENDIENTE', CONFIRMED: 'CONFIRMADO', CANCELLED: 'CANCELADO' }

const $ = (sel) => document.querySelector(sel)
const pesos = (n) => `$${Number(n ?? 0).toLocaleString('es-AR')}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

// ---------------------------------------------------------------------------
// Estado del cliente
// ---------------------------------------------------------------------------

const state = {
  orders: new Map(),
  timeline: [],
  metrics: null,
  everAlive: new Set(),
  arrivals: new Map(), // eventId -> promesa que resuelve cuando la bolita llegó al broker
  ordersApi: `${location.protocol}//${location.hostname}:3000`
}

// ---------------------------------------------------------------------------
// Diagrama
// ---------------------------------------------------------------------------

function svg(tag, attrs = {}, parent) {
  const el = document.createElementNS(SVG_NS, tag)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  if (parent) parent.appendChild(el)
  return el
}

function drawDiagram() {
  const edges = $('#edges')
  const nodes = $('#nodes')

  for (const [name, n] of Object.entries(NODES)) {
    svg('line', { x1: n.x, y1: n.y, x2: BROKER.x, y2: BROKER.y, class: `edge ${name === 'dlq' ? 'dlq-edge' : ''}`, id: `edge-${name}` }, edges)
  }

  // broker
  const b = svg('g', { class: 'broker', id: 'node-broker', transform: `translate(${BROKER.x} ${BROKER.y})` }, nodes)
  svg('rect', { x: -150, y: -58, width: 300, height: 116, rx: 18 }, b)
  svg('text', { class: 'name', 'text-anchor': 'middle', y: -10 }, b).textContent = 'Redis Streams'
  svg('text', { class: 'sub', 'text-anchor': 'middle', y: 22 }, b).textContent = 'mateshop.events'
  svg('text', { class: 'sub', 'text-anchor': 'middle', y: 44, id: 'broker-count' }, b).textContent = '0 eventos'

  for (const [name, n] of Object.entries(NODES)) {
    const color = serviceColor(name)
    const g = svg('g', { class: `node ${n.observer ? 'observer' : ''}`, id: `node-${name}`, transform: `translate(${n.x} ${n.y})` }, nodes)
    svg('rect', { x: -100, y: -40, width: 200, height: 80, rx: 14, stroke: color }, g)
    svg('text', { class: 'name', 'text-anchor': 'middle', y: -4 }, g).textContent = n.label ?? name
    svg('text', { class: 'sub', 'text-anchor': 'middle', y: 22 }, g).textContent = n.sub
    if (name !== 'dlq') {
      svg('circle', { class: 'status', cx: 84, cy: -24, r: 8, fill: css('--muted'), id: `status-${name}` }, g)
      svg('text', { class: 'badge', x: -86, y: -18, fill: color, id: `badge-${name}` }, g)
      svg('text', { class: 'down-label', 'text-anchor': 'middle', y: 62, id: `down-${name}` }, g).textContent = 'CAÍDO'
    } else {
      svg('text', { class: 'badge', x: -86, y: -18, fill: color, id: 'badge-dlq' }, g)
    }
  }

  $('#legend').innerHTML = Object.entries(TYPE_COLORS)
    .map(([type, color]) => `<span><i style="background:${color}"></i>${type}</span>`)
    .join('')
}

const pointOf = (name) => (name === 'broker' ? BROKER : NODES[name] ?? NODES.dashboard)

function pulse(name) {
  const el = document.getElementById(`node-${name}`)
  if (!el) return
  el.classList.remove('pulse')
  void el.getBoundingClientRect()
  el.classList.add('pulse')
}

function heat(edge) {
  const el = document.getElementById(`edge-${edge}`)
  if (!el) return
  el.classList.add('hot')
  setTimeout(() => el.classList.remove('hot'), 450)
}

/** Mueve una bolita de un nodo a otro. */
function travel(from, to, color, ms = 650) {
  const a = pointOf(from)
  const b = pointOf(to)
  const dot = svg('circle', { r: 11, fill: color, filter: 'url(#glow)', cx: a.x, cy: a.y }, $('#dots'))
  return new Promise((resolve) => {
    const start = performance.now()
    const step = (now) => {
      const t = Math.min(1, (now - start) / ms)
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
      dot.setAttribute('cx', a.x + (b.x - a.x) * e)
      dot.setAttribute('cy', a.y + (b.y - a.y) * e)
      if (t < 1) requestAnimationFrame(step)
      else {
        dot.remove()
        resolve()
      }
    }
    requestAnimationFrame(step)
  })
}

/** Texto flotante sobre un nodo (ej. "duplicado ignorado"). */
function floatLabel(name, text, color) {
  const p = pointOf(name)
  const label = svg('text', { class: 'float-label', x: p.x, y: p.y - 52, 'text-anchor': 'middle', fill: color }, $('#labels'))
  label.textContent = text
  label.animate(
    [
      { transform: 'translateY(0)', opacity: 1 },
      { transform: 'translateY(-26px)', opacity: 1, offset: 0.7 },
      { transform: 'translateY(-34px)', opacity: 0 }
    ],
    { duration: 2600, easing: 'ease-out' }
  ).onfinish = () => label.remove()
}

// ---------------------------------------------------------------------------
// Filtro por pedido (?order=<id>): lo usa el enlace "Ver qué pasó por dentro" de la tienda
// ---------------------------------------------------------------------------

const ORDER_FILTER = new URLSearchParams(location.search).get('order')
const matchesFilter = (entry) =>
  !ORDER_FILTER || entry.event?.data?.orderId === ORDER_FILTER || entry.event?.correlationid === `order-${ORDER_FILTER}`
const telemetryMatches = (t) => !ORDER_FILTER || t.correlationid === `order-${ORDER_FILTER}`

function setupFilterBanner() {
  if (!ORDER_FILTER) return
  const banner = $('#filter-banner')
  banner.hidden = false
  banner.innerHTML = `🔎 Mostrando solo los eventos del pedido <b>#${escapeHtml(ORDER_FILTER)}</b> · <a href="/">quitar filtro</a>`
  document.title = `Pedido #${ORDER_FILTER} · MateShop en vivo`
}

/** Animación de publicación: productor -> broker. */
function animatePublish(entry) {
  const color = entry.valid ? typeColor(entry.event.type) : css('--danger')
  const from = NODES[entry.producer] ? entry.producer : 'dashboard'
  pulse(from)
  heat(from)
  const arrived = travel(from, 'broker', color).then(() => pulse('broker'))
  if (entry.event?.id) {
    state.arrivals.set(entry.event.id, arrived)
    setTimeout(() => state.arrivals.delete(entry.event.id), 15000)
  }
}

/** Animación de consumo: broker -> servicio (según la telemetría real del bus). */
async function animateTelemetry(t) {
  const arrival = state.arrivals.get(t.eventId)
  if (arrival) await Promise.race([arrival, sleep(1500)])
  const target = NODES[t.service] ? t.service : 'dashboard'

  if (t.kind === 'processed') {
    heat(target)
    await travel('broker', target, typeColor(t.type), 550)
    pulse(target)
  } else if (t.kind === 'duplicate') {
    heat(target)
    await travel('broker', target, '#cbd5e1', 550)
    floatLabel(target, '⚠ duplicado ignorado', css('--warn'))
  } else if (t.kind === 'retry') {
    await travel('broker', target, css('--warn'), 550)
    floatLabel(target, `✖ falló · entrega ${t.deliveries}/3`, css('--warn'))
  } else if (t.kind === 'dlq') {
    heat('dlq')
    await travel('broker', 'dlq', css('--danger'), 650)
    pulse('dlq')
    floatLabel('dlq', `☠ ${t.group}`, css('--danger'))
  }
}

// ---------------------------------------------------------------------------
// Línea de tiempo
// ---------------------------------------------------------------------------

const timeOf = (iso) => {
  const d = iso ? new Date(iso) : new Date()
  if (Number.isNaN(d.getTime())) return '--:--:--'
  return d.toLocaleTimeString('es-AR', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0')
}

function timelineRow(entry, isNew) {
  const li = document.createElement('li')
  const e = entry.event ?? {}
  const color = entry.valid ? typeColor(e.type) : css('--danger')
  li.style.setProperty('--type-color', color)
  if (isNew) li.classList.add('new')
  const orderId = e.data?.orderId ? `#${escapeHtml(e.data.orderId)}` : ''
  const tags = [
    !entry.valid ? '<span class="tag danger">inválido</span>' : '',
    entry.duplicate ? '<span class="tag warn">reenvío</span>' : ''
  ].join('')
  li.innerHTML = `
    <span class="time">${timeOf(e.time)}</span>
    <span>
      <span class="type">${escapeHtml(e.type ?? '(sin tipo)')}</span>${tags}
      <div class="meta">publicó <b style="color:${serviceColor(entry.producer)}">${escapeHtml(entry.producer)}</b></div>
    </span>
    <span class="order-id">${orderId}</span>`
  li.addEventListener('click', () => openModal(entry))
  return li
}

function systemRow(t) {
  const li = document.createElement('li')
  li.className = 'sys new'
  const color = t.kind === 'dlq' ? css('--danger') : css('--warn')
  li.style.setProperty('--sys-color', color)
  const what =
    t.kind === 'dlq'
      ? `☠ ${escapeHtml(t.group)} mandó ${escapeHtml(t.type ?? 'un evento')} a la DLQ: ${escapeHtml(t.error)}`
      : `⚠ duplicado ignorado por ${escapeHtml(t.group)} · ${escapeHtml(t.type)}`
  li.innerHTML = `<span class="time">${timeOf(t.time)}</span><span class="msg">${what}</span>`
  return li
}

function prependTimeline(node) {
  const list = $('#timeline')
  list.prepend(node)
  while (list.children.length > 150) list.lastElementChild.remove()
}

function renderTimeline() {
  const list = $('#timeline')
  list.replaceChildren(...state.timeline.filter(matchesFilter).slice(0, 150).map((e) => timelineRow(e, false)))
}

// ---------------------------------------------------------------------------
// Pedidos, servicios y contadores
// ---------------------------------------------------------------------------

function renderOrders(flashId) {
  const orders = [...state.orders.values()]
    .filter((o) => !ORDER_FILTER || o.orderId === ORDER_FILTER)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
  $('#orders-empty').hidden = orders.length > 0
  $('#orders').innerHTML = orders
    .slice(0, 60)
    .map(
      (o) => `
      <tr class="${o.orderId === flashId ? 'flash' : ''}">
        <td class="mono">#${escapeHtml(o.orderId)}</td>
        <td>${escapeHtml(o.customer)}</td>
        <td>${(o.items ?? []).map((i) => `${i.qty}× ${escapeHtml(i.sku)}`).join(', ')}</td>
        <td class="num">${pesos(o.total)}</td>
        <td><span class="status ${o.status}">${STATUS_LABEL[o.status] ?? o.status}</span></td>
        <td class="detail">${escapeHtml(o.reason || o.lastStep)}</td>
      </tr>`
    )
    .join('')
}

function setCounter(id, value) {
  const el = document.getElementById(id)
  if (el.textContent !== String(value)) {
    el.textContent = value
    el.parentElement.classList.remove('bump')
    void el.offsetWidth
    el.parentElement.classList.add('bump')
  }
}

function renderMetrics(m) {
  if (!m) return
  state.metrics = m
  setCounter('m-total', m.total)
  setCounter('m-pending', m.groups.reduce((acc, g) => acc + g.pending + (g.lag ?? 0), 0))
  setCounter('m-duplicates', m.duplicates)
  setCounter('m-dlq', m.dlq)
  $('#broker-count').textContent = `${m.total} eventos`
  $('#badge-dlq').textContent = m.dlq ? String(m.dlq) : ''

  const list = []
  for (const [name, info] of Object.entries(m.services)) {
    const alive = info.instances > 0
    if (alive) state.everAlive.add(name)
    const label = alive
      ? info.instances > 1 ? `vivo · ${info.instances} réplicas` : 'vivo'
      : state.everAlive.has(name) ? 'caído' : name === 'analytics' ? 'sin levantar' : 'caído'

    const node = document.getElementById(`node-${name}`)
    node?.classList.toggle('down', !alive)
    const down = document.getElementById(`down-${name}`)
    if (down) down.textContent = label === 'sin levantar' ? 'SIN LEVANTAR' : 'CAÍDO'
    const status = document.getElementById(`status-${name}`)
    status?.setAttribute('fill', alive ? css('--ok') : css('--danger'))
    const badge = document.getElementById(`badge-${name}`)
    if (badge) badge.textContent = info.instances > 1 ? `×${info.instances}` : ''

    list.push(
      `<li class="${alive ? 'alive' : ''}" style="--svc-color:${serviceColor(name)}"><span class="dot"></span><span class="svc">${name}</span><span class="state">${label}</span></li>`
    )
  }
  $('#services').innerHTML = list.join('')

  $('#groups').innerHTML =
    m.groups
      .map(
        (g) =>
          `<tr><td>${escapeHtml(g.name)}</td><td class="num ${g.pending ? 'hot' : ''}">${g.pending}</td><td class="num ${g.lag ? 'hot' : ''}">${g.lag ?? '–'}</td></tr>`
      )
      .join('') || '<tr><td colspan="3" class="detail">sin grupos todavía</td></tr>'
}

// ---------------------------------------------------------------------------
// Modal JSON
// ---------------------------------------------------------------------------

function highlightJson(obj) {
  return escapeHtml(JSON.stringify(obj, null, 2)).replace(
    /(&quot;[^&]*?&quot;)(\s*:)?|(-?\d+(?:\.\d+)?)/g,
    (match, str, colon, num) => {
      if (str) return colon ? `<span class="json-key">${str}</span>${colon}` : `<span class="json-str">${str}</span>`
      return `<span class="json-num">${num}</span>`
    }
  )
}

function openModal(entry) {
  $('#modal-title').textContent = `${entry.event?.type ?? 'Evento'} · ${entry.streamId}`
  const extra = entry.valid ? '' : `\n\n// inválido: ${entry.error}`
  $('#modal-json').innerHTML = highlightJson(entry.event) + escapeHtml(extra)
  $('#modal').showModal()
}

// ---------------------------------------------------------------------------
// Escenas
// ---------------------------------------------------------------------------

function toast(text, kind = '') {
  const el = document.createElement('div')
  el.className = `toast ${kind}`
  el.textContent = text
  $('#toasts').appendChild(el)
  setTimeout(() => el.remove(), 4500)
}

async function postOrder(kind) {
  const body = buildOrder(kind)
  const res = await fetch(`${state.ordersApi}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
  return { ...json, body, status: res.status }
}

const SCENES = {
  async normal() {
    const r = await postOrder('normal')
    toast(`🛒 Pedido #${r.orderId} de ${r.body.customer} → ${r.status} Accepted`, 'ok')
  },
  async rechazado() {
    const r = await postOrder('rechazado')
    toast(`💸 Pedido #${r.orderId} por ${pesos(r.total)} (límite $100.000)`, 'warn')
  },
  async 'sin-stock'() {
    const r = await postOrder('sin-stock')
    toast(`📦 Pedido #${r.orderId} de TERMO-04 (stock 0): mirá la compensación`, 'warn')
  },
  async rafaga() {
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) => sleep(i * 120).then(() => postOrder('rafaga')))
    )
    const ok = results.filter((r) => r.status === 'fulfilled').length
    toast(`⚡ Ráfaga: ${ok}/10 pedidos aceptados`, ok === 10 ? 'ok' : 'warn')
  },
  duplicate: () => serverScene('duplicate', 'warn'),
  poison: () => serverScene('poison', 'danger'),
  reset: () => serverScene('reset', '')
}

async function serverScene(name, kind) {
  const res = await fetch(`/api/scenes/${name}`, { method: 'POST' })
  const json = await res.json()
  toast(json.mensaje, res.ok ? kind : 'danger')
}

async function runScene(name, button) {
  if (button) button.disabled = true
  try {
    await SCENES[name]()
  } catch (err) {
    toast(`No se pudo ejecutar la escena: ${err.message}. ¿Está levantado orders en ${state.ordersApi}?`, 'danger')
  } finally {
    if (button) button.disabled = false
  }
}

function setupScenes() {
  const buttons = [...document.querySelectorAll('[data-scene]')]
  for (const b of buttons) b.addEventListener('click', () => runScene(b.dataset.scene, b))
  document.addEventListener('keydown', (ev) => {
    if (ev.target instanceof HTMLInputElement || $('#modal').open || ev.ctrlKey || ev.metaKey || ev.altKey) return
    const button = buttons[Number(ev.key) - 1]
    if (button) runScene(button.dataset.scene, button)
  })

  $('#terminal-commands').innerHTML = TERMINAL_COMMANDS.map(
    (c) => `<li><span><span class="what">${c.what}</span><code>${c.cmd}</code></span><button data-copy="${c.cmd}">copiar</button></li>`
  ).join('')
  $('#terminal-commands').addEventListener('click', async (ev) => {
    const cmd = ev.target?.dataset?.copy
    if (!cmd) return
    try {
      await navigator.clipboard.writeText(cmd)
      ev.target.textContent = '¡copiado!'
    } catch {
      ev.target.textContent = 'copialo a mano'
    }
    setTimeout(() => (ev.target.textContent = 'copiar'), 1500)
  })

  $('#modal-close').addEventListener('click', () => $('#modal').close())
  $('#modal').addEventListener('click', (ev) => {
    if (ev.target === $('#modal')) $('#modal').close()
  })
}

// ---------------------------------------------------------------------------
// Conexión en vivo
// ---------------------------------------------------------------------------

function applySnapshot(snap) {
  state.timeline = snap.timeline ?? []
  state.orders = new Map((snap.orders ?? []).map((o) => [o.orderId, o]))
  renderTimeline()
  renderOrders()
  renderMetrics(snap.metrics)
}

function connect() {
  const socket = io()
  const conn = $('#conn')
  socket.on('connect', () => {
    conn.className = 'conn ok'
    $('#conn-text').textContent = 'en vivo'
  })
  socket.on('disconnect', () => {
    conn.className = 'conn off'
    $('#conn-text').textContent = 'reconectando…'
  })

  socket.on('snapshot', applySnapshot)

  socket.on('event', ({ entry, order }) => {
    if (entry.event?.type === 'demo.reset') {
      state.orders.clear()
      state.timeline = []
      renderOrders()
      renderTimeline()
    }
    state.timeline.unshift(entry)
    if (state.timeline.length > 200) state.timeline.length = 200
    if (order) {
      state.orders.set(order.orderId, order)
      renderOrders(order.orderId)
    }
    if (!matchesFilter(entry)) return
    prependTimeline(timelineRow(entry, true))
    animatePublish(entry)
  })

  socket.on('telemetry', (t) => {
    if (!telemetryMatches(t)) return
    animateTelemetry(t)
    if (t.kind === 'duplicate' || t.kind === 'dlq') prependTimeline(systemRow(t))
    if (t.kind === 'duplicate') toast(`⚠ ${t.group}: duplicado ignorado (${t.type})`, 'warn')
    if (t.kind === 'dlq') toast(`☠ ${t.group} movió un evento a la DLQ`, 'danger')
  })

  socket.on('metrics', renderMetrics)
}

async function loadConfig() {
  try {
    const cfg = await (await fetch('/api/config')).json()
    if (cfg.ordersApiUrl && !/localhost|127\.0\.0\.1/.test(cfg.ordersApiUrl)) state.ordersApi = cfg.ordersApiUrl
  } catch {
    /* se usa el host actual en el puerto 3000 */
  }
}

drawDiagram()
setupFilterBanner()
setupScenes()
await loadConfig()
connect()
