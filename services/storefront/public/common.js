// Utilidades compartidas por la tienda y la página de administración.

/* global io */

const host = `${location.protocol}//${location.hostname}`

/** URLs de los otros servicios: el navegador les habla directo (el servidor de la tienda nunca lo hace). */
export const urls = {
  orders: `${host}:3000`,
  inventory: `${host}:3001`,
  dashboard: `${host}:8080`
}

export const $ = (sel, root = document) => root.querySelector(sel)

export const pesos = (n) => `$${Number(n ?? 0).toLocaleString('es-AR')}`

export const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

export const timeOf = (iso) =>
  iso ? new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''

export const dateOf = (iso) =>
  iso ? new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''

export const STATUS_LABEL = { PENDING: 'En proceso', CONFIRMED: 'Confirmado', CANCELLED: 'Cancelado' }

export async function getJson(url) {
  const res = await fetch(url)
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`)
    err.status = res.status
    throw err
  }
  return res.json()
}

export async function postJson(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const json = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, json }
}

/** Lectura/escritura segura de localStorage (puede estar bloqueado). */
export const storage = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key)
      return v === null ? fallback : JSON.parse(v)
    } catch {
      return fallback
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* sin almacenamiento: se pierde al recargar */
    }
  }
}

export function toast(title, body = '', kind = '') {
  const el = document.createElement('div')
  el.className = `toast ${kind}`
  el.innerHTML = `<div><strong>${escapeHtml(title)}</strong>${body ? `<div class="t-body">${escapeHtml(body)}</div>` : ''}</div>`
  const box = $('#toasts')
  box.appendChild(el)
  while (box.children.length > 3) box.firstElementChild.remove()
  setTimeout(() => el.remove(), 5000)
}

export const connectSocket = () => io()
