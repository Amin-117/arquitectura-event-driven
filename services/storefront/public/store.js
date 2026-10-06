import {
  $, urls, pesos, escapeHtml, timeOf, dateOf, STATUS_LABEL, getJson, postJson, storage, toast, connectSocket
} from './common.js'

// ---------------------------------------------------------------------------
// Estado del navegador
// ---------------------------------------------------------------------------

const KEYS = { cart: 'mateshop.cart', email: 'mateshop.email', profile: 'mateshop.profile', seen: 'mateshop.inbox.seen' }

const CATEGORY_LABELS = { mates: 'Mates', bombillas: 'Bombillas', yerbas: 'Yerbas', termos: 'Termos', accesorios: 'Accesorios' }

const STEPS = [
  { key: 'received', title: 'Pedido recibido', sub: 'Registramos tu pedido' },
  { key: 'paid', title: 'Pago aprobado', sub: 'El banco aprobó el pago' },
  { key: 'reserved', title: 'Stock reservado', sub: 'Separamos tus productos' },
  { key: 'confirmed', title: 'Pedido confirmado', sub: '¡Listo para el envío!' }
]

const state = {
  catalog: [],
  bySku: new Map(),
  cart: storage.get(KEYS.cart, []),
  email: storage.get(KEYS.email, ''),
  inbox: [],
  category: 'todas',
  query: '',
  detailQty: 1,
  route: { name: 'catalog' },
  tracking: null, // pedido que se está siguiendo
  pollTimer: null
}

const view = $('#view')

// ---------------------------------------------------------------------------
// Catálogo y stock
// ---------------------------------------------------------------------------

async function loadCatalog() {
  state.catalog = await getJson('/api/catalog')
  state.bySku = new Map(state.catalog.map((p) => [p.sku, p]))
}

const product = (sku) => state.bySku.get(sku)
const available = (sku) => product(sku)?.available ?? 0
const inCart = (sku) => state.cart.find((i) => i.sku === sku)?.qty ?? 0
const canAdd = (sku) => available(sku) - inCart(sku)

function stockBadge(p) {
  if (p.available === null) return '<span class="stock low">Consultando stock…</span>'
  if (p.available === 0) return '<span class="stock out">Sin stock</span>'
  if (p.available <= 3) return `<span class="stock low">¡Últimas ${p.available}!</span>`
  return `<span class="stock ok">${p.available} disponibles</span>`
}

function addButtonLabel(p) {
  if (!p.available) return 'Sin stock'
  if (canAdd(p.sku) <= 0) return 'Ya está en tu carrito'
  return 'Agregar'
}

// ---------------------------------------------------------------------------
// Carrito (se guarda en localStorage)
// ---------------------------------------------------------------------------

function saveCart() {
  storage.set(KEYS.cart, state.cart)
  const count = state.cart.reduce((n, i) => n + i.qty, 0)
  const badge = $('#cart-badge')
  badge.hidden = count === 0
  if (badge.textContent !== String(count)) {
    badge.textContent = count
    badge.classList.remove('pop')
    void badge.offsetWidth
    badge.classList.add('pop')
  }
}

const cartTotal = () => state.cart.reduce((sum, i) => sum + (product(i.sku)?.price ?? 0) * i.qty, 0)

function addToCart(sku, qty = 1) {
  const p = product(sku)
  if (!p || canAdd(sku) < qty) {
    toast('No hay stock suficiente', p ? `Quedan ${p.available} de ${p.name}` : '', 'bad')
    return
  }
  const line = state.cart.find((i) => i.sku === sku)
  if (line) line.qty += qty
  else state.cart.push({ sku, qty })
  saveCart()
  renderRoute()
  openCart()
}

function setCartQty(sku, qty) {
  state.cart = state.cart.map((i) => (i.sku === sku ? { ...i, qty } : i)).filter((i) => i.qty > 0)
  saveCart()
  renderCart()
  if (state.route.name === 'catalog' || state.route.name === 'product') renderRoute()
}

function openCart() {
  renderCart()
  $('#cart').classList.add('open')
  $('#cart').setAttribute('aria-hidden', 'false')
  $('#overlay').hidden = false
}

function closeCart() {
  $('#cart').classList.remove('open')
  $('#cart').setAttribute('aria-hidden', 'true')
  $('#overlay').hidden = true
}

function renderCart() {
  const body = $('#cart-body')
  const foot = $('#cart-foot')
  if (state.cart.length === 0) {
    body.innerHTML = '<div class="empty-state"><div class="big">🧉</div><p>Tu carrito está vacío.</p></div>'
    foot.innerHTML = '<button class="btn secondary block" data-close-cart>Seguir comprando</button>'
    return
  }
  body.innerHTML = state.cart
    .map((i) => {
      const p = product(i.sku)
      if (!p) return ''
      const over = p.available !== null && i.qty > p.available
      return `
      <div class="line-item">
        <img src="${p.image}" alt="" />
        <div>
          <div class="name">${escapeHtml(p.name)}</div>
          <div class="unit">${pesos(p.price)} c/u</div>
          <div class="qty" style="margin-top:6px">
            <button data-dec="${p.sku}" aria-label="Quitar uno">−</button>
            <output>${i.qty}</output>
            <button data-inc="${p.sku}" aria-label="Agregar uno" ${i.qty >= p.available ? 'disabled' : ''}>+</button>
          </div>
        </div>
        <div class="right">
          <strong>${pesos(p.price * i.qty)}</strong>
          <button class="link-btn" data-remove="${p.sku}">Quitar</button>
        </div>
        ${over ? `<div class="warn">Solo quedan ${p.available} en stock. Lo confirmamos al procesar el pago.</div>` : ''}
      </div>`
    })
    .join('')
  foot.innerHTML = `
    <div class="totals">
      <div><span>Subtotal</span><span>${pesos(cartTotal())}</span></div>
      <div><span>Envío</span><span class="free">Gratis</span></div>
      <div class="grand"><span>Total</span><span>${pesos(cartTotal())}</span></div>
    </div>
    <a href="#/checkout" class="btn accent block" data-close-cart>Ir a pagar</a>`
}

// ---------------------------------------------------------------------------
// Vistas
// ---------------------------------------------------------------------------

function productCard(p) {
  const disabled = !p.available || canAdd(p.sku) <= 0
  return `
  <article class="card ${p.available === 0 ? 'out' : ''}" data-sku="${p.sku}">
    <a class="media" href="#/producto/${p.sku}"><img src="${p.image}" alt="${escapeHtml(p.name)}" loading="lazy" /></a>
    <div class="card-body">
      <span class="category">${escapeHtml(p.categoryLabel)}</span>
      <h3><a href="#/producto/${p.sku}">${escapeHtml(p.name)}</a></h3>
      <span class="price">${pesos(p.price)}</span>
      <div class="row">
        ${stockBadge(p)}
        <button class="btn" data-add="${p.sku}" ${disabled ? 'disabled' : ''}>${addButtonLabel(p)}</button>
      </div>
    </div>
  </article>`
}

function filteredCatalog() {
  const q = state.query.trim().toLowerCase()
  return state.catalog.filter(
    (p) =>
      (state.category === 'todas' || p.category === state.category) &&
      (!q || `${p.name} ${p.description} ${p.categoryLabel}`.toLowerCase().includes(q))
  )
}

function renderCatalog() {
  const items = filteredCatalog()
  view.innerHTML = `
    <section class="hero">
      <div>
        <h1>Todo para tu mate</h1>
        <p>Mates, bombillas, yerbas y accesorios elegidos con cariño.</p>
      </div>
      <div class="perks"><span class="perk">🚚 Envío gratis</span><span class="perk">🔒 Pago protegido</span><span class="perk">⚡ Stock en vivo</span></div>
    </section>
    <div class="chips" role="group" aria-label="Categorías">
      ${[['todas', 'Todas'], ...Object.entries(CATEGORY_LABELS)]
        .map(([key, label]) => `<button class="chip" data-category="${key}" aria-pressed="${state.category === key}">${label}</button>`)
        .join('')}
    </div>
    ${state.query ? `<p class="results-info">${items.length} resultado(s) para “${escapeHtml(state.query)}”</p>` : ''}
    ${
      items.length
        ? `<div class="grid">${items.map(productCard).join('')}</div>`
        : '<div class="empty-state"><div class="big">🔍</div><p>No encontramos productos con esa búsqueda.</p></div>'
    }`
}

function renderProduct(sku) {
  const p = product(sku)
  if (!p) return renderNotFound('Ese producto no existe.')
  const max = Math.max(0, canAdd(sku))
  state.detailQty = Math.min(Math.max(1, state.detailQty), Math.max(1, max))
  view.innerHTML = `
    <nav class="breadcrumb"><a href="#/">Inicio</a> › ${escapeHtml(p.categoryLabel)} › ${escapeHtml(p.name)}</nav>
    <section class="detail" data-sku="${p.sku}">
      <div class="media"><img src="${p.image}" alt="${escapeHtml(p.name)}" /></div>
      <div class="info">
        <span class="muted">${escapeHtml(p.categoryLabel)} · ${p.sku}</span>
        <h1>${escapeHtml(p.name)}</h1>
        <div class="price">${pesos(p.price)}</div>
        <p class="desc">${escapeHtml(p.description)}</p>
        <div>${stockBadge(p)}</div>
        <div class="buy-row">
          <div class="qty" aria-label="Cantidad">
            <button data-qty="-1" ${state.detailQty <= 1 || max === 0 ? 'disabled' : ''} aria-label="Menos">−</button>
            <output id="detail-qty">${max === 0 ? 0 : state.detailQty}</output>
            <button data-qty="1" ${state.detailQty >= max ? 'disabled' : ''} aria-label="Más">+</button>
          </div>
          <button class="btn accent" id="detail-add" ${max === 0 ? 'disabled' : ''}>
            ${p.available === 0 ? 'Sin stock' : max === 0 ? 'Ya tenés todo el stock en el carrito' : 'Agregar al carrito'}
          </button>
        </div>
        ${inCart(sku) ? `<p class="note">Tenés ${inCart(sku)} en el carrito.</p>` : ''}
        <p class="note">🚚 Envío gratis a todo el país · El stock se actualiza en vivo.</p>
      </div>
    </section>`
}

function renderCheckout() {
  if (state.cart.length === 0) {
    view.innerHTML = `<div class="empty-state"><div class="big">🛒</div><p>No hay nada para pagar todavía.</p><a class="btn" href="#/">Ver productos</a></div>`
    return
  }
  const profile = storage.get(KEYS.profile, {})
  view.innerHTML = `
    <h1>Finalizar compra</h1>
    <div class="checkout" style="margin-top:18px">
      <form class="panel" id="checkout-form" novalidate>
        <div class="test-banner">⚠️ <strong>Pago de prueba, no ingreses datos reales.</strong> Usá <code>4111 1111 1111 1111</code> para aprobar, o una tarjeta terminada en <code>0000</code> para ver un rechazo.</div>
        <div id="form-error"></div>
        <fieldset>
          <legend>Tus datos</legend>
          ${field('name', 'Nombre y apellido', 'text', profile.name ?? '', 'autocomplete="name"')}
          ${field('email', 'Email', 'email', state.email, 'autocomplete="email"')}
          ${field('address', 'Dirección de envío', 'text', profile.address ?? '', 'autocomplete="street-address"')}
        </fieldset>
        <fieldset>
          <legend>Tarjeta (simulada)</legend>
          ${field('card', 'Número de tarjeta', 'text', '', 'inputmode="numeric" autocomplete="off" placeholder="4111 1111 1111 1111" maxlength="23"')}
          <div class="two">
            ${field('exp', 'Vencimiento', 'text', '', 'inputmode="numeric" autocomplete="off" placeholder="MM/AA" maxlength="5"')}
            ${field('cvv', 'CVV', 'text', '', 'inputmode="numeric" autocomplete="off" placeholder="123" maxlength="4"')}
          </div>
        </fieldset>
        <button class="btn accent block" type="submit" id="pay-btn">Pagar ${pesos(cartTotal())}</button>
      </form>
      <aside class="panel">
        <h2>Resumen</h2>
        ${state.cart
          .map((i) => `<div class="summary-item"><span>${i.qty} × ${escapeHtml(product(i.sku)?.name ?? i.sku)}</span><span>${pesos((product(i.sku)?.price ?? 0) * i.qty)}</span></div>`)
          .join('')}
        <div class="totals" style="margin-top:10px">
          <div><span>Envío</span><span class="free">Gratis</span></div>
          <div class="grand"><span>Total</span><span>${pesos(cartTotal())}</span></div>
        </div>
        <p class="note">El total final lo calcula nuestro sistema con los precios vigentes.</p>
      </aside>
    </div>`
}

function field(name, label, type, value, extra = '') {
  return `
    <div class="field" data-field="${name}">
      <label for="f-${name}">${label} <span class="req">*</span></label>
      <input id="f-${name}" name="${name}" type="${type}" value="${escapeHtml(value)}" ${extra} />
      <span class="error" id="e-${name}"></span>
    </div>`
}

const VALIDATORS = {
  name: (v) => (v.trim().length >= 2 ? '' : 'Ingresá tu nombre'),
  email: (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? '' : 'Ingresá un email válido'),
  address: (v) => (v.trim().length >= 5 ? '' : 'Ingresá una dirección de envío'),
  card: (v) => (/^\d{13,19}$/.test(v.replace(/\s/g, '')) ? '' : 'El número debe tener entre 13 y 19 dígitos'),
  exp: (v) => {
    const m = /^(0[1-9]|1[0-2])\/(\d{2})$/.exec(v)
    if (!m) return 'Usá el formato MM/AA'
    const end = new Date(2000 + Number(m[2]), Number(m[1]), 1)
    return end > new Date() ? '' : 'La tarjeta está vencida'
  },
  cvv: (v) => (/^\d{3,4}$/.test(v) ? '' : 'Ingresá 3 o 4 dígitos')
}

function validateField(form, name) {
  const msg = VALIDATORS[name](form.elements[name].value)
  form.querySelector(`[data-field="${name}"]`).classList.toggle('invalid', Boolean(msg))
  $(`#e-${name}`).textContent = msg
  return !msg
}

async function submitCheckout(form) {
  const valid = Object.keys(VALIDATORS).map((n) => validateField(form, n)).every(Boolean)
  if (!valid) {
    form.querySelector('.invalid input')?.focus()
    return
  }
  const data = Object.fromEntries(new FormData(form))
  const button = $('#pay-btn')
  button.disabled = true
  button.textContent = 'Procesando…'
  try {
    const { ok, json } = await postJson(`${urls.orders}/orders`, {
      customer: data.name.trim(),
      email: data.email.trim(),
      address: data.address.trim(),
      cardNumber: data.card.replace(/\s/g, ''),
      items: state.cart.map(({ sku, qty }) => ({ sku, qty }))
    })
    if (!ok) {
      $('#form-error').innerHTML = `<div class="form-error">No pudimos crear el pedido: ${escapeHtml((json.detalles ?? [json.error]).join('; '))}</div>`
      button.disabled = false
      button.textContent = `Pagar ${pesos(cartTotal())}`
      return
    }
    // 202 Accepted: el pedido quedó registrado; el resultado llega después, por eventos.
    state.email = data.email.trim()
    storage.set(KEYS.email, state.email)
    storage.set(KEYS.profile, { name: data.name.trim(), address: data.address.trim() })
    state.cart = []
    saveCart()
    loadInbox()
    location.hash = `#/pedido/${json.orderId}`
  } catch {
    $('#form-error').innerHTML = '<div class="form-error">No pudimos contactar al servicio de pedidos. Probá de nuevo en unos segundos.</div>'
    button.disabled = false
    button.textContent = `Pagar ${pesos(cartTotal())}`
  }
}

function stepState(order, step, index) {
  if (order.steps?.[step.key]) return 'done'
  if (order.failedStep === step.key) return 'failed'
  if (order.status !== 'PENDING') return 'todo'
  const firstOpen = STEPS.findIndex((s) => !order.steps?.[s.key])
  return firstOpen === index && !order.failedStep ? 'current' : 'todo'
}

function renderTracking(orderId) {
  const order = state.tracking?.orderId === orderId ? state.tracking : null
  const insideLink = `<a class="inside-link" href="${urls.dashboard}/?order=${encodeURIComponent(orderId)}" target="_blank" rel="noopener">🔍 Ver qué pasó por dentro ↗</a>`

  if (!order) {
    view.innerHTML = `
      <h1>Pedido #${escapeHtml(orderId)}</h1>
      <div class="status-banner PENDING"><span class="icon">⏳</span><span>Recibimos tu pedido. Lo estamos registrando…</span></div>
      ${insideLink}`
    return
  }

  const banner = {
    PENDING: ['⏳', 'Estamos procesando tu pedido…'],
    CONFIRMED: ['✅', '¡Tu pedido está confirmado! Pronto sale para tu casa.'],
    CANCELLED: ['✖', order.reason || 'Tu pedido fue cancelado.']
  }[order.status]

  view.innerHTML = `
    <nav class="breadcrumb"><a href="#/mis-pedidos">Mis pedidos</a> › #${escapeHtml(order.orderId)}</nav>
    <h1>Pedido #${escapeHtml(order.orderId)}</h1>
    <div class="status-banner ${order.status}"><span class="icon">${banner[0]}</span><span>${escapeHtml(banner[1])}</span></div>
    <div class="tracking">
      <section class="panel">
        <h2>Seguimiento</h2>
        <ol class="steps" style="margin-top:16px">
          ${STEPS.map((s, i) => {
            const st = stepState(order, s, i)
            const icon = st === 'done' ? '✓' : st === 'failed' ? '✕' : i + 1
            const sub =
              st === 'done' ? `${s.sub} · ${timeOf(order.steps[s.key])}`
              : st === 'failed' ? escapeHtml(order.reason)
              : st === 'current' ? 'En curso…'
              : 'Pendiente'
            return `<li class="${st}"><span class="dot">${icon}</span><div><div class="title">${s.title}</div><div class="sub">${sub}</div></div></li>`
          }).join('')}
        </ol>
        ${order.refunded ? `<p class="note" style="margin-top:16px">💸 Reintegramos ${pesos(order.total)} a tu tarjeta.</p>` : ''}
        ${insideLink}
      </section>
      <aside class="panel">
        <h2>Detalle</h2>
        ${order.items.map((i) => `<div class="summary-item"><span>${i.qty} × ${escapeHtml(i.name)}</span><span>${pesos((i.price ?? 0) * i.qty)}</span></div>`).join('')}
        <div class="totals" style="margin-top:10px"><div class="grand"><span>Total</span><span>${pesos(order.total)}</span></div></div>
        <p class="note">${escapeHtml(order.customer)}${order.email ? ` · ${escapeHtml(order.email)}` : ''}<br/>Creado: ${dateOf(order.createdAt)}</p>
        <a class="btn secondary block" href="#/">Seguir comprando</a>
      </aside>
    </div>`
}

async function loadTracking(orderId) {
  clearInterval(state.pollTimer)
  state.tracking = null
  renderTracking(orderId)
  let tries = 0
  const fetchOnce = async () => {
    try {
      state.tracking = await getJson(`/api/orders/${encodeURIComponent(orderId)}`)
      clearInterval(state.pollTimer)
      if (state.route.name === 'tracking' && state.route.id === orderId) renderTracking(orderId)
    } catch {
      // El modelo de lectura todavía no vio order.created (consistencia eventual): reintentamos.
      if (++tries > 30) clearInterval(state.pollTimer)
    }
  }
  await fetchOnce()
  if (!state.tracking) state.pollTimer = setInterval(fetchOnce, 1000)
}

async function renderMyOrders() {
  if (!state.email) {
    view.innerHTML = `
      <h1>Mis pedidos</h1>
      <p class="muted">Ingresá el email con el que compraste.</p>
      <form class="email-form" id="email-form">
        <input type="email" name="email" placeholder="tu@email.com" required aria-label="Email" />
        <button class="btn" type="submit">Ver pedidos</button>
      </form>`
    return
  }
  view.innerHTML = `<h1>Mis pedidos</h1><p class="muted">Cargando…</p>`
  let orders = []
  try {
    orders = await getJson(`/api/orders?email=${encodeURIComponent(state.email)}`)
  } catch {
    /* sin pedidos */
  }
  if (state.route.name !== 'orders') return
  view.innerHTML = `
    <h1>Mis pedidos</h1>
    <p class="muted">${escapeHtml(state.email)} · <button class="link-btn" id="change-email">cambiar email</button></p>
    ${
      orders.length
        ? `<div class="orders-list" style="margin-top:16px">${orders
            .map(
              (o) => `
          <a class="order-card" href="#/pedido/${o.orderId}">
            <span><span class="id">#${escapeHtml(o.orderId)}</span> · <span class="muted">${dateOf(o.createdAt)}</span></span>
            <span class="pill ${o.status}">${STATUS_LABEL[o.status]}</span>
            <span class="muted">${o.items.map((i) => `${i.qty} × ${escapeHtml(i.name)}`).join(', ')}</span>
            <strong>${pesos(o.total)}</strong>
          </a>`
            )
            .join('')}</div>`
        : '<div class="empty-state"><div class="big">📦</div><p>Todavía no hiciste pedidos con este email.</p><a class="btn" href="#/">Ir a la tienda</a></div>'
    }`
}

function renderNotFound(msg = 'No encontramos esa página.') {
  view.innerHTML = `<div class="empty-state"><div class="big">🧉</div><p>${escapeHtml(msg)}</p><a class="btn" href="#/">Volver a la tienda</a></div>`
}

// ---------------------------------------------------------------------------
// Bandeja de notificaciones
// ---------------------------------------------------------------------------

async function loadInbox() {
  if (!state.email) {
    state.inbox = []
  } else {
    try {
      state.inbox = await getJson(`/api/notifications?email=${encodeURIComponent(state.email)}`)
    } catch {
      state.inbox = []
    }
  }
  renderInbox()
}

function renderInbox() {
  const seen = storage.get(KEYS.seen, '')
  const unread = state.inbox.filter((n) => n.time > seen).length
  const badge = $('#bell-badge')
  badge.hidden = unread === 0
  badge.textContent = unread
  $('#inbox-email').textContent = state.email || ''
  $('#inbox-list').innerHTML = state.inbox.length
    ? state.inbox
        .map(
          (n) => `<li class="${n.time > seen ? 'unread' : ''}">
            <div class="subject">${escapeHtml(n.asunto)}</div>
            <div class="body">${escapeHtml(n.cuerpo)}</div>
            <div class="meta">Pedido #${escapeHtml(n.orderId)} · ${timeOf(n.time)}</div>
          </li>`
        )
        .join('')
    : `<li class="empty">${state.email ? 'Todavía no recibiste emails.' : 'Cuando hagas una compra, acá vas a ver los emails que te mandamos.'}</li>`
}

function toggleInbox(force) {
  const box = $('#inbox')
  const wasOpen = !box.hidden
  const open = force ?? !wasOpen
  box.hidden = !open
  $('#bell').setAttribute('aria-expanded', String(open))
  // Se marcan como leídas al cerrar la bandeja (mientras está abierta se resaltan las nuevas).
  if (wasOpen && !open && state.inbox[0]) {
    storage.set(KEYS.seen, state.inbox[0].time)
    renderInbox()
  }
}

// ---------------------------------------------------------------------------
// Ruteo
// ---------------------------------------------------------------------------

function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent)
  if (parts[0] === 'producto' && parts[1]) return { name: 'product', id: parts[1] }
  if (parts[0] === 'checkout') return { name: 'checkout' }
  if (parts[0] === 'pedido' && parts[1]) return { name: 'tracking', id: parts[1] }
  if (parts[0] === 'mis-pedidos') return { name: 'orders' }
  if (parts.length === 0) return { name: 'catalog' }
  return { name: 'notfound' }
}

function renderRoute() {
  const r = state.route
  if (r.name === 'catalog') renderCatalog()
  else if (r.name === 'product') renderProduct(r.id)
  else if (r.name === 'checkout') renderCheckout()
  else if (r.name === 'tracking') renderTracking(r.id)
  else if (r.name === 'orders') renderMyOrders()
  else renderNotFound()
}

function onRouteChange() {
  const previous = state.route
  state.route = parseRoute()
  if (state.route.name !== 'tracking') clearInterval(state.pollTimer)
  if (state.route.name === 'product' && previous.id !== state.route.id) state.detailQty = 1
  closeCart()
  if (state.route.name === 'tracking') loadTracking(state.route.id)
  else renderRoute()
  if (previous.name !== state.route.name || previous.id !== state.route.id) window.scrollTo(0, 0)
}

// ---------------------------------------------------------------------------
// Eventos de la interfaz
// ---------------------------------------------------------------------------

function setupUi() {
  document.addEventListener('click', (ev) => {
    const t = ev.target.closest('button, a')
    if (!t) {
      if (!ev.target.closest('.inbox-wrap')) toggleInbox(false)
      return
    }
    if (t.dataset.add) addToCart(t.dataset.add, 1)
    else if (t.dataset.category) {
      state.category = t.dataset.category
      renderCatalog()
    } else if (t.dataset.qty) {
      state.detailQty += Number(t.dataset.qty)
      renderProduct(state.route.id)
    } else if (t.id === 'detail-add') {
      addToCart(state.route.id, state.detailQty)
      state.detailQty = 1
    } else if (t.dataset.inc) setCartQty(t.dataset.inc, inCart(t.dataset.inc) + 1)
    else if (t.dataset.dec) setCartQty(t.dataset.dec, inCart(t.dataset.dec) - 1)
    else if (t.dataset.remove) setCartQty(t.dataset.remove, 0)
    else if (t.id === 'cart-btn') openCart()
    else if (t.id === 'cart-close' || t.dataset.closeCart !== undefined) closeCart()
    else if (t.id === 'bell') toggleInbox()
    else if (t.id === 'change-email') {
      state.email = ''
      storage.set(KEYS.email, '')
      loadInbox()
      renderMyOrders()
    }
    if (!t.closest('.inbox-wrap')) toggleInbox(false)
  })

  $('#overlay').addEventListener('click', closeCart)
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      closeCart()
      toggleInbox(false)
    }
  })

  $('#search').addEventListener('input', (ev) => {
    state.query = ev.target.value
    if (state.route.name !== 'catalog') location.hash = '#/'
    else renderCatalog()
  })

  view.addEventListener('submit', (ev) => {
    ev.preventDefault()
    if (ev.target.id === 'checkout-form') submitCheckout(ev.target)
    if (ev.target.id === 'email-form') {
      state.email = ev.target.elements.email.value.trim()
      storage.set(KEYS.email, state.email)
      loadInbox()
      renderMyOrders()
    }
  })

  view.addEventListener('focusout', (ev) => {
    const form = ev.target.form
    if (form?.id === 'checkout-form' && VALIDATORS[ev.target.name] && ev.target.value) validateField(form, ev.target.name)
  })

  view.addEventListener('input', (ev) => {
    const el = ev.target
    if (el.name === 'card') el.value = el.value.replace(/\D/g, '').slice(0, 19).replace(/(\d{4})(?=\d)/g, '$1 ')
    if (el.name === 'exp') {
      const d = el.value.replace(/\D/g, '').slice(0, 4)
      el.value = d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d
    }
    if (el.name === 'cvv') el.value = el.value.replace(/\D/g, '').slice(0, 4)
  })

  $('#tech-link').href = urls.dashboard
}

// ---------------------------------------------------------------------------
// Tiempo real
// ---------------------------------------------------------------------------

function setupSocket() {
  const socket = connectSocket()

  socket.on('stock', ({ sku, available }) => {
    const p = product(sku)
    if (!p || p.available === available) return
    p.available = available
    if (state.route.name === 'catalog') {
      const card = document.querySelector(`.card[data-sku="${CSS.escape(sku)}"]`)
      if (card) {
        card.outerHTML = productCard(p)
        document.querySelector(`.card[data-sku="${CSS.escape(sku)}"] .stock`)?.classList.add('flash')
      }
    } else if (state.route.name === 'product' && state.route.id === sku) {
      renderProduct(sku)
      document.querySelector('.detail .stock')?.classList.add('flash')
    }
    if ($('#cart').classList.contains('open')) renderCart()
  })

  socket.on('order', (order) => {
    if (state.route.name === 'tracking' && state.route.id === order.orderId) {
      state.tracking = order
      clearInterval(state.pollTimer)
      renderTracking(order.orderId)
    }
    if (state.route.name === 'orders' && state.email && order.email?.toLowerCase() === state.email.toLowerCase()) renderMyOrders()
  })

  socket.on('notification', (n) => {
    if (!state.email || n.email.toLowerCase() !== state.email.toLowerCase()) return
    state.inbox.unshift(n)
    renderInbox()
    const badge = $('#bell-badge')
    badge.classList.remove('pop')
    void badge.offsetWidth
    badge.classList.add('pop')
    toast(`📧 ${n.asunto}`, n.cuerpo)
  })

  socket.on('reset', async () => {
    await loadCatalog()
    state.inbox = []
    renderInbox()
    renderRoute()
    toast('La demo se reinició', 'El stock volvió a los valores iniciales.')
  })
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

setupUi()
saveCart()
try {
  await loadCatalog()
} catch {
  view.innerHTML = '<div class="empty-state"><div class="big">😕</div><p>No pudimos cargar el catálogo. Recargá la página en unos segundos.</p></div>'
}
setupSocket()
loadInbox()
window.addEventListener('hashchange', onRouteChange)
onRouteChange()
