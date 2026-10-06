// Pedidos de ejemplo para cada escena. Lo usan el panel (navegador) y scripts/order.js (terminal).

export const PRODUCTS = {
  'MATE-01': { name: 'Mate de calabaza', price: 15000 },
  'BOMBILLA-02': { name: 'Bombilla de alpaca', price: 8000 },
  'YERBA-03': { name: 'Yerba 1 kg', price: 6500 },
  'TERMO-04': { name: 'Termo 1 L', price: 45000 }
}

const CUSTOMERS = ['Ana', 'Bruno', 'Carla', 'Diego', 'Elena', 'Facundo', 'Gabi', 'Hernán', 'Inés', 'Juan', 'Lucía', 'Martín']

const pick = (list) => list[Math.floor(Math.random() * list.length)]

const withTotal = (customer, items) => ({
  customer,
  items,
  total: items.reduce((sum, { sku, qty }) => sum + PRODUCTS[sku].price * qty, 0)
})

/**
 * Arma el cuerpo de POST /orders para una escena.
 * @param {'normal'|'rechazado'|'sin-stock'|'rafaga'} kind
 */
export function buildOrder(kind) {
  const customer = pick(CUSTOMERS)
  switch (kind) {
    case 'rechazado':
      // 7 mates + 2 bombillas = $121.000 > límite de $100.000
      return withTotal(customer, [{ sku: 'MATE-01', qty: 7 }, { sku: 'BOMBILLA-02', qty: 2 }])
    case 'sin-stock':
      return withTotal(customer, [{ sku: 'TERMO-04', qty: 1 }])
    case 'rafaga':
      return withTotal(customer, [{ sku: pick(['MATE-01', 'BOMBILLA-02', 'YERBA-03']), qty: 1 }])
    case 'normal':
    default:
      return withTotal(
        customer,
        Math.random() < 0.5 ? [{ sku: 'MATE-01', qty: 1 }] : [{ sku: 'MATE-01', qty: 1 }, { sku: 'BOMBILLA-02', qty: 1 }]
      )
  }
}
