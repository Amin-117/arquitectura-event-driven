// Pedidos de ejemplo para cada escena. Lo usan el panel (navegador) y scripts/order.js (terminal).
// Usan SKU del catálogo compartido; el total NO se manda: lo calcula orders con los precios del catálogo.

const CUSTOMERS = ['Ana', 'Bruno', 'Carla', 'Diego', 'Elena', 'Facundo', 'Gabi', 'Hernán', 'Inés', 'Juan', 'Lucía', 'Martín']

// Productos con stock holgado (TERMO-04 queda fuera: arranca en 0 a propósito).
const EVERYDAY = ['MATE-01', 'MATE-05', 'BOMBILLA-02', 'BOMBILLA-07', 'YERBA-08', 'AZUCARERA-10']

const pick = (list) => list[Math.floor(Math.random() * list.length)]

const emailOf = (name) =>
  `${name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()}@ejemplo.com`

const order = (customer, items) => ({ customer, email: emailOf(customer), cardNumber: '4111111111111111', items })

/**
 * Arma el cuerpo de POST /orders para una escena.
 * @param {'normal'|'rechazado'|'sin-stock'|'rafaga'} kind
 */
export function buildOrder(kind) {
  const customer = pick(CUSTOMERS)
  switch (kind) {
    case 'rechazado':
      // 7 × MATE-01 ($15.000) + 2 × BOMBILLA-02 ($8.000) = $121.000 > límite de $100.000
      return order(customer, [{ sku: 'MATE-01', qty: 7 }, { sku: 'BOMBILLA-02', qty: 2 }])
    case 'sin-stock':
      return order(customer, [{ sku: 'TERMO-04', qty: 1 }])
    case 'rafaga':
      return order(customer, [{ sku: pick([...EVERYDAY, 'YERBA-03', 'MATE-06']), qty: 1 }])
    case 'normal':
    default: {
      const first = pick(EVERYDAY)
      const second = pick(EVERYDAY.filter((s) => s !== first))
      return order(customer, Math.random() < 0.5 ? [{ sku: first, qty: 1 }] : [{ sku: first, qty: 1 }, { sku: second, qty: 1 }])
    }
  }
}
