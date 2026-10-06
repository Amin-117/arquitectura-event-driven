// Catálogo maestro compartido (datos fijos). Lo usan orders (para calcular el total),
// el storefront (para mostrar la tienda) y el panel. Es JavaScript puro: también se puede
// servir tal cual al navegador.

/**
 * @typedef {'mates'|'bombillas'|'yerbas'|'termos'|'accesorios'} Category
 * @typedef {Object} Product
 * @property {string} sku
 * @property {string} name
 * @property {string} description   descripción corta
 * @property {Category} category
 * @property {number} price         en pesos argentinos
 */

/** @type {Record<Category, string>} */
export const CATEGORIES = {
  mates: 'Mates',
  bombillas: 'Bombillas',
  yerbas: 'Yerbas',
  termos: 'Termos',
  accesorios: 'Accesorios'
}

/** @type {Product[]} */
export const CATALOG = [
  {
    sku: 'MATE-01',
    name: 'Mate de calabaza',
    description: 'Calabaza curada a mano con virola de alpaca. El clásico de siempre.',
    category: 'mates',
    price: 15000
  },
  {
    sku: 'BOMBILLA-02',
    name: 'Bombilla de alpaca',
    description: 'Bombilla recta con filtro desarmable, fácil de limpiar.',
    category: 'bombillas',
    price: 8000
  },
  {
    sku: 'YERBA-03',
    name: 'Yerba mate 1 kg',
    description: 'Yerba con palo, estacionada 12 meses. Sabor suave y duradero.',
    category: 'yerbas',
    price: 6500
  },
  {
    sku: 'TERMO-04',
    name: 'Termo de acero 1 L',
    description: 'Mantiene el agua caliente 24 horas. Pico cebador incluido.',
    category: 'termos',
    price: 45000
  },
  {
    sku: 'MATE-05',
    name: 'Mate de algarrobo',
    description: 'Madera de algarrobo torneada, con interior curado. Liviano y resistente.',
    category: 'mates',
    price: 12000
  },
  {
    sku: 'MATE-06',
    name: 'Mate imperial',
    description: 'Calabaza forrada en cuero con virola cincelada. Para regalar.',
    category: 'mates',
    price: 38000
  },
  {
    sku: 'BOMBILLA-07',
    name: 'Bombilla pico de loro',
    description: 'Acero inoxidable con pico curvo y filtro de resorte.',
    category: 'bombillas',
    price: 9500
  },
  {
    sku: 'YERBA-08',
    name: 'Yerba barbacuá 500 g',
    description: 'Secada con humo de leña al estilo tradicional. Sabor intenso.',
    category: 'yerbas',
    price: 5200
  },
  {
    sku: 'MATERA-09',
    name: 'Matera de cuero',
    description: 'Bolso de cuero con compartimentos para termo, mate y yerbera.',
    category: 'accesorios',
    price: 32000
  },
  {
    sku: 'AZUCARERA-10',
    name: 'Set yerbera y azucarera',
    description: 'Dos latas esmaltadas con tapa hermética para el equipo completo.',
    category: 'accesorios',
    price: 11000
  }
]

/** @type {Record<string, Product>} */
export const CATALOG_BY_SKU = Object.fromEntries(CATALOG.map((p) => [p.sku, p]))

/**
 * Calcula el total de un pedido con los precios del catálogo.
 * @param {{ sku: string, qty: number }[]} items
 */
export function priceOf(items) {
  return items.reduce((sum, { sku, qty }) => sum + CATALOG_BY_SKU[sku].price * qty, 0)
}
