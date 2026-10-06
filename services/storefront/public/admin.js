import { $, urls, pesos, escapeHtml, timeOf, STATUS_LABEL, getJson, postJson, toast, connectSocket } from './common.js'

const state = { catalog: [], orders: new Map() }

function renderProducts(flashSku) {
  $('#stock-total').textContent = `${state.catalog.reduce((n, p) => n + (p.available ?? 0), 0)} unidades en total`
  $('#products').innerHTML = state.catalog
    .map(
      (p) => `
      <tr class="${p.sku === flashSku ? 'flash' : ''}">
        <td><span class="prod"><img src="${p.image}" alt="" />${escapeHtml(p.name)}</span></td>
        <td class="mono">${p.sku}</td>
        <td class="num">${pesos(p.price)}</td>
        <td class="num"><span class="stock-num ${p.available === 0 ? 'zero' : ''}">${p.available ?? '–'}</span></td>
        <td>
          <form class="replenish" data-sku="${p.sku}">
            <input type="number" name="qty" min="1" max="1000" value="5" aria-label="Cantidad a reponer de ${escapeHtml(p.name)}" />
            <button class="btn" type="submit">Reponer stock</button>
          </form>
        </td>
      </tr>`
    )
    .join('')
}

function renderOrders(flashId) {
  const orders = [...state.orders.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  $('#orders-total').textContent = `${orders.length} pedido(s)`
  $('#orders-empty').hidden = orders.length > 0
  $('#orders').innerHTML = orders
    .map(
      (o) => `
      <tr class="${o.orderId === flashId ? 'flash' : ''}">
        <td class="mono">#${escapeHtml(o.orderId)}</td>
        <td>${escapeHtml(o.customer)}<br/><span class="muted">${escapeHtml(o.email ?? '')}</span></td>
        <td>${o.items.map((i) => `${i.qty} × ${escapeHtml(i.name)}`).join('<br/>')}</td>
        <td class="num">${pesos(o.total)}</td>
        <td><span class="pill ${o.status}">${STATUS_LABEL[o.status]}</span></td>
        <td class="muted">${escapeHtml(o.reason)}</td>
        <td class="muted">${timeOf(o.createdAt)}</td>
      </tr>`
    )
    .join('')
}

async function load() {
  const [catalog, orders] = await Promise.all([getJson('/api/catalog'), getJson('/api/admin/orders')])
  state.catalog = catalog
  state.orders = new Map(orders.map((o) => [o.orderId, o]))
  renderProducts()
  renderOrders()
}

document.addEventListener('submit', async (ev) => {
  const form = ev.target.closest('form.replenish')
  if (!form) return
  ev.preventDefault()
  const qty = Number(form.elements.qty.value)
  const button = form.querySelector('button')
  button.disabled = true
  try {
    // El navegador le habla directo a la API de administración de inventory; el cambio vuelve como evento.
    const { ok, json } = await postJson(`${urls.inventory}/admin/stock/${encodeURIComponent(form.dataset.sku)}/replenish`, { qty })
    if (ok) toast(`Stock repuesto: ${json.sku}`, `+${json.qty} → quedan ${json.available}`, 'ok')
    else toast('No se pudo reponer', json.error ?? '', 'bad')
  } catch {
    toast('No se pudo reponer', `¿Está levantado inventory en ${urls.inventory}?`, 'bad')
  } finally {
    button.disabled = false
  }
})

const socket = connectSocket()
socket.on('stock', ({ sku, available }) => {
  const p = state.catalog.find((x) => x.sku === sku)
  if (!p) return
  p.available = available
  renderProducts(sku)
})
socket.on('order', (order) => {
  state.orders.set(order.orderId, order)
  renderOrders(order.orderId)
})
socket.on('reset', load)

$('#tech-link').href = urls.dashboard
await load()
