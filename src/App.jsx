import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { supabase, supabaseReady } from './supabaseClient'

const DEMO = {
  locations: [
    { id: 'demo-afro', name: 'AFRO', pin: '1111' },
    { id: 'demo-karina', name: 'Karina', pin: '2222' },
  ],
  suppliers: [
    { id: 's1', name: 'Карина', contact: '8 (777) 805 8098', note: 'оплата с кассы' },
    { id: 's2', name: 'TGR', contact: '8 (747) 333 3347', note: 'с кассы' },
  ],
  products: [
    { id: 'p1', supplier_id: 's1', name: 'Салфетки 24*24 (1 пачка)', category: 'Салфетки', unit: 'шт', price: 124, payment_note: 'оплата с кассы' },
    { id: 'p2', supplier_id: 's1', name: 'Салфетки 33*33 2сл. зеленые', category: 'Салфетки', unit: 'шт', price: 290, payment_note: 'оплата с кассы' },
    { id: 'p3', supplier_id: 's1', name: 'Туал.бумага Delicate Care 2сл, 12шт', category: 'Салфетки', unit: 'упк', price: 1248, payment_note: 'оплата с кассы' },
    { id: 'p4', supplier_id: 's2', name: 'Сахар стики 5г', category: 'Кухня', unit: 'шт', price: 1, payment_note: '' },
    { id: 'p5', supplier_id: 's2', name: 'Ведро 850мл, 120шт', category: 'Одноразовая посуда', unit: 'упк', price: 1900, payment_note: '', hint: 'К этому ведру нужна отдельная крышка — не забудьте добавить её в заказ' },
  ],
}

function localId() {
  return (crypto && crypto.randomUUID) ? crypto.randomUUID() : 'local-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)
}

function useDataStore() {
  const [locations, setLocations] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [products, setProducts] = useState([])
  const [locationProducts, setLocationProducts] = useState([])
  const [stockLevels, setStockLevels] = useState([])
  const [settings, setSettings] = useState({ report_filename_template: 'ЗАКУП_{location}_{date}', company_name: '', kitchen_pin: '' })
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    if (!supabaseReady) {
      // Demo/local mode: only seed once. Reload must NOT stomp on rows the
      // person has already added locally — that was the bug where an
      // import or an edit appeared to "undo itself" a second later.
      setLocations((prev) => (prev.length ? prev : DEMO.locations))
      setSuppliers((prev) => (prev.length ? prev : DEMO.suppliers))
      setProducts((prev) => (prev.length ? prev : DEMO.products))
      setLoading(false)
      return
    }
    setLoading(true)
    const [loc, sup, prod, lp, st, sl] = await Promise.all([
      supabase.from('locations').select('*').order('sort_order').order('name'),
      supabase.from('suppliers').select('*').order('sort_order').order('name'),
      supabase.from('products').select('*').eq('is_archived', false).order('sort_order').order('name'),
      supabase.from('location_products').select('*'),
      supabase.from('app_settings').select('*').eq('id', 1).maybeSingle(),
      supabase.from('stock_levels').select('*'),
    ])
    setLocations(loc.data || [])
    setSuppliers(sup.data || [])
    setProducts(prod.data || [])
    setLocationProducts(lp.data || [])
    if (st.data) setSettings(st.data)
    setStockLevels(sl.data || [])
    setLoading(false)
  }, [])

  useEffect(() => { reload() }, [reload])

  const loadLastOrder = useCallback(async (locationId, source = 'main') => {
    if (!supabaseReady || !locationId) return null
    const { data: order } = await supabase
      .from('orders')
      .select('*')
      .eq('location_id', locationId)
      .eq('status', 'finished')
      .eq('source', source)
      .order('finished_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!order) return null
    const { data: rows } = await supabase
      .from('order_items')
      .select('*')
      .eq('order_id', order.id)
      .order('sort_order')
    if (!rows || !rows.length) return null
    return {
      finished_at: order.finished_at,
      items: rows.map((r) => ({
        product_id: r.product_id,
        supplier_id: r.supplier_id,
        supplier_name: r.supplier_name,
        supplier_contact: r.supplier_contact,
        product_name: r.product_name,
        unit: r.unit,
        price: r.price,
        payment_note: r.payment_note,
        quantity: r.quantity,
      })),
    }
  }, [])

  // Frequency ranking: looks at recent finished orders for this location
  // and counts how often each product appeared, so the order screen can
  // surface a "часто заказываете" quick-add row — the single biggest lever
  // for cutting manual input on recurring purchases, since most items
  // people buy are the same handful every time.
  const loadFrequentProducts = useCallback(async (locationId, source = 'main') => {
    if (!supabaseReady || !locationId) return []
    const { data, error } = await supabase
      .from('order_items')
      .select('product_id, orders!inner(location_id, status, finished_at, source)')
      .eq('orders.location_id', locationId)
      .eq('orders.status', 'finished')
      .eq('orders.source', source)
      .order('finished_at', { ascending: false, foreignTable: 'orders' })
      .limit(400)
    if (error || !data) return []
    const counts = new Map()
    for (const row of data) {
      if (!row.product_id) continue
      counts.set(row.product_id, (counts.get(row.product_id) || 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id)
  }, [])

  // --- Generic CRUD helpers -------------------------------------------
  // When Supabase is connected, every write goes through it and the store
  // re-syncs from the source of truth. When it's not connected (demo/local
  // mode), the same call just edits local state directly instead of being
  // silently dropped and overwritten by the next reload().
  const addLocation = useCallback(async (row) => {
    if (supabaseReady) { await supabase.from('locations').insert(row); await reload() }
    else setLocations((prev) => [...prev, { id: localId(), sort_order: prev.length, ...row }])
  }, [reload])
  const updateLocation = useCallback(async (id, field, value) => {
    if (supabaseReady) { await supabase.from('locations').update({ [field]: value }).eq('id', id); await reload() }
    else setLocations((prev) => prev.map((l) => (l.id === id ? { ...l, [field]: value } : l)))
  }, [reload])
  const removeLocation = useCallback(async (id) => {
    if (supabaseReady) { await supabase.from('locations').delete().eq('id', id); await reload() }
    else setLocations((prev) => prev.filter((l) => l.id !== id))
  }, [reload])

  const addSupplier = useCallback(async (row) => {
    if (supabaseReady) { await supabase.from('suppliers').insert(row); await reload() }
    else setSuppliers((prev) => [...prev, { id: localId(), sort_order: prev.length, ...row }])
  }, [reload])
  const updateSupplier = useCallback(async (id, field, value) => {
    if (supabaseReady) { await supabase.from('suppliers').update({ [field]: value }).eq('id', id); await reload() }
    else setSuppliers((prev) => prev.map((s) => (s.id === id ? { ...s, [field]: value } : s)))
  }, [reload])
  const removeSupplier = useCallback(async (id) => {
    if (supabaseReady) { await supabase.from('suppliers').delete().eq('id', id); await reload() }
    else setSuppliers((prev) => prev.filter((s) => s.id !== id))
  }, [reload])

  const addProduct = useCallback(async (row) => {
    if (supabaseReady) { await supabase.from('products').insert(row); await reload() }
    else setProducts((prev) => [...prev, { id: localId(), sort_order: prev.length, is_archived: false, ...row }])
  }, [reload])
  const addProductsBulk = useCallback(async (rows) => {
    if (supabaseReady) { await supabase.from('products').insert(rows); await reload() }
    else setProducts((prev) => [...prev, ...rows.map((r) => ({ id: localId(), is_archived: false, ...r }))])
  }, [reload])
  const updateProduct = useCallback(async (id, field, value) => {
    if (supabaseReady) { await supabase.from('products').update({ [field]: value }).eq('id', id); await reload() }
    else setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, [field]: value } : p)))
  }, [reload])
  const removeProduct = useCallback(async (id) => {
    if (supabaseReady) { await supabase.from('products').delete().eq('id', id); await reload() }
    else setProducts((prev) => prev.filter((p) => p.id !== id))
  }, [reload])

  const saveSettings = useCallback(async (patch) => {
    if (supabaseReady) { await supabase.from('app_settings').update(patch).eq('id', 1); await reload() }
    else setSettings((prev) => ({ ...prev, ...patch }))
  }, [reload])

  // Order limit per (location, product) — stored on location_products so it
  // can live alongside the existing price override. Upsert keeps whichever
  // price_override was already there if one exists.
  const setLocationProductLimit = useCallback(async (locationId, productId, maxQty) => {
    const value = maxQty === '' || maxQty == null ? null : Number(maxQty)
    if (supabaseReady) {
      const existing = locationProducts.find((lp) => lp.location_id === locationId && lp.product_id === productId)
      await supabase.from('location_products').upsert(
        { id: existing?.id, location_id: locationId, product_id: productId, price_override: existing?.price_override ?? null, max_qty: value },
        { onConflict: 'location_id,product_id' }
      )
      await reload()
    } else {
      setLocationProducts((prev) => {
        const idx = prev.findIndex((lp) => lp.location_id === locationId && lp.product_id === productId)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = { ...next[idx], max_qty: value }
          return next
        }
        return [...prev, { id: localId(), location_id: locationId, product_id: productId, price_override: null, max_qty: value }]
      })
    }
  }, [reload, locationProducts])

  // --- Остатки (stock) --------------------------------------------------
  const setStock = useCallback(async (locationId, productId, quantity) => {
    const value = Number(quantity) || 0
    if (supabaseReady) {
      await supabase.from('stock_levels').upsert(
        { location_id: locationId, product_id: productId, quantity: value, updated_at: new Date().toISOString() },
        { onConflict: 'location_id,product_id' }
      )
      setStockLevels((prev) => {
        const idx = prev.findIndex((s) => s.location_id === locationId && s.product_id === productId)
        const next = [...prev]
        if (idx >= 0) next[idx] = { ...next[idx], quantity: value }
        else next.push({ id: localId(), location_id: locationId, product_id: productId, quantity: value })
        return next
      })
    } else {
      setStockLevels((prev) => {
        const idx = prev.findIndex((s) => s.location_id === locationId && s.product_id === productId)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = { ...next[idx], quantity: value }
          return next
        }
        return [...prev, { id: localId(), location_id: locationId, product_id: productId, quantity: value }]
      })
    }
  }, [])

  // --- Ревизия (inventory reconciliation) --------------------------------
  const loadRevisions = useCallback(async (locationId, source = 'main') => {
    if (!supabaseReady || !locationId) return []
    const { data } = await supabase
      .from('revisions')
      .select('*, revision_items(diff)')
      .eq('location_id', locationId)
      .eq('source', source)
      .order('created_at', { ascending: false })
      .limit(20)
    return (data || []).map((r) => ({
      ...r,
      items_count: r.revision_items?.length || 0,
      total_diff: (r.revision_items || []).reduce((s, it) => s + (Number(it.diff) || 0), 0),
    }))
  }, [])

  const loadRevisionItems = useCallback(async (revisionId) => {
    if (!supabaseReady || !revisionId) return []
    const { data } = await supabase.from('revision_items').select('*').eq('revision_id', revisionId).order('sort_order')
    return data || []
  }, [])

  // Saves a revision (audit) and writes its actual-counted quantities back
  // into stock_levels, so the new counted amount becomes the "учётный"
  // (expected) baseline for next time.
  const saveRevision = useCallback(async (locationId, locationName, source, rows, note) => {
    const itemRows = rows.map((r, i) => ({
      product_id: r.product_id,
      product_name: r.product_name,
      unit: r.unit,
      expected_qty: r.expected_qty,
      actual_qty: r.actual_qty,
      diff: Number((r.actual_qty - r.expected_qty).toFixed(2)),
      sort_order: i,
    }))
    if (supabaseReady) {
      const { data: rev } = await supabase
        .from('revisions')
        .insert({ location_id: locationId, location_name: locationName, source, note: note || null })
        .select()
        .single()
      if (rev) {
        await supabase.from('revision_items').insert(itemRows.map((r) => ({ ...r, revision_id: rev.id })))
        await supabase.from('stock_levels').upsert(
          rows.map((r) => ({ location_id: locationId, product_id: r.product_id, quantity: r.actual_qty, updated_at: new Date().toISOString() })),
          { onConflict: 'location_id,product_id' }
        )
      }
      await reload()
    } else {
      setStockLevels((prev) => {
        const next = [...prev]
        for (const r of rows) {
          const idx = next.findIndex((s) => s.location_id === locationId && s.product_id === r.product_id)
          if (idx >= 0) next[idx] = { ...next[idx], quantity: r.actual_qty }
          else next.push({ id: localId(), location_id: locationId, product_id: r.product_id, quantity: r.actual_qty })
        }
        return next
      })
    }
  }, [reload])

  return {
    locations, suppliers, products, locationProducts, stockLevels, settings, loading, reload, setSettings, loadLastOrder, loadFrequentProducts,
    addLocation, updateLocation, removeLocation,
    addSupplier, updateSupplier, removeSupplier,
    addProduct, addProductsBulk, updateProduct, removeProduct,
    saveSettings, setLocationProductLimit,
    setStock, loadRevisions, loadRevisionItems, saveRevision,
  }
}

function money(n) {
  return new Intl.NumberFormat('ru-RU').format(Math.round((n || 0) * 100) / 100)
}

function IconSearch() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
}
function IconClose() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
}
function IconRepeat() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 2.1l4 4-4 4" /><path d="M3 12.7V12a9 9 0 0 1 15.3-6.4L21 8.1" /><path d="M7 21.9l-4-4 4-4" /><path d="M21 11.3v.7a9 9 0 0 1-15.3 6.4L3 15.9" /></svg>
}
function IconTruck() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7h11v8H3z" /><path d="M14 11h4l3 3v1h-7z" /><circle cx="7.5" cy="18" r="1.6" /><circle cx="17.5" cy="18" r="1.6" /></svg>
}
function IconChevron() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
}
function IconCheck() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
}
function IconInfo() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5M12 8v.01" /></svg>
}
function IconLink() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.5 1.5" /><path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.5-1.5" /></svg>
}
function IconStar() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2.5l2.9 6.3 6.9.8-5.1 4.8 1.4 6.9-6.1-3.5-6.1 3.5 1.4-6.9-5.1-4.8 6.9-.8z" /></svg>
}
function IconWhatsApp() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12.02 2C6.5 2 2 6.48 2 12c0 1.85.5 3.58 1.38 5.07L2 22l5.08-1.33A9.96 9.96 0 0 0 12.02 22C17.53 22 22 17.52 22 12S17.53 2 12.02 2zm0 18.13c-1.63 0-3.15-.44-4.46-1.22l-.32-.19-3.02.79.81-2.94-.2-.3A8.1 8.1 0 0 1 3.87 12c0-4.5 3.66-8.15 8.15-8.15S20.16 7.5 20.16 12s-3.65 8.13-8.14 8.13zm4.47-6.1c-.24-.12-1.44-.71-1.66-.79-.22-.08-.39-.12-.55.12-.16.24-.63.79-.78.95-.14.16-.28.18-.53.06-.24-.12-1.02-.38-1.94-1.2-.72-.64-1.2-1.43-1.34-1.67-.14-.24-.02-.37.11-.49.11-.11.24-.28.36-.42.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.42-.06-.12-.55-1.33-.76-1.82-.2-.48-.4-.42-.55-.42-.14-.01-.3-.01-.46-.01a.9.9 0 0 0-.65.3c-.22.24-.85.83-.85 2.03 0 1.2.87 2.35 1 2.51.12.16 1.71 2.61 4.14 3.66.58.25 1.03.4 1.38.51.58.18 1.11.16 1.53.1.47-.07 1.44-.59 1.64-1.16.2-.57.2-1.06.14-1.16-.06-.1-.22-.16-.46-.28z" /></svg>
}
function IconSun() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4.5" /><path d="M12 2.5v2.4M12 19.1v2.4M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.9 19.1l1.7-1.7M17.4 6.6l1.7-1.7" /></svg>
}
function IconMoon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11z" /></svg>
}
function IconLock() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="4.5" y="10.5" width="15" height="10" rx="2" /><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" /></svg>
}
function IconClipboard() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="4.5" width="14" height="16.5" rx="2" /><path d="M9 3.5h6a1 1 0 0 1 1 1v1.5H8V4.5a1 1 0 0 1 1-1z" /><path d="M8.5 11.5h7M8.5 15.5h7" /></svg>
}
function IconScale() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v18M6 7h12M4 7l2.5 5.5a2.6 2.6 0 0 0 5 0L14 7M9 7l2.5 5.5a2.6 2.6 0 0 0 5 0L19 7" /></svg>
}

// Small emoji icon per category, matched by keyword — purely decorative,
// helps people scan the list visually instead of reading every label.
const CATEGORY_ICON_RULES = [
  [/салфет|туал.{0,3}бумаг|полотенц/i, '🧻'],
  [/посуд|тарел|стакан|ведр|крышк|контейнер/i, '🥡'],
  [/кухн|специ|сахар|соль|масло|мука/i, '🍳'],
  [/напит|вода|сок|кофе|чай|стик/i, '🥤'],
  [/овощ|фрукт|зелен|лимон/i, '🥦'],
  [/мясо|курин|говя|фарш/i, '🥩'],
  [/рыба|морепрод/i, '🐟'],
  [/молок|сыр|йогурт|сливк/i, '🥛'],
  [/хоз|моющ|перчат|мешк|губк/i, '🧴'],
  [/хлеб|выпечк/i, '🍞'],
]
function categoryIcon(cat) {
  if (!cat) return '📦'
  for (const [re, icon] of CATEGORY_ICON_RULES) if (re.test(cat)) return icon
  return '📦'
}

// Turns a stored contact string ("8 (777) 805 8098") into a wa.me-friendly
// international number. Kazakhstan mobile numbers start with 8 locally but
// need the country code 7 for WhatsApp deep links.
function phoneToWaDigits(contact) {
  const digits = (contact || '').replace(/\D/g, '')
  if (!digits) return ''
  if (digits.length === 11 && digits.startsWith('8')) return '7' + digits.slice(1)
  if (digits.length === 10) return '7' + digits
  return digits
}
function buildSupplierWaMessage(locationName, items) {
  const lines = items.map((it) => `• ${it.product_name} — ${it.quantity} ${it.unit}`)
  const total = items.reduce((s, it) => s + it.quantity * it.price, 0)
  return `Здравствуйте! Заявка на закуп${locationName ? ` (${locationName})` : ''}:\n\n${lines.join('\n')}\n\nИтого: ${money(total)} ₸`
}

// Tries to hand the PDF file straight to WhatsApp via the OS share sheet
// (works on phones — Chrome/Safari — where WhatsApp is installed: user
// picks WhatsApp, the file is already attached, they just pick a contact
// and hit send). Browsers don't allow a website to attach a file to
// WhatsApp and press "send" with zero taps — that control belongs to the
// OS/WhatsApp, not to any website — so when native sharing isn't available
// (mostly desktop) this falls back to downloading the PDF and opening
// WhatsApp with the order text ready, so only the file needs attaching by hand.
async function sharePdfToWhatsApp(file, text, waDigits) {
  if (typeof navigator !== 'undefined' && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name, text })
      return 'shared'
    } catch (err) {
      if (err && err.name === 'AbortError') return 'cancelled'
      // fall through to download+link fallback below
    }
  }
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url; a.download = file.name; a.click()
  URL.revokeObjectURL(url)
  const waUrl = `https://wa.me/${waDigits || ''}?text=${encodeURIComponent(text)}`
  window.open(waUrl, '_blank', 'noopener')
  return 'downloaded'
}

function Stepper({ qty, onChange, size = 'md' }) {
  return (
    <div className={`stepper stepper-${size}`}>
      <button type="button" className="step-btn minus" onClick={() => onChange(Math.max(0, qty - 1))} aria-label="Меньше">−</button>
      <input
        className="step-value"
        type="number"
        inputMode="decimal"
        value={qty}
        onChange={(e) => {
          const v = e.target.value
          if (v === '') return onChange(0)
          const n = Number(v)
          if (!Number.isNaN(n)) onChange(Math.max(0, n))
        }}
        onFocus={(e) => e.target.select()}
      />
      <button type="button" className="step-btn plus" onClick={() => onChange(qty + 1)} aria-label="Больше">+</button>
    </div>
  )
}

export default function App() {
  const store = useDataStore()
  const { locations, suppliers, products, locationProducts, settings, loading } = store

  const [view, setView] = useState('order')
  // Which точка's "Кухня" is unlocked right now — set by matching a PIN to
  // a location, not by the user picking from a list. Kept in sessionStorage
  // so a page refresh doesn't kick the point out mid-shift, but a browser
  // restart / new tab requires the PIN again.
  const [kitchenLocationId, setKitchenLocationId] = useState(() => {
    if (typeof window === 'undefined') return ''
    return window.sessionStorage.getItem('zakup-kitchen-location-id') || ''
  })
  const [pinModalOpen, setPinModalOpen] = useState(false)
  const [locationId, setLocationId] = useState('')
  const [query, setQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [collapsed, setCollapsed] = useState({})
  const [carts, setCarts] = useState({}) // { [locationId]: [items] }
  const [lastOrderInfo, setLastOrderInfo] = useState(null)
  const [repeatBusy, setRepeatBusy] = useState(false)
  const [toast, setToast] = useState(null)
  const [frequentIds, setFrequentIds] = useState([])
  const [theme, setTheme] = useState(() => {
    if (typeof window === 'undefined') return 'light'
    const saved = window.localStorage.getItem('zakup-theme')
    if (saved) return saved
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  const toastTimer = useRef(null)
  const ticketRef = useRef(null)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    window.localStorage.setItem('zakup-theme', theme)
  }, [theme])

  useEffect(() => {
    if (!locationId && locations.length) setLocationId(locations[0].id)
  }, [locations, locationId])

  useEffect(() => {
    setLastOrderInfo(null)
    setFrequentIds([])
    setCategoryFilter('')
    setCollapsed({})
    if (locationId) {
      store.loadLastOrder(locationId).then((res) => setLastOrderInfo(res))
      store.loadFrequentProducts(locationId).then((ids) => setFrequentIds(ids))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId])

  function showToast(text, type = 'success', action = null) {
    setToast({ text, type, action })
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), action ? 6000 : 2600)
  }

  // Hints are written like `...«Точное или частичное название товара»`.
  // When a product with such a hint gets added to the cart for the first
  // time, look up the referenced product so we can offer to add it too —
  // this is what actually solves "I ordered buckets but forgot the lids".
  const normalize = (s) => (s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  function findPairedProduct(product) {
    if (!product.hint) return null
    const match = product.hint.match(/«([^»]+)»/)
    if (!match) return null
    const target = normalize(match[1])
    if (!target) return null
    return products.find((p) => {
      if (p.id === product.id) return false
      const n = normalize(p.name)
      return n === target || n.includes(target) || target.includes(n)
    }) || null
  }

  const cart = carts[locationId] || []
  const cartById = useMemo(() => Object.fromEntries(cart.map((it) => [it.product_id, it])), [cart])

  const supplierById = useMemo(() => Object.fromEntries(suppliers.map((s) => [s.id, s])), [suppliers])

  // Products scoped to the selected location (catalog override applied),
  // independent of the search box — this is what the "frequently ordered"
  // row draws from, so it still works while the person is mid-search.
  const locationScopedProducts = useMemo(() => {
    const scoped = locationProducts.filter((lp) => lp.location_id === locationId)
    const hasScope = scoped.length > 0
    const scopedIds = new Set(scoped.map((lp) => lp.product_id))
    const overrideById = Object.fromEntries(scoped.map((lp) => [lp.product_id, lp.price_override]))
    const maxQtyById = Object.fromEntries(scoped.map((lp) => [lp.product_id, lp.max_qty]))
    const list = products.filter((p) => (hasScope ? scopedIds.has(p.id) : true))
    return list.map((p) => ({
      ...p,
      effective_price: overrideById[p.id] != null ? overrideById[p.id] : p.price,
      max_qty: maxQtyById[p.id] != null ? maxQtyById[p.id] : null,
    }))
  }, [products, locationProducts, locationId])

  const visibleProducts = useMemo(() => {
    if (!query.trim()) return locationScopedProducts
    const q = query.trim().toLowerCase()
    return locationScopedProducts.filter((p) => {
      const sup = supplierById[p.supplier_id]
      return (
        p.name.toLowerCase().includes(q) ||
        (p.category || '').toLowerCase().includes(q) ||
        (sup?.name || '').toLowerCase().includes(q)
      )
    })
  }, [locationScopedProducts, query, supplierById])

  // Top ~8 products by how often they showed up in past finished orders
  // for this location, ready to add with a single tap.
  const frequentProducts = useMemo(() => {
    if (!frequentIds.length) return []
    const byId = Object.fromEntries(locationScopedProducts.map((p) => [p.id, p]))
    return frequentIds.map((id) => byId[id]).filter(Boolean).slice(0, 8)
  }, [frequentIds, locationScopedProducts])

  // Products grouped Поставщик -> Категория -> Товары.
  const groupedBySupplier = useMemo(() => {
    const bySupplier = new Map()
    for (const p of visibleProducts) {
      const supKey = p.supplier_id || '__none__'
      const supName = supplierById[p.supplier_id]?.name || 'Без поставщика'
      if (!bySupplier.has(supKey)) {
        bySupplier.set(supKey, { supplierId: supKey, supplierName: supName, categories: new Map(), total: 0 })
      }
      const entry = bySupplier.get(supKey)
      entry.total += 1
      const catKey = p.category?.trim() || 'Без категории'
      if (!entry.categories.has(catKey)) entry.categories.set(catKey, [])
      entry.categories.get(catKey).push(p)
    }
    return [...bySupplier.values()]
      .map((s) => ({ ...s, categories: [...s.categories.entries()] }))
      .sort((a, b) => a.supplierName.localeCompare(b.supplierName, 'ru'))
  }, [visibleProducts, supplierById])

  // Category chips let people jump straight to a section instead of typing
  // a search query — sorted by how many items they contain.
  const categoryOptions = useMemo(() => {
    const counts = new Map()
    for (const p of visibleProducts) {
      const cat = p.category?.trim() || 'Без категории'
      counts.set(cat, (counts.get(cat) || 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [visibleProducts])

  const isFiltering = Boolean(query.trim() || categoryFilter)

  const displayedGroups = useMemo(() => {
    if (!categoryFilter) return groupedBySupplier
    return groupedBySupplier
      .map((s) => ({ ...s, categories: s.categories.filter(([cat]) => cat === categoryFilter) }))
      .filter((s) => s.categories.length)
  }, [groupedBySupplier, categoryFilter])

  const totalProductCount = visibleProducts.length

  function toggleSupplier(id) {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }))
  }
  const allCollapsed = displayedGroups.length > 0 && displayedGroups.every((s) => collapsed[s.supplierId])
  function toggleAllCollapsed() {
    const next = {}
    if (!allCollapsed) for (const s of displayedGroups) next[s.supplierId] = true
    setCollapsed(next)
  }

  function setQty(product, qty) {
    const sup = supplierById[product.supplier_id]
    let clamped = qty
    if (product.max_qty != null && clamped > product.max_qty) {
      clamped = product.max_qty
      showToast(`Лимит по этой точке: ${product.max_qty} ${product.unit}`, 'info')
    }
    qty = clamped
    const isNewAddition = qty > 0 && !cartById[product.id]
    setCarts((prev) => {
      const list = prev[locationId] ? [...prev[locationId]] : []
      const idx = list.findIndex((it) => it.product_id === product.id)
      if (qty <= 0) {
        if (idx >= 0) list.splice(idx, 1)
        return { ...prev, [locationId]: list }
      }
      if (idx >= 0) {
        list[idx] = { ...list[idx], quantity: qty }
      } else {
        list.push({
          product_id: product.id,
          supplier_id: product.supplier_id,
          supplier_name: sup?.name || 'Без поставщика',
          supplier_contact: sup?.contact || '',
          product_name: product.name,
          unit: product.unit,
          price: product.effective_price,
          payment_note: product.payment_note || sup?.note || '',
          quantity: qty,
        })
      }
      return { ...prev, [locationId]: list }
    })
    if (isNewAddition) {
      const paired = findPairedProduct(product)
      if (paired && !cartById[paired.id]) {
        showToast(`«${product.name}» добавлен. ${product.hint}`, 'suggest', {
          label: `+ ${paired.name}`,
          onClick: () => setQty({ ...paired, effective_price: paired.price }, 1),
        })
      }
    }
  }

  function setCartItemQty(product_id, qty) {
    const limit = locationScopedProducts.find((p) => p.id === product_id)?.max_qty
    if (limit != null && qty > limit) {
      qty = limit
      showToast(`Лимит по этой точке: ${limit}`, 'info')
    }
    setCarts((prev) => {
      const list = prev[locationId] ? [...prev[locationId]] : []
      const idx = list.findIndex((it) => it.product_id === product_id)
      if (idx < 0) return prev
      const next = [...list]
      if (qty <= 0) next.splice(idx, 1)
      else next[idx] = { ...next[idx], quantity: qty }
      return { ...prev, [locationId]: next }
    })
  }

  function clearCart() {
    setCarts((prev) => ({ ...prev, [locationId]: [] }))
  }

  async function repeatLastOrder() {
    if (!locationId) return
    setRepeatBusy(true)
    const res = lastOrderInfo || (await store.loadLastOrder(locationId))
    setRepeatBusy(false)
    if (!res) { showToast('Прошлых закупов по этой точке не найдено', 'info'); return }
    if (cart.length && !window.confirm('Текущий список будет заменён товарами прошлого закупа. Продолжить?')) return
    setCarts((prev) => ({ ...prev, [locationId]: res.items }))
    showToast('Прошлый закуп загружен — проверьте количества', 'info')
  }

  const grandTotal = cart.reduce((s, it) => s + it.quantity * it.price, 0)
  const currentLocation = locations.find((l) => l.id === locationId)

  const groupedCart = useMemo(() => {
    const map = new Map()
    for (const it of cart) {
      const key = it.supplier_name
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(it)
    }
    return [...map.entries()]
  }, [cart])

  async function handleExport(kind) {
    if (!cart.length) return
    const { buildFilename, exportExcel, exportPDF } = await import('./lib/report')
    const filename = buildFilename(settings.report_filename_template, { locationName: currentLocation?.name })
    const payload = { items: cart, locationName: currentLocation?.name, filename, companyName: settings.company_name }
    if (kind === 'excel') await exportExcel(payload)
    else exportPDF(payload)
  }

  // Sends just one supplier's items straight to their WhatsApp as a
  // ready-to-read message — replaces retyping the order by hand into chat.
  function sendSupplierWhatsApp(items) {
    const digits = phoneToWaDigits(items[0]?.supplier_contact)
    const text = buildSupplierWaMessage(currentLocation?.name, items)
    const url = `https://wa.me/${digits}?text=${encodeURIComponent(text)}`
    window.open(url, '_blank', 'noopener')
  }

  // Same as above but generates the PDF report first and hands it to
  // WhatsApp via the share sheet (see sharePdfToWhatsApp for the fallback
  // when native sharing isn't available).
  async function sendSupplierPdfWhatsApp(items) {
    const { buildFilename, exportPDF } = await import('./lib/report')
    const filename = buildFilename(settings.report_filename_template, { locationName: currentLocation?.name })
    const file = exportPDF({ items, locationName: currentLocation?.name, filename, companyName: settings.company_name, output: 'file' })
    const digits = phoneToWaDigits(items[0]?.supplier_contact)
    const text = buildSupplierWaMessage(currentLocation?.name, items)
    const result = await sharePdfToWhatsApp(file, text, digits)
    if (result === 'shared') showToast('Готово — выберите WhatsApp и отправьте', 'success')
    else if (result === 'downloaded') showToast('PDF скачан, WhatsApp открыт с текстом — приложите файл к сообщению', 'info')
  }

  // Whole-order PDF → WhatsApp: no single supplier number, so on desktop
  // fallback it opens WhatsApp's contact picker instead of a fixed number.
  async function sendWholeOrderPdfWhatsApp() {
    if (!cart.length) return
    const { buildFilename, exportPDF } = await import('./lib/report')
    const filename = buildFilename(settings.report_filename_template, { locationName: currentLocation?.name })
    const file = exportPDF({ items: cart, locationName: currentLocation?.name, filename, companyName: settings.company_name, output: 'file' })
    const text = `Заявка на закуп${currentLocation?.name ? ` (${currentLocation.name})` : ''} во вложении`
    const result = await sharePdfToWhatsApp(file, text, '')
    if (result === 'shared') showToast('Готово — выберите WhatsApp и отправьте', 'success')
    else if (result === 'downloaded') showToast('PDF скачан, WhatsApp открыт — выберите чат и приложите файл', 'info')
  }

  function toggleTheme() {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
  }

  async function finishOrder() {
    if (!cart.length) return
    if (supabaseReady) {
      const { data: order } = await supabase
        .from('orders')
        .insert({ location_id: locationId, status: 'finished', source: 'main', finished_at: new Date().toISOString() })
        .select()
        .single()
      if (order) {
        const rows = cart.map((it, i) => ({ order_id: order.id, ...it, sort_order: i }))
        await supabase.from('order_items').insert(rows)
      }
    }
    await handleExport('excel')
    showToast('Закуп завершён и сохранён', 'success')
    clearCart()
  }

  function openKitchen() {
    if (kitchenLocationId && locations.some((l) => l.id === kitchenLocationId)) { setView('kitchen'); return }
    setPinModalOpen(true)
  }
  function handleKitchenUnlocked(location) {
    setKitchenLocationId(location.id)
    try { window.sessionStorage.setItem('zakup-kitchen-location-id', location.id) } catch (e) { /* ignore */ }
    setPinModalOpen(false)
    setView('kitchen')
  }
  function lockKitchen() {
    setKitchenLocationId('')
    try { window.sessionStorage.removeItem('zakup-kitchen-location-id') } catch (e) { /* ignore */ }
    setView('order')
  }

  const kitchenLocation = locations.find((l) => l.id === kitchenLocationId)

  // Точку могли удалить, пока человек был внутри «Кухни» — не показываем
  // чужие данные по инерции, а сразу выкидываем его к вводу PIN заново.
  useEffect(() => {
    if (view === 'kitchen' && !loading && kitchenLocationId && !kitchenLocation) lockKitchen()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, loading, kitchenLocationId, kitchenLocation])

  if (view === 'kitchen' && kitchenLocation) {
    return (
      <KitchenApp
        store={store}
        theme={theme}
        toggleTheme={toggleTheme}
        location={kitchenLocation}
        onExit={lockKitchen}
      />
    )
  }

  return (
    <div className="app-shell">
      <div className="topbar">
        <div className="brand"><span className="dot">●</span> Закуп</div>
        <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
        <nav>
          <button className={`tab-btn ${view === 'order' ? 'active' : ''}`} onClick={() => setView('order')}>Заказ</button>
          <button className={`tab-btn ${view === 'stock' ? 'active' : ''}`} onClick={() => setView('stock')}>Остатки</button>
          <button className={`tab-btn ${view === 'revision' ? 'active' : ''}`} onClick={() => setView('revision')}>Ревизия</button>
          <button className={`tab-btn ${view === 'settings' ? 'active' : ''}`} onClick={() => setView('settings')}>Настройки</button>
          <button type="button" className="tab-btn kitchen-tab" onClick={openKitchen}><IconLock /> Кухня</button>
        </nav>
        <button
          type="button"
          className="theme-toggle"
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}
          aria-label="Переключить тему"
        >
          {theme === 'dark' ? <IconSun /> : <IconMoon />}
        </button>
      </div>

      {!supabaseReady && (
        <div className="notice">
          <IconInfo />
          <span>Supabase не подключён — работает демо-режим (данные не сохраняются). Заполните <code>.env</code> по образцу <code>.env.example</code> и подключите проект Supabase (см. README).</span>
        </div>
      )}

      {loading ? (
        <div className="main">
          <div className="panel skeleton-panel">
            <div className="skel skel-line" style={{ width: '40%', height: 14, marginBottom: 18 }} />
            <div className="skel skel-line" style={{ width: '100%', height: 40, marginBottom: 16, borderRadius: 10 }} />
            {[0, 1, 2].map((i) => (
              <div className="skel-group" key={i}>
                <div className="skel skel-line" style={{ width: '30%', height: 34, borderRadius: 10 }} />
                <div className="skel-rows">
                  {[0, 1, 2].map((j) => <div className="skel skel-line" key={j} style={{ height: 42, borderRadius: 10 }} />)}
                </div>
              </div>
            ))}
          </div>
          <div className="panel skeleton-panel">
            <div className="skel skel-line" style={{ width: '50%', height: 16, marginBottom: 16 }} />
            {[0, 1, 2, 3].map((i) => <div className="skel skel-line" key={i} style={{ height: 20, marginBottom: 12 }} />)}
          </div>
        </div>
      ) : view === 'order' ? (
        <div className="main">
          <div className="panel">
            <div className="panel-head-row">
              <h2>Товары {totalProductCount > 0 && <span className="category-count">{totalProductCount}</span>}</h2>
              <div className="panel-head-actions">
                {displayedGroups.length > 1 && (
                  <button className="btn ghost small" onClick={toggleAllCollapsed}>
                    {allCollapsed ? 'Развернуть всё' : 'Свернуть всё'}
                  </button>
                )}
                {lastOrderInfo && (
                  <button className="btn ghost small" disabled={repeatBusy} onClick={repeatLastOrder}>
                    <IconRepeat /> Повторить прошлый закуп
                  </button>
                )}
              </div>
            </div>
            {frequentProducts.length > 0 && !query && !categoryFilter && (
              <div className="frequent-row">
                <div className="frequent-label"><IconStar /> Часто заказываете</div>
                <div className="frequent-chips">
                  {frequentProducts.map((p) => {
                    const inCart = cartById[p.id]
                    const qty = inCart ? inCart.quantity : 0
                    return (
                      <button
                        type="button"
                        key={p.id}
                        className={`frequent-chip ${qty > 0 ? 'active' : ''}`}
                        onClick={() => setQty(p, qty + 1)}
                        title="Добавить 1 шт"
                      >
                        <span className="fc-name">{p.name}</span>
                        <span className="fc-price">{money(p.effective_price)} ₸</span>
                        {qty > 0 && <span className="fc-qty">×{qty}</span>}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
            <div className="search-row">
              <span className="search-icon"><IconSearch /></span>
              <input
                placeholder="Поиск товара, категории или поставщика..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button className="search-clear" onClick={() => setQuery('')} aria-label="Очистить поиск"><IconClose /></button>
              )}
            </div>
            {categoryOptions.length > 1 && (
              <div className="chip-row">
                <button className={`chip ${!categoryFilter ? 'active' : ''}`} onClick={() => setCategoryFilter('')}>
                  Все <span className="chip-count">{totalProductCount}</span>
                </button>
                {categoryOptions.map(([cat, count]) => (
                  <button key={cat} className={`chip ${categoryFilter === cat ? 'active' : ''}`} onClick={() => setCategoryFilter(categoryFilter === cat ? '' : cat)}>
                    {cat} <span className="chip-count">{count}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="product-list">
              {visibleProducts.length === 0 && (
                <div className="empty-state">
                  <span className="empty-icon"><IconSearch /></span>
                  Ничего не найдено. Добавьте товары в «Настройки → Товары».
                </div>
              )}
              {categoryFilter && displayedGroups.length === 0 && (
                <div className="empty-state">
                  <span className="empty-icon"><IconBox /></span>
                  В этой категории нет товаров для этой точки.
                </div>
              )}
              {displayedGroups.map((sup) => {
                const inCartCountSupplier = sup.categories.reduce(
                  (n, [, list]) => n + list.filter((p) => cartById[p.id]).length,
                  0
                )
                const isOpen = isFiltering || !collapsed[sup.supplierId]
                return (
                  <div className="supplier-group" key={sup.supplierId}>
                    <button type="button" className="supplier-head" onClick={() => toggleSupplier(sup.supplierId)} aria-expanded={isOpen}>
                      <IconTruck />
                      <span className="supplier-name">{sup.supplierName}</span>
                      <span className="category-count">{sup.total}</span>
                      {inCartCountSupplier > 0 && <span className="category-badge">{inCartCountSupplier} в списке</span>}
                      <span className={`chevron ${isOpen ? 'open' : ''}`}><IconChevron /></span>
                    </button>
                    {isOpen && (
                      <div className="supplier-body">
                        {sup.categories.map(([cat, list]) => {
                          const inCartCount = list.filter((p) => cartById[p.id]).length
                          return (
                            <div className="category-group" key={cat}>
                              <div className="category-head">
                                <span className="category-icon" aria-hidden="true">{categoryIcon(cat)}</span>
                                <span className="category-name">{cat}</span>
                                <span className="category-count">{list.length}</span>
                                {inCartCount > 0 && <span className="category-badge">{inCartCount} в списке</span>}
                              </div>
                              <div className="category-body">
                                {list.map((p) => {
                                  const inCart = cartById[p.id]
                                  const qty = inCart ? inCart.quantity : 0
                                  return (
                                    <div className={`product-row ${qty > 0 ? 'in-cart' : ''}`} key={p.id}>
                                      <div className="product-info">
                                        <div className="name">{p.name}</div>
                                        {p.hint && <div className="hint"><IconLink /> {p.hint}</div>}
                                      </div>
                                      <div className="price">{money(p.effective_price)} ₸<span className="unit">/{p.unit}</span></div>
                                      {qty > 0 ? (
                                        <Stepper qty={qty} onChange={(v) => setQty(p, v)} />
                                      ) : (
                                        <button className="add-btn" onClick={() => setQty(p, 1)} aria-label="Добавить">+</button>
                                      )}
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          <div className="ticket" ref={ticketRef}>
            <div className="ticket-head">
              <h2>{currentLocation?.name || 'Точка не выбрана'}</h2>
              <div className="sub">{cart.length ? `${cart.length} позиций` : 'Список пуст'}</div>
            </div>
            <div className="ticket-body">
              {groupedCart.length === 0 && (
                <div className="ticket-empty">
                  Добавьте товары слева — они появятся здесь, сгруппированные по поставщику.
                  {lastOrderInfo && <div style={{ marginTop: 10 }}><button className="btn ghost small" onClick={repeatLastOrder}><IconRepeat /> Повторить прошлый закуп</button></div>}
                </div>
              )}
              {groupedCart.map(([supplierName, items]) => (
                <div className="ticket-group" key={supplierName}>
                  <div className="ticket-group-head">
                    <div className="supplier-name">{supplierName}</div>
                    <div className="ticket-group-actions">
                      {items[0]?.supplier_contact && (
                        <button
                          type="button"
                          className="wa-btn"
                          onClick={() => sendSupplierWhatsApp(items)}
                          title={`Отправить текстом заказ «${supplierName}» в WhatsApp`}
                        >
                          <IconWhatsApp /> Текст
                        </button>
                      )}
                      <button
                        type="button"
                        className="wa-btn"
                        onClick={() => sendSupplierPdfWhatsApp(items)}
                        title={`Сформировать PDF по «${supplierName}» и отправить в WhatsApp`}
                      >
                        <IconWhatsApp /> PDF
                      </button>
                    </div>
                  </div>
                  {items.map((it) => (
                    <div className="ticket-item" key={it.product_id}>
                      <span className="ti-name">{it.product_name}</span>
                      <Stepper size="sm" qty={it.quantity} onChange={(v) => setCartItemQty(it.product_id, v)} />
                      <span className="sum">{money(it.quantity * it.price)} ₸</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div className="ticket-foot">
              <div className="ticket-total">
                <span>Итого</span>
                <span>{money(grandTotal)} ₸</span>
              </div>
              <div className="ticket-actions">
                <button className="btn" disabled={!cart.length} onClick={() => handleExport('pdf')}>PDF</button>
                <button className="btn" disabled={!cart.length} onClick={() => handleExport('excel')}>Excel</button>
              </div>
              <div className="ticket-actions" style={{ marginTop: 8 }}>
                <button className="btn" disabled={!cart.length} onClick={sendWholeOrderPdfWhatsApp}>
                  <IconWhatsApp /> PDF в WhatsApp
                </button>
              </div>
              <div className="ticket-actions" style={{ marginTop: 8 }}>
                <button className="btn" disabled={!cart.length} onClick={clearCart}>Очистить</button>
                <button className="btn primary" disabled={!cart.length} onClick={finishOrder}>Завершить закуп</button>
              </div>
            </div>
          </div>
        </div>
      ) : view === 'stock' ? (
        <div className="main" style={{ gridTemplateColumns: '1fr' }}>
          <div className="panel">
            <StockTab
              store={store}
              locations={locations}
              products={products}
              title="Остатки"
            />
          </div>
        </div>
      ) : view === 'revision' ? (
        <div className="main" style={{ gridTemplateColumns: '1fr' }}>
          <div className="panel">
            <RevisionTab
              store={store}
              locations={locations}
              products={products}
              source="main"
              title="Ревизия"
            />
          </div>
        </div>
      ) : (
        <Settings store={store} />
      )}

      <PinModal
        open={pinModalOpen}
        locations={locations}
        onCancel={() => setPinModalOpen(false)}
        onSuccess={handleKitchenUnlocked}
      />

      {view === 'order' && cart.length > 0 && (
        <button
          type="button"
          className="mobile-cart-bar"
          onClick={() => ticketRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        >
          <span>{cart.length} {cart.length === 1 ? 'позиция' : 'позиций'}</span>
          <span className="mobile-cart-total">{money(grandTotal)} ₸</span>
          <span className="mobile-cart-arrow">Открыть ↑</span>
        </button>
      )}

      {toast && (
        <div className={`toast toast-${toast.type}`}>
          <span className="toast-icon">{toast.type === 'success' ? <IconCheck /> : toast.type === 'suggest' ? <IconLink /> : <IconInfo />}</span>
          <span className="toast-text">{toast.text}</span>
          {toast.action && (
            <button
              type="button"
              className="toast-action"
              onClick={() => { toast.action.onClick(); setToast(null) }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}

      <div className="footer-note">Данные хранятся в Supabase · Отчёты формируются на устройстве, ничего не отправляется на сторонние серверы</div>
    </div>
  )
}

function IconWarning() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.3 3.9L1.9 18a1.6 1.6 0 0 0 1.4 2.4h17.4a1.6 1.6 0 0 0 1.4-2.4L13.7 3.9a1.6 1.6 0 0 0-2.8 0z" /><path d="M12 9v4.5M12 17v.01" /></svg>
}

function ConfirmDialog({ open, title, message, confirmLabel = 'Удалить', onCancel, onConfirm }) {
  if (!open) return null
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-icon"><IconWarning /></div>
        <div className="modal-title">{title}</div>
        {message && <div className="modal-message">{message}</div>}
        <div className="modal-actions">
          <button className="btn" onClick={onCancel}>Отмена</button>
          <button className="btn danger" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}

// 4-digit PIN pad to unlock the isolated "Кухня" tab. Each точка (location)
// has its OWN PIN (Настройки → Точки), so this matches the entered code
// against every location's pin and unlocks only the matching one — one
// точка can never see or switch into another точка's остатки/ревизия/заказ.
function PinModal({ open, locations, onCancel, onSuccess }) {
  const [entered, setEntered] = useState('')
  const [shake, setShake] = useState(false)

  const pinnedLocations = useMemo(() => (locations || []).filter((l) => (l.pin || '').trim()), [locations])

  useEffect(() => { if (open) setEntered('') }, [open])

  useEffect(() => {
    if (entered.length < 4) return
    const match = pinnedLocations.find((l) => l.pin === entered)
    if (match) {
      onSuccess(match)
    } else {
      setShake(true)
      setTimeout(() => { setShake(false); setEntered('') }, 420)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entered])

  if (!open) return null
  const hasAnyPin = pinnedLocations.length > 0

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-card pin-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-icon"><IconLock /></div>
        <div className="modal-title">Вкладка «Кухня»</div>
        {!hasAnyPin ? (
          <>
            <div className="modal-message">Ни для одной точки не задан PIN. Откройте «Настройки → Точки» и укажите 4-значный код для каждой точки.</div>
            <div className="modal-actions"><button className="btn" onClick={onCancel}>Понятно</button></div>
          </>
        ) : (
          <>
            <div className="modal-message">Введите 4-значный PIN своей точки</div>
            <div className={`pin-dots ${shake ? 'shake' : ''}`}>
              {[0, 1, 2, 3].map((i) => <span key={i} className={`pin-dot ${entered.length > i ? 'filled' : ''}`} />)}
            </div>
            <div className="pin-pad">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((k, i) => (
                k === '' ? <span key={i} /> : (
                  <button
                    type="button"
                    key={i}
                    className="pin-key"
                    onClick={() => {
                      if (k === '⌫') setEntered((s) => s.slice(0, -1))
                      else if (entered.length < 4) setEntered((s) => s + k)
                    }}
                  >
                    {k}
                  </button>
                )
              ))}
            </div>
            <div className="modal-actions"><button className="btn" onClick={onCancel}>Отмена</button></div>
          </>
        )}
      </div>
    </div>
  )
}

function IconLocation() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s7-7.4 7-12.5A7 7 0 0 0 5 9.5C5 14.6 12 22 12 22z" /><circle cx="12" cy="9.5" r="2.4" /></svg>
}
function IconBox() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 8L12 3 3 8l9 5 9-5z" /><path d="M3 8v9l9 5 9-5V8" /><path d="M12 13v9" /></svg>
}
function IconFile() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5" /><path d="M9.5 13h5M9.5 16.5h5" /></svg>
}

function Settings({ store }) {
  const [tab, setTab] = useState('locations')
  const tabs = [
    ['locations', 'Точки', IconLocation],
    ['suppliers', 'Поставщики', IconTruck],
    ['products', 'Товары', IconBox],
    ['limits', 'Лимиты', IconScale],
    ['report', 'Отчёт', IconFile],
  ]
  return (
    <div className="main" style={{ gridTemplateColumns: '1fr' }}>
      <div className="panel">
        <nav className="settings-nav">
          {tabs.map(([k, label, Icon]) => (
            <button key={k} className={`tab-btn settings-tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>
              <Icon /> {label}
            </button>
          ))}
        </nav>
        {tab === 'locations' && <LocationsTab store={store} />}
        {tab === 'suppliers' && <SuppliersTab store={store} />}
        {tab === 'products' && <ProductsTab store={store} />}
        {tab === 'limits' && <LimitsTab store={store} />}
        {tab === 'report' && <ReportTab store={store} />}
      </div>
    </div>
  )
}

// Per-location max quantity for a product in one закуп — "лимит товаров на
// точку". Reuses location_products (same table as the price override).
function LimitsTab({ store }) {
  const { locations, products, suppliers, locationProducts, setLocationProductLimit } = store
  const [locationId, setLocationId] = useState(locations[0]?.id || '')
  const [q, setQ] = useState('')
  const supplierById = useMemo(() => Object.fromEntries(suppliers.map((s) => [s.id, s])), [suppliers])

  useEffect(() => {
    if (!locationId && locations.length) setLocationId(locations[0].id)
  }, [locations, locationId])

  const limitByProduct = useMemo(() => {
    const m = new Map()
    for (const lp of locationProducts) if (lp.location_id === locationId) m.set(lp.product_id, lp.max_qty)
    return m
  }, [locationProducts, locationId])

  const filtered = useMemo(() => {
    if (!q.trim()) return products
    const s = q.trim().toLowerCase()
    return products.filter((p) => p.name.toLowerCase().includes(s) || (supplierById[p.supplier_id]?.name || '').toLowerCase().includes(s))
  }, [products, q, supplierById])

  if (!locations.length) return <div className="empty-state">Сначала добавьте хотя бы одну точку на вкладке «Точки».</div>

  return (
    <div>
      <div className="hint-explainer">
        <IconScale /> Лимит — максимальное количество товара, которое можно добавить в один закуп для выбранной точки.
        Пусто — лимита нет. Работает и в обычном заказе, и в «Кухне».
      </div>
      <div className="row-form" style={{ marginBottom: 14 }}>
        <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <div className="settings-search" style={{ flex: 1 }}>
          <IconSearch />
          <input placeholder="Поиск товара или поставщика..." value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <div className="table-scroll">
        <table className="data-table">
          <thead><tr><th>Товар</th><th>Поставщик</th><th style={{ width: 140 }}>Лимит на точку</th></tr></thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{supplierById[p.supplier_id]?.name || '—'}</td>
                <td>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    placeholder="без лимита"
                    defaultValue={limitByProduct.get(p.id) ?? ''}
                    onBlur={(e) => setLocationProductLimit(locationId, p.id, e.target.value)}
                    style={{ width: 110 }}
                  />
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={3} style={{ color: 'var(--ink-soft)', textAlign: 'center', padding: 20 }}>Ничего не найдено</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// Точки + их персональный PIN для входа в «Кухню». Каждая точка видит и
// редактирует PIN только своей строки — вводить его нужно на телефоне
// в модалке «Кухня», после чего человек попадает сразу в свою точку без
// возможности заглянуть в чужую.
function LocationsTab({ store }) {
  const { locations, addLocation, updateLocation, removeLocation } = store
  const [name, setName] = useState('')
  const [confirmTarget, setConfirmTarget] = useState(null)
  const [savedId, setSavedId] = useState(null)

  async function add() {
    if (!name.trim()) return
    await addLocation({ name: name.trim() })
    setName('')
  }
  async function remove(id) {
    await removeLocation(id)
    setConfirmTarget(null)
  }
  async function rename(id, value) {
    await updateLocation(id, 'name', value)
  }
  async function setPin(id, rawValue) {
    const digits = rawValue.replace(/\D/g, '').slice(0, 4)
    await updateLocation(id, 'pin', digits || null)
    setSavedId(id)
    setTimeout(() => setSavedId((cur) => (cur === id ? null : cur)), 1400)
  }

  // Two точки with the same PIN would be ambiguous — the first match wins,
  // which silently locks the second one out. Flag duplicates up front.
  const pinCounts = useMemo(() => {
    const m = new Map()
    for (const l of locations) {
      const p = (l.pin || '').trim()
      if (p) m.set(p, (m.get(p) || 0) + 1)
    }
    return m
  }, [locations])

  return (
    <div>
      <div className="hint-explainer">
        <IconLock /> У каждой точки свой 4-значный PIN — по нему открывается вкладка «Кухня» на
        телефоне. Введя PIN, человек сразу попадает в свою точку (свой закуп, свои остатки, своя
        ревизия) и не может переключиться на другую — так одна точка не видит остатки другой.
        Пустой PIN — вход в «Кухню» для этой точки закрыт.
      </div>
      <div className="row-form">
        <input placeholder="Название точки (напр. AFRO)" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} autoFocus />
        <button className="btn primary" onClick={add}>Добавить точку</button>
      </div>
      <div className="table-scroll">
        <table className="data-table">
          <thead><tr><th>Название</th><th style={{ width: 170 }}>PIN «Кухни»</th><th></th></tr></thead>
          <tbody>
            {locations.map((l) => {
              const pin = l.pin || ''
              const isDuplicate = pin && (pinCounts.get(pin) || 0) > 1
              return (
                <tr key={l.id}>
                  <td><input defaultValue={l.name} onBlur={(e) => e.target.value !== l.name && rename(l.id, e.target.value)} style={{ border: 'none', background: 'transparent', font: 'inherit', width: '100%' }} /></td>
                  <td>
                    <div className="stock-cell">
                      <input
                        defaultValue={pin}
                        onBlur={(e) => e.target.value.replace(/\D/g, '').slice(0, 4) !== pin && setPin(l.id, e.target.value)}
                        placeholder="напр. 4821"
                        inputMode="numeric"
                        style={{ width: 90, letterSpacing: 2, textAlign: 'center' }}
                      />
                      {savedId === l.id && <IconCheck />}
                    </div>
                    {isDuplicate && <div className="hint" style={{ marginTop: 4 }}>Такой PIN уже занят другой точкой</div>}
                  </td>
                  <td><button className="del-link" onClick={() => setConfirmTarget(l)}>удалить</button></td>
                </tr>
              )
            })}
            {locations.length === 0 && <tr><td colSpan={3} style={{ color: 'var(--ink-soft)', textAlign: 'center', padding: 20 }}>Точек пока нет — добавьте первую выше</td></tr>}
          </tbody>
        </table>
      </div>
      <ConfirmDialog
        open={!!confirmTarget}
        title={`Удалить точку «${confirmTarget?.name}»?`}
        message="Товары и поставщики затронуты не будут, но история закупов по этой точке останется без привязки."
        onCancel={() => setConfirmTarget(null)}
        onConfirm={() => remove(confirmTarget.id)}
      />
    </div>
  )
}

function SuppliersTab({ store }) {
  const { suppliers, addSupplier, updateSupplier, removeSupplier } = store
  const [form, setForm] = useState({ name: '', contact: '', note: '' })
  const [confirmTarget, setConfirmTarget] = useState(null)
  const [q, setQ] = useState('')

  async function add() {
    if (!form.name.trim()) return
    await addSupplier({ ...form })
    setForm({ name: '', contact: '', note: '' })
  }
  async function remove(id) {
    await removeSupplier(id)
    setConfirmTarget(null)
  }
  async function update(id, field, value) {
    await updateSupplier(id, field, value)
  }

  function onKeyDown(e) { if (e.key === 'Enter') add() }

  const filtered = useMemo(() => {
    if (!q.trim()) return suppliers
    const s = q.trim().toLowerCase()
    return suppliers.filter((sup) => sup.name.toLowerCase().includes(s) || (sup.contact || '').toLowerCase().includes(s))
  }, [suppliers, q])

  return (
    <div>
      <div className="row-form">
        <input placeholder="Поставщик" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} onKeyDown={onKeyDown} autoFocus />
        <input placeholder="Контакты" value={form.contact} onChange={(e) => setForm((f) => ({ ...f, contact: e.target.value }))} onKeyDown={onKeyDown} />
        <input placeholder="Примечание (напр. с кассы)" value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} onKeyDown={onKeyDown} />
        <button className="btn primary" onClick={add}>Добавить</button>
      </div>
      {suppliers.length > 5 && (
        <div className="settings-search">
          <IconSearch />
          <input placeholder="Поиск по поставщикам..." value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      )}
      <div className="table-scroll">
        <table className="data-table">
          <thead><tr><th>Поставщик</th><th>Контакты</th><th>Примечание</th><th></th></tr></thead>
          <tbody>
            {filtered.map((s) => (
              <tr key={s.id}>
                <td><input defaultValue={s.name} onBlur={(e) => e.target.value !== s.name && update(s.id, 'name', e.target.value)} style={{ border: 'none', background: 'transparent', font: 'inherit', width: '100%' }} /></td>
                <td><input defaultValue={s.contact} onBlur={(e) => e.target.value !== s.contact && update(s.id, 'contact', e.target.value)} style={{ border: 'none', background: 'transparent', font: 'inherit', width: '100%' }} /></td>
                <td><input defaultValue={s.note} onBlur={(e) => e.target.value !== s.note && update(s.id, 'note', e.target.value)} style={{ border: 'none', background: 'transparent', font: 'inherit', width: '100%' }} /></td>
                <td><button className="del-link" onClick={() => setConfirmTarget(s)}>удалить</button></td>
              </tr>
            ))}
            {suppliers.length === 0 && <tr><td colSpan={4} style={{ color: 'var(--ink-soft)', textAlign: 'center', padding: 20 }}>Поставщиков пока нет — добавьте первого выше</td></tr>}
            {suppliers.length > 0 && filtered.length === 0 && <tr><td colSpan={4} style={{ color: 'var(--ink-soft)', textAlign: 'center', padding: 20 }}>Ничего не найдено по запросу «{q}»</td></tr>}
          </tbody>
        </table>
      </div>
      <ConfirmDialog
        open={!!confirmTarget}
        title={`Удалить поставщика «${confirmTarget?.name}»?`}
        message="Товары, привязанные к этому поставщику, останутся без поставщика."
        onCancel={() => setConfirmTarget(null)}
        onConfirm={() => remove(confirmTarget.id)}
      />
    </div>
  )
}

const COMMON_UNITS = ['шт', 'кг', 'л', 'упк', 'уп', 'пачка', 'г', 'мл', 'ящик']
const emptyProductForm = { name: '', supplier_id: '', category: '', unit: 'шт', price: '', payment_note: '', hint: '', is_kitchen: false }

function ProductsTab({ store }) {
  const { products, suppliers, addProduct, addProductsBulk, updateProduct, removeProduct } = store
  const [form, setForm] = useState(emptyProductForm)
  const [importStatus, setImportStatus] = useState(null)
  const [confirmTarget, setConfirmTarget] = useState(null)
  const [q, setQ] = useState('')
  const nameInputRef = useRef(null)
  const fileInputRef = useRef(null)

  const categories = useMemo(
    () => [...new Set(products.map((p) => p.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru')),
    [products]
  )
  const units = useMemo(
    () => [...new Set([...COMMON_UNITS, ...products.map((p) => p.unit).filter(Boolean)])],
    [products]
  )
  const supplierById = useMemo(() => Object.fromEntries(suppliers.map((s) => [s.id, s])), [suppliers])

  function handleSupplierChange(supplierId) {
    setForm((f) => ({
      ...f,
      supplier_id: supplierId,
      // Auto-fill the payment note from the supplier's default note so it
      // doesn't need to be retyped for every product — still editable.
      payment_note: f.payment_note || supplierById[supplierId]?.note || f.payment_note,
    }))
  }

  async function add() {
    if (!form.name.trim()) return
    await addProduct({
      ...form,
      supplier_id: form.supplier_id || null,
      price: Number(form.price) || 0,
    })
    setForm(emptyProductForm)
    nameInputRef.current?.focus()
  }
  async function remove(id) {
    await removeProduct(id)
    setConfirmTarget(null)
  }
  async function update(id, field, value) {
    await updateProduct(id, field, value)
  }
  function duplicateToForm(p) {
    setForm({
      name: p.name + ' (копия)',
      supplier_id: p.supplier_id || '',
      category: p.category || '',
      unit: p.unit || 'шт',
      price: p.price ?? '',
      payment_note: p.payment_note || '',
      hint: p.hint || '',
      is_kitchen: !!p.is_kitchen,
    })
    nameInputRef.current?.focus()
    nameInputRef.current?.select()
  }
  function onKeyDown(e) { if (e.key === 'Enter') add() }

  // Bulk import from CSV: name,category,unit,price,supplier,payment_note,hint
  // Lets a large price list be filled in one go instead of typing every
  // product by hand.
  function downloadTemplate() {
    const csv = 'name,category,unit,price,supplier,payment_note,hint\n'
      + 'Салфетки 24*24,Салфетки,шт,124,Карина,оплата с кассы,\n'
      + '"Ведро 0,85л",Супницы пластиковые,уп,8400,TGR,,"К этому ведру нужна отдельная крышка"\n'
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'шаблон_товаров.csv'; a.click()
    URL.revokeObjectURL(url)
  }
  // Proper-ish CSV line splitter: respects double-quoted fields so commas
  // inside a quoted value (e.g. a price note or a decimal like "0,85л")
  // don't break the row into extra columns. Doubled quotes ("") decode to a
  // literal quote, per the usual CSV convention.
  function splitCsvLine(line) {
    const out = []
    let cur = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++ } else { inQuotes = false }
        } else cur += ch
      } else if (ch === '"') {
        inQuotes = true
      } else if (ch === ',') {
        out.push(cur); cur = ''
      } else {
        cur += ch
      }
    }
    out.push(cur)
    return out.map((c) => c.trim())
  }
  function parseCsv(text) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length)
    if (!lines.length) return []
    const rows = lines.map(splitCsvLine)
    const header = rows[0].map((h) => h.toLowerCase())
    return rows.slice(1).map((cols) => Object.fromEntries(header.map((h, i) => [h, cols[i] || ''])))
  }
  async function importCsvFile(file) {
    setImportStatus('Импорт...')
    try {
      const text = await file.text()
      const rows = parseCsv(text)
      const supplierByName = Object.fromEntries(suppliers.map((s) => [s.name.toLowerCase(), s.id]))
      const toInsert = rows
        .filter((r) => r.name && r.name.trim())
        .map((r, i) => ({
          name: r.name.trim(),
          category: r.category || '',
          unit: r.unit || 'шт',
          price: Number(r.price) || 0,
          supplier_id: supplierByName[(r.supplier || '').toLowerCase()] || null,
          payment_note: r.payment_note || '',
          hint: r.hint || '',
          sort_order: products.length + i,
        }))
      if (!toInsert.length) { setImportStatus('В файле не найдено строк с товарами'); return }
      await addProductsBulk(toInsert)
      setImportStatus(`Добавлено товаров: ${toInsert.length}`)
    } catch (err) {
      setImportStatus('Не удалось прочитать файл — проверьте формат CSV')
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
      setTimeout(() => setImportStatus(null), 4000)
    }
  }

  const filtered = useMemo(() => {
    if (!q.trim()) return products
    const s = q.trim().toLowerCase()
    return products.filter((p) =>
      p.name.toLowerCase().includes(s) ||
      (p.category || '').toLowerCase().includes(s) ||
      (supplierById[p.supplier_id]?.name || '').toLowerCase().includes(s)
    )
  }, [products, q, supplierById])

  return (
    <div>
      <div className="row-form">
        <input ref={nameInputRef} placeholder="Товар" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} onKeyDown={onKeyDown} autoFocus />
        <select value={form.supplier_id} onChange={(e) => handleSupplierChange(e.target.value)}>
          <option value="">Поставщик...</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input list="categories-list" placeholder="Категория" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} onKeyDown={onKeyDown} />
        <input list="units-list" placeholder="ед (шт/кг/л)" value={form.unit} onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))} onKeyDown={onKeyDown} />
        <input placeholder="Цена, тг" type="number" inputMode="decimal" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} onKeyDown={onKeyDown} />
        <input placeholder="Примечание к оплате" value={form.payment_note} onChange={(e) => setForm((f) => ({ ...f, payment_note: e.target.value }))} onKeyDown={onKeyDown} />
        <input placeholder="Подсказка (напр. «нужна крышка»)" value={form.hint} onChange={(e) => setForm((f) => ({ ...f, hint: e.target.value }))} onKeyDown={onKeyDown} />
        <label className="kitchen-check">
          <input type="checkbox" checked={form.is_kitchen} onChange={(e) => setForm((f) => ({ ...f, is_kitchen: e.target.checked }))} />
          Кухня
        </label>
        <button className="btn primary" onClick={add}>Добавить товар</button>
      </div>
      <datalist id="categories-list">{categories.map((c) => <option value={c} key={c} />)}</datalist>
      <datalist id="units-list">{units.map((u) => <option value={u} key={u} />)}</datalist>

      <div className="import-row">
        <button className="btn ghost small" onClick={downloadTemplate}>Скачать шаблон CSV</button>
        <button className="btn ghost small" onClick={() => fileInputRef.current?.click()}>Импорт товаров из CSV</button>
        <input ref={fileInputRef} type="file" accept=".csv" hidden onChange={(e) => e.target.files[0] && importCsvFile(e.target.files[0])} />
        {importStatus && <span className="import-status">{importStatus}</span>}
      </div>
      <div className="hint-explainer">
        <IconLink /> Колонка «Подсказка» — необязательная короткая заметка под товаром в списке заказа. Полезна для парных товаров:
        например у ведра укажите «нужна крышка», а у крышки — «подходит к ведру 0,85л».
      </div>
      <div className="hint-explainer">
        <IconLock /> Галочка «Кухня» — товар попадёт в изолированную вкладку «Кухня» (свой закуп,
        свои остатки, своя ревизия, доступ по PIN). Настройте PIN на вкладке «Кухня» в настройках.
      </div>

      {products.length > 6 && (
        <div className="settings-search">
          <IconSearch />
          <input placeholder="Поиск по товарам, категории или поставщику..." value={q} onChange={(e) => setQ(e.target.value)} />
          <span className="settings-search-count">{filtered.length} из {products.length}</span>
        </div>
      )}

      <div className="table-scroll">
        <table className="data-table">
          <thead><tr><th>Товар</th><th>Поставщик</th><th>Категория</th><th>ед</th><th>тг</th><th>Примечание</th><th>Подсказка</th><th>Кухня</th><th></th></tr></thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.id}>
                <td><input defaultValue={p.name} onBlur={(e) => e.target.value !== p.name && update(p.id, 'name', e.target.value)} style={{ border: 'none', background: 'transparent', font: 'inherit', width: '100%' }} /></td>
                <td>
                  <select defaultValue={p.supplier_id || ''} onChange={(e) => update(p.id, 'supplier_id', e.target.value || null)} style={{ border: 'none', background: 'transparent', font: 'inherit' }}>
                    <option value="">—</option>
                    {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </td>
                <td><input list="categories-list" defaultValue={p.category} onBlur={(e) => e.target.value !== p.category && update(p.id, 'category', e.target.value)} style={{ border: 'none', background: 'transparent', font: 'inherit', width: '100%' }} /></td>
                <td><input list="units-list" defaultValue={p.unit} onBlur={(e) => e.target.value !== p.unit && update(p.id, 'unit', e.target.value)} style={{ border: 'none', background: 'transparent', font: 'inherit', width: 56 }} /></td>
                <td><input defaultValue={p.price} type="number" onBlur={(e) => Number(e.target.value) !== p.price && update(p.id, 'price', Number(e.target.value))} style={{ border: 'none', background: 'transparent', font: 'inherit', width: 64 }} /></td>
                <td><input defaultValue={p.payment_note} onBlur={(e) => e.target.value !== p.payment_note && update(p.id, 'payment_note', e.target.value)} style={{ border: 'none', background: 'transparent', font: 'inherit', width: '100%' }} /></td>
                <td><input defaultValue={p.hint} placeholder="—" onBlur={(e) => e.target.value !== p.hint && update(p.id, 'hint', e.target.value)} style={{ border: 'none', background: 'transparent', font: 'inherit', width: '100%' }} /></td>
                <td style={{ textAlign: 'center' }}>
                  <input type="checkbox" defaultChecked={!!p.is_kitchen} onChange={(e) => update(p.id, 'is_kitchen', e.target.checked)} />
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="dup-link" onClick={() => duplicateToForm(p)} title="Заполнить форму данными этого товара, чтобы быстро добавить похожий">дублировать</button>
                  <button className="del-link" onClick={() => setConfirmTarget(p)}>удалить</button>
                </td>
              </tr>
            ))}
            {products.length === 0 && <tr><td colSpan={9} style={{ color: 'var(--ink-soft)', textAlign: 'center', padding: 20 }}>Товаров пока нет — добавьте вручную или импортируйте CSV</td></tr>}
            {products.length > 0 && filtered.length === 0 && <tr><td colSpan={9} style={{ color: 'var(--ink-soft)', textAlign: 'center', padding: 20 }}>Ничего не найдено по запросу «{q}»</td></tr>}
          </tbody>
        </table>
      </div>
      <ConfirmDialog
        open={!!confirmTarget}
        title={`Удалить товар «${confirmTarget?.name}»?`}
        message="Товар исчезнет из списка закупа для всех точек. Это действие нельзя отменить."
        onCancel={() => setConfirmTarget(null)}
        onConfirm={() => remove(confirmTarget.id)}
      />
    </div>
  )
}

function ReportTab({ store }) {
  const { settings, saveSettings } = store
  const [local, setLocal] = useState(settings)
  const [saved, setSaved] = useState(false)

  useEffect(() => setLocal(settings), [settings])

  async function save() {
    await saveSettings(local)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="report-form">
      <div className="field-block">
        <label>Шаблон имени файла</label>
        <input
          value={local.report_filename_template || ''}
          onChange={(e) => setLocal((s) => ({ ...s, report_filename_template: e.target.value }))}
        />
        <div className="field-hint">Доступно: <span className="badge">{'{location}'}</span> <span className="badge">{'{date}'}</span></div>
      </div>
      <div className="field-block">
        <label>Название компании (для PDF и Excel)</label>
        <input
          value={local.company_name || ''}
          onChange={(e) => setLocal((s) => ({ ...s, company_name: e.target.value }))}
          placeholder="Необязательно"
        />
      </div>
      <div className="field-block-actions">
        <button className="btn primary" onClick={save}>Сохранить</button>
        {saved && <span className="save-confirm"><IconCheck /> Сохранено</span>}
      </div>
    </div>
  )
}

// --- Остатки -----------------------------------------------------------
// Shared between the main app (all products) and the isolated Kitchen tab
// (only is_kitchen products) via the `products` prop the caller passes in.
// --- Остатки ---------------------------------------------------------------
// Карточный список с категориями (как на вкладке «Заказ»), плюс/минус
// степпером и авто-сохранением — вместо голой таблицы с мелкими полями
// ввода, которую неудобно листать и заполнять с телефона.
function StockTab({ store, locations, products, title }) {
  const { stockLevels, setStock } = store
  const [locationId, setLocationId] = useState(locations[0]?.id || '')
  const [q, setQ] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [onlyStocked, setOnlyStocked] = useState(false)
  const [collapsed, setCollapsed] = useState({})
  const [savedIds, setSavedIds] = useState({})
  // Optimistic local values so +/- feels instant — the real save to
  // Supabase is debounced (see commit()) and can lag a network round-trip
  // behind, but the Stepper shouldn't wait for that to reflect the tap.
  const [pending, setPending] = useState({})
  const saveTimers = useRef({})

  useEffect(() => {
    if (!locationId && locations.length) setLocationId(locations[0].id)
  }, [locations, locationId])

  useEffect(() => { setPending({}); setSavedIds({}) }, [locationId])

  useEffect(() => () => { Object.values(saveTimers.current).forEach(clearTimeout) }, [])

  const stockByProduct = useMemo(() => {
    const m = new Map()
    for (const s of stockLevels) if (s.location_id === locationId) m.set(s.product_id, Number(s.quantity) || 0)
    return m
  }, [stockLevels, locationId])

  function displayQty(productId) {
    return pending[productId] !== undefined ? pending[productId] : (stockByProduct.get(productId) || 0)
  }

  const filteredBase = useMemo(() => {
    if (!q.trim()) return products
    const s = q.trim().toLowerCase()
    return products.filter((p) => p.name.toLowerCase().includes(s) || (p.category || '').toLowerCase().includes(s))
  }, [products, q])

  const filtered = useMemo(() => {
    if (!onlyStocked) return filteredBase
    return filteredBase.filter((p) => displayQty(p.id) > 0)
  }, [filteredBase, onlyStocked, stockByProduct, pending])

  const categoryOptions = useMemo(() => {
    const counts = new Map()
    for (const p of filtered) {
      const cat = p.category?.trim() || 'Без категории'
      counts.set(cat, (counts.get(cat) || 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [filtered])

  const grouped = useMemo(() => {
    const byCat = new Map()
    for (const p of filtered) {
      const cat = p.category?.trim() || 'Без категории'
      if (categoryFilter && cat !== categoryFilter) continue
      if (!byCat.has(cat)) byCat.set(cat, [])
      byCat.get(cat).push(p)
    }
    return [...byCat.entries()]
  }, [filtered, categoryFilter])

  function toggleCat(cat) { setCollapsed((prev) => ({ ...prev, [cat]: !prev[cat] })) }
  const isFiltering = Boolean(q.trim() || categoryFilter || onlyStocked)
  const allCollapsed = grouped.length > 0 && grouped.every(([cat]) => collapsed[cat])
  function toggleAllCollapsed() {
    const next = {}
    if (!allCollapsed) for (const [cat] of grouped) next[cat] = true
    setCollapsed(next)
  }

  // Local value updates instantly (see displayQty); the write to Supabase
  // is debounced so holding +/- doesn't fire a save per tap — one save
  // ~350ms after the person stops adjusting a given item.
  function commit(productId, value) {
    setPending((prev) => ({ ...prev, [productId]: value }))
    clearTimeout(saveTimers.current[productId])
    const savedLocationId = locationId
    saveTimers.current[productId] = setTimeout(async () => {
      await setStock(savedLocationId, productId, value)
      setSavedIds((prev) => ({ ...prev, [productId]: true }))
      setTimeout(() => setSavedIds((prev) => (prev[productId] ? { ...prev, [productId]: false } : prev)), 1200)
    }, 350)
  }

  if (!locations.length) return <div className="empty-state">Сначала добавьте хотя бы одну точку.</div>
  if (!products.length) return <div className="empty-state">Нет товаров для отображения остатков.</div>

  return (
    <div>
      <div className="panel-head-row">
        <h2>{title || 'Остатки'}</h2>
        <div className="panel-head-actions">
          {grouped.length > 1 && (
            <button className="btn ghost small" onClick={toggleAllCollapsed}>{allCollapsed ? 'Развернуть всё' : 'Свернуть всё'}</button>
          )}
        </div>
      </div>
      <div className="row-form" style={{ marginBottom: 10 }}>
        {locations.length > 1 && (
          <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        )}
        <div className="settings-search" style={{ flex: 1 }}>
          <IconSearch />
          <input placeholder="Поиск товара..." value={q} onChange={(e) => setQ(e.target.value)} />
          {q && <button className="search-clear" onClick={() => setQ('')} aria-label="Очистить поиск"><IconClose /></button>}
        </div>
      </div>
      <div className="chip-row">
        <button className={`chip ${!onlyStocked ? 'active' : ''}`} onClick={() => setOnlyStocked(false)}>Все товары</button>
        <button className={`chip ${onlyStocked ? 'active' : ''}`} onClick={() => setOnlyStocked(true)}>Только с остатком</button>
      </div>
      {categoryOptions.length > 1 && (
        <div className="chip-row">
          <button className={`chip ${!categoryFilter ? 'active' : ''}`} onClick={() => setCategoryFilter('')}>
            Все категории <span className="chip-count">{filtered.length}</span>
          </button>
          {categoryOptions.map(([cat, count]) => (
            <button key={cat} className={`chip ${categoryFilter === cat ? 'active' : ''}`} onClick={() => setCategoryFilter(categoryFilter === cat ? '' : cat)}>
              {cat} <span className="chip-count">{count}</span>
            </button>
          ))}
        </div>
      )}
      <div className="product-list">
        {grouped.length === 0 && (
          <div className="empty-state"><span className="empty-icon"><IconSearch /></span>Ничего не найдено</div>
        )}
        {grouped.map(([cat, list]) => {
          const isOpen = isFiltering || !collapsed[cat]
          const filledCount = list.filter((p) => displayQty(p.id) > 0).length
          return (
            <div className="supplier-group" key={cat}>
              <button type="button" className="supplier-head" onClick={() => toggleCat(cat)} aria-expanded={isOpen}>
                <span aria-hidden="true">{categoryIcon(cat)}</span>
                <span className="supplier-name">{cat}</span>
                <span className="category-count">{list.length}</span>
                {filledCount > 0 && <span className="category-badge">{filledCount} с остатком</span>}
                <span className={`chevron ${isOpen ? 'open' : ''}`}><IconChevron /></span>
              </button>
              {isOpen && (
                <div className="supplier-body">
                  {list.map((p) => {
                    const qty = displayQty(p.id)
                    return (
                      <div className={`product-row ${qty > 0 ? 'in-cart' : ''}`} key={p.id}>
                        <div className="product-info">
                          <div className="name">{p.name}</div>
                          {p.hint && <div className="hint"><IconLink /> {p.hint}</div>}
                        </div>
                        <div className="price"><span className="unit">{p.unit}</span></div>
                        <div className="stock-cell">
                          <Stepper qty={qty} onChange={(v) => commit(p.id, v)} />
                          {savedIds[p.id] && <IconCheck />}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// --- Ревизия -------------------------------------------------------------
// Сверка фактического (посчитанного вручную) остатка с учётным (последним
// сохранённым значением в Остатках). Тот же карточный список с категориями
// и степпером, что и на «Остатках» — степпер по умолчанию показывает
// учтённый остаток, а любое +/- или ручной ввод отмечает товар как
// «посчитанный». Сохранение записывает разницу в историю и переносит
// фактические значения в новый учётный остаток.
function RevisionTab({ store, locations, products, source, title }) {
  const { stockLevels, loadRevisions, saveRevision } = store
  const [locationId, setLocationId] = useState(locations[0]?.id || '')
  const [q, setQ] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [onlyTouched, setOnlyTouched] = useState(false)
  const [collapsed, setCollapsed] = useState({})
  const [actuals, setActuals] = useState({})
  const [note, setNote] = useState('')
  const [history, setHistory] = useState([])
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')

  useEffect(() => {
    if (!locationId && locations.length) setLocationId(locations[0].id)
  }, [locations, locationId])

  useEffect(() => {
    setActuals({})
    setOnlyTouched(false)
    if (locationId) loadRevisions(locationId, source).then(setHistory)
  }, [locationId, source, loadRevisions])

  const stockByProduct = useMemo(() => {
    const m = new Map()
    for (const s of stockLevels) if (s.location_id === locationId) m.set(s.product_id, Number(s.quantity) || 0)
    return m
  }, [stockLevels, locationId])

  function hasActual(productId) {
    const v = actuals[productId]
    return v !== undefined && v !== ''
  }
  function expectedOf(productId) { return stockByProduct.get(productId) || 0 }
  function displayQty(productId) {
    return hasActual(productId) ? Number(actuals[productId]) || 0 : expectedOf(productId)
  }
  function diffOf(productId) {
    return hasActual(productId) ? Number(actuals[productId]) - expectedOf(productId) : 0
  }

  const filteredBase = useMemo(() => {
    if (!q.trim()) return products
    const s = q.trim().toLowerCase()
    return products.filter((p) => p.name.toLowerCase().includes(s) || (p.category || '').toLowerCase().includes(s))
  }, [products, q])

  const filtered = useMemo(() => {
    if (!onlyTouched) return filteredBase
    return filteredBase.filter((p) => hasActual(p.id))
  }, [filteredBase, onlyTouched, actuals])

  const categoryOptions = useMemo(() => {
    const counts = new Map()
    for (const p of filtered) {
      const cat = p.category?.trim() || 'Без категории'
      counts.set(cat, (counts.get(cat) || 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [filtered])

  const grouped = useMemo(() => {
    const byCat = new Map()
    for (const p of filtered) {
      const cat = p.category?.trim() || 'Без категории'
      if (categoryFilter && cat !== categoryFilter) continue
      if (!byCat.has(cat)) byCat.set(cat, [])
      byCat.get(cat).push(p)
    }
    return [...byCat.entries()]
  }, [filtered, categoryFilter])

  function toggleCat(cat) { setCollapsed((prev) => ({ ...prev, [cat]: !prev[cat] })) }
  const isFiltering = Boolean(q.trim() || categoryFilter || onlyTouched)
  const allCollapsed = grouped.length > 0 && grouped.every(([cat]) => collapsed[cat])
  function toggleAllCollapsed() {
    const next = {}
    if (!allCollapsed) for (const [cat] of grouped) next[cat] = true
    setCollapsed(next)
  }

  function setActual(productId, value) {
    setActuals((prev) => ({ ...prev, [productId]: value }))
  }
  function clearActual(productId) {
    setActuals((prev) => {
      if (!(productId in prev)) return prev
      const next = { ...prev }
      delete next[productId]
      return next
    })
  }
  function resetAll() { setActuals({}) }

  const touchedCount = Object.keys(actuals).filter((id) => actuals[id] !== '' && actuals[id] !== undefined).length

  async function finish() {
    const rows = products
      .filter((p) => hasActual(p.id))
      .map((p) => ({
        product_id: p.id,
        product_name: p.name,
        unit: p.unit,
        expected_qty: expectedOf(p.id),
        actual_qty: Number(actuals[p.id]) || 0,
      }))
    if (!rows.length) return
    setBusy(true)
    const locationName = locations.find((l) => l.id === locationId)?.name || ''
    await saveRevision(locationId, locationName, source, rows, note)
    setBusy(false)
    setActuals({})
    setNote('')
    setToast(`Ревизия сохранена: ${rows.length} позиций`)
    setTimeout(() => setToast(''), 3000)
    loadRevisions(locationId, source).then(setHistory)
  }

  if (!locations.length) return <div className="empty-state">Сначала добавьте хотя бы одну точку.</div>
  if (!products.length) return <div className="empty-state">Нет товаров для ревизии.</div>

  return (
    <div>
      <div className="panel-head-row">
        <h2>{title || 'Ревизия'}</h2>
        <div className="panel-head-actions">
          {grouped.length > 1 && (
            <button className="btn ghost small" onClick={toggleAllCollapsed}>{allCollapsed ? 'Развернуть всё' : 'Свернуть всё'}</button>
          )}
          {touchedCount > 0 && (
            <button className="btn ghost small" onClick={resetAll}>Сбросить факт</button>
          )}
        </div>
      </div>
      <div className="hint-explainer">
        <IconClipboard /> Нажимайте +/− или впишите число только у тех товаров, что пересчитываете —
        поле по умолчанию показывает учтённый остаток. Остальные товары останутся без изменений.
        При сохранении разница попадёт в историю, а факт станет новым учётным остатком.
      </div>
      <div className="row-form" style={{ marginBottom: 10 }}>
        {locations.length > 1 && (
          <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        )}
        <div className="settings-search" style={{ flex: 1 }}>
          <IconSearch />
          <input placeholder="Поиск товара..." value={q} onChange={(e) => setQ(e.target.value)} />
          {q && <button className="search-clear" onClick={() => setQ('')} aria-label="Очистить поиск"><IconClose /></button>}
        </div>
      </div>
      <div className="chip-row">
        <button className={`chip ${!onlyTouched ? 'active' : ''}`} onClick={() => setOnlyTouched(false)}>Все товары</button>
        <button className={`chip ${onlyTouched ? 'active' : ''}`} onClick={() => setOnlyTouched(true)}>
          Только посчитанные {touchedCount > 0 && <span className="chip-count">{touchedCount}</span>}
        </button>
      </div>
      {categoryOptions.length > 1 && (
        <div className="chip-row">
          <button className={`chip ${!categoryFilter ? 'active' : ''}`} onClick={() => setCategoryFilter('')}>
            Все категории <span className="chip-count">{filtered.length}</span>
          </button>
          {categoryOptions.map(([cat, count]) => (
            <button key={cat} className={`chip ${categoryFilter === cat ? 'active' : ''}`} onClick={() => setCategoryFilter(categoryFilter === cat ? '' : cat)}>
              {cat} <span className="chip-count">{count}</span>
            </button>
          ))}
        </div>
      )}
      <div className="product-list">
        {grouped.length === 0 && (
          <div className="empty-state"><span className="empty-icon"><IconSearch /></span>Ничего не найдено</div>
        )}
        {grouped.map(([cat, list]) => {
          const isOpen = isFiltering || !collapsed[cat]
          const touchedInCat = list.filter((p) => hasActual(p.id)).length
          return (
            <div className="supplier-group" key={cat}>
              <button type="button" className="supplier-head" onClick={() => toggleCat(cat)} aria-expanded={isOpen}>
                <span aria-hidden="true">{categoryIcon(cat)}</span>
                <span className="supplier-name">{cat}</span>
                <span className="category-count">{list.length}</span>
                {touchedInCat > 0 && <span className="category-badge">{touchedInCat} посчитано</span>}
                <span className={`chevron ${isOpen ? 'open' : ''}`}><IconChevron /></span>
              </button>
              {isOpen && (
                <div className="supplier-body">
                  {list.map((p) => {
                    const expected = expectedOf(p.id)
                    const touched = hasActual(p.id)
                    const diff = diffOf(p.id)
                    return (
                      <div className={`product-row revision-row ${touched ? 'in-cart' : ''}`} key={p.id}>
                        <div className="product-info">
                          <div className="name">{p.name}</div>
                          <div className="revision-expected">Учтено: {expected} {p.unit}</div>
                        </div>
                        <div className={`price ${diff === 0 ? '' : diff > 0 ? 'diff-pos' : 'diff-neg'}`}>
                          {touched ? (diff > 0 ? `+${diff}` : diff) : '—'}
                        </div>
                        <div className="stock-cell">
                          <Stepper qty={displayQty(p.id)} onChange={(v) => setActual(p.id, v)} />
                          {touched && (
                            <button type="button" className="search-clear" title="Отменить факт по этому товару" onClick={() => clearActual(p.id)}>
                              <IconClose />
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div className="row-form" style={{ marginTop: 12 }}>
        <input placeholder="Комментарий к ревизии (необязательно)" value={note} onChange={(e) => setNote(e.target.value)} style={{ flex: 1 }} />
        <button className="btn primary" disabled={!touchedCount || busy} onClick={finish}>
          Сохранить ревизию {touchedCount > 0 && `(${touchedCount})`}
        </button>
      </div>
      {toast && <div className="import-status" style={{ marginTop: 8 }}>{toast}</div>}

      {history.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <h3 style={{ margin: '0 0 10px', fontSize: 14, color: 'var(--ink-soft)' }}>История ревизий</h3>
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th>Дата</th><th>Позиций</th><th>Суммарная разница</th><th>Комментарий</th></tr></thead>
              <tbody>
                {history.map((r) => (
                  <tr key={r.id}>
                    <td>{new Date(r.created_at).toLocaleString('ru-RU')}</td>
                    <td>{r.items_count}</td>
                    <td className={r.total_diff === 0 ? '' : r.total_diff > 0 ? 'diff-pos' : 'diff-neg'}>
                      {r.total_diff > 0 ? `+${r.total_diff}` : r.total_diff}
                    </td>
                    <td>{r.note || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// --- Кухня ---------------------------------------------------------------
// Isolated mini-app: own top bar, own cart, only is_kitchen products, and
// only Заказ/Остатки/Ревизия — no Настройки, no other products, no
// suppliers list beyond what's needed to place the kitchen's own order.
// Isolated per-точка mini-app. `location` is fixed by the PIN that unlocked
// it (see PinModal / App.openKitchen) — there is deliberately no dropdown to
// switch to another точка here, so one точка can never see another's data.
function KitchenApp({ store, theme, toggleTheme, location, onExit }) {
  const { suppliers, products, locationProducts, settings } = store
  const [sub, setSub] = useState('order')
  const locationId = location.id
  const [query, setQuery] = useState('')
  const [cart, setCart] = useState([])
  const [lastOrderInfo, setLastOrderInfo] = useState(null)
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)

  useEffect(() => {
    setCart([])
    setLastOrderInfo(null)
    if (locationId) store.loadLastOrder(locationId, 'kitchen').then(setLastOrderInfo)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId])

  function showToast(text, type = 'success') {
    setToast({ text, type })
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2600)
  }

  const supplierById = useMemo(() => Object.fromEntries(suppliers.map((s) => [s.id, s])), [suppliers])
  const currentLocation = location

  const kitchenProducts = useMemo(() => {
    const scoped = locationProducts.filter((lp) => lp.location_id === locationId)
    const hasScope = scoped.length > 0
    const scopedIds = new Set(scoped.map((lp) => lp.product_id))
    const overrideById = Object.fromEntries(scoped.map((lp) => [lp.product_id, lp.price_override]))
    const maxQtyById = Object.fromEntries(scoped.map((lp) => [lp.product_id, lp.max_qty]))
    return products
      .filter((p) => p.is_kitchen)
      .filter((p) => (hasScope ? scopedIds.has(p.id) : true))
      .map((p) => ({
        ...p,
        effective_price: overrideById[p.id] != null ? overrideById[p.id] : p.price,
        max_qty: maxQtyById[p.id] != null ? maxQtyById[p.id] : null,
      }))
  }, [products, locationProducts, locationId])

  const cartById = useMemo(() => Object.fromEntries(cart.map((it) => [it.product_id, it])), [cart])

  const visibleProducts = useMemo(() => {
    if (!query.trim()) return kitchenProducts
    const q = query.trim().toLowerCase()
    return kitchenProducts.filter((p) => p.name.toLowerCase().includes(q) || (p.category || '').toLowerCase().includes(q))
  }, [kitchenProducts, query])

  function setQty(product, qty) {
    let clamped = qty
    if (product.max_qty != null && clamped > product.max_qty) {
      clamped = product.max_qty
      showToast(`Лимит по этой точке: ${product.max_qty} ${product.unit}`, 'info')
    }
    qty = clamped
    const sup = supplierById[product.supplier_id]
    setCart((prev) => {
      const idx = prev.findIndex((it) => it.product_id === product.id)
      if (qty <= 0) {
        if (idx >= 0) return prev.filter((it) => it.product_id !== product.id)
        return prev
      }
      const row = {
        product_id: product.id,
        supplier_id: product.supplier_id,
        supplier_name: sup?.name || 'Без поставщика',
        supplier_contact: sup?.contact || '',
        product_name: product.name,
        unit: product.unit,
        price: product.effective_price,
        payment_note: product.payment_note || sup?.note || '',
        quantity: qty,
      }
      if (idx >= 0) { const next = [...prev]; next[idx] = row; return next }
      return [...prev, row]
    })
  }

  function clearCart() { setCart([]) }

  async function repeatLastOrder() {
    if (!lastOrderInfo) { showToast('Прошлых закупов кухни по этой точке не найдено', 'info'); return }
    setCart(lastOrderInfo.items)
    showToast('Прошлый закуп кухни загружен', 'info')
  }

  const grandTotal = cart.reduce((s, it) => s + it.quantity * it.price, 0)
  const groupedCart = useMemo(() => {
    const map = new Map()
    for (const it of cart) {
      if (!map.has(it.supplier_name)) map.set(it.supplier_name, [])
      map.get(it.supplier_name).push(it)
    }
    return [...map.entries()]
  }, [cart])

  async function handleExport(kind) {
    if (!cart.length) return
    const { buildFilename, exportExcel, exportPDF } = await import('./lib/report')
    const filename = buildFilename(settings.report_filename_template, { locationName: currentLocation?.name ? `${currentLocation.name}-Кухня` : 'Кухня' })
    const payload = { items: cart, locationName: currentLocation?.name ? `${currentLocation.name} (Кухня)` : 'Кухня', filename, companyName: settings.company_name }
    if (kind === 'excel') await exportExcel(payload)
    else exportPDF(payload)
  }

  function sendSupplierWhatsApp(items) {
    const digits = phoneToWaDigits(items[0]?.supplier_contact)
    const text = buildSupplierWaMessage(currentLocation?.name ? `${currentLocation.name}, Кухня` : 'Кухня', items)
    window.open(`https://wa.me/${digits}?text=${encodeURIComponent(text)}`, '_blank', 'noopener')
  }

  async function sendSupplierPdfWhatsApp(items) {
    const { buildFilename, exportPDF } = await import('./lib/report')
    const filename = buildFilename(settings.report_filename_template, { locationName: currentLocation?.name ? `${currentLocation.name}-Кухня` : 'Кухня' })
    const file = exportPDF({ items, locationName: currentLocation?.name ? `${currentLocation.name} (Кухня)` : 'Кухня', filename, companyName: settings.company_name, output: 'file' })
    const digits = phoneToWaDigits(items[0]?.supplier_contact)
    const text = buildSupplierWaMessage(currentLocation?.name ? `${currentLocation.name}, Кухня` : 'Кухня', items)
    const result = await sharePdfToWhatsApp(file, text, digits)
    if (result === 'shared') showToast('Готово — выберите WhatsApp и отправьте', 'success')
    else if (result === 'downloaded') showToast('PDF скачан, WhatsApp открыт — приложите файл', 'info')
  }

  async function finishOrder() {
    if (!cart.length) return
    if (supabaseReady) {
      const { data: order } = await supabase
        .from('orders')
        .insert({ location_id: locationId, status: 'finished', source: 'kitchen', finished_at: new Date().toISOString() })
        .select()
        .single()
      if (order) {
        const rows = cart.map((it, i) => ({ order_id: order.id, ...it, sort_order: i }))
        await supabase.from('order_items').insert(rows)
      }
    }
    await handleExport('excel')
    showToast('Закуп кухни завершён и сохранён', 'success')
    clearCart()
  }

  return (
    <div className="app-shell kitchen-shell">
      <div className="topbar">
        <div className="brand"><span className="dot">●</span> Кухня</div>
        <div className="kitchen-location-badge" title="Вход выполнен по PIN этой точки — переключиться на другую отсюда нельзя">
          <IconLocation /> {location.name}
        </div>
        <nav>
          <button className={`tab-btn ${sub === 'order' ? 'active' : ''}`} onClick={() => setSub('order')}>Заказ</button>
          <button className={`tab-btn ${sub === 'stock' ? 'active' : ''}`} onClick={() => setSub('stock')}>Остатки</button>
          <button className={`tab-btn ${sub === 'revision' ? 'active' : ''}`} onClick={() => setSub('revision')}>Ревизия</button>
        </nav>
        <button type="button" className="theme-toggle" onClick={toggleTheme} aria-label="Переключить тему">
          {theme === 'dark' ? <IconSun /> : <IconMoon />}
        </button>
        <button type="button" className="btn ghost small" onClick={onExit}><IconLock /> Выйти</button>
      </div>

      {sub === 'order' ? (
        <div className="main">
          <div className="panel">
            <div className="panel-head-row">
              <h2>Товары {visibleProducts.length > 0 && <span className="category-count">{visibleProducts.length}</span>}</h2>
              {lastOrderInfo && (
                <button className="btn ghost small" onClick={repeatLastOrder}><IconRepeat /> Повторить прошлый закуп</button>
              )}
            </div>
            <div className="search-row">
              <span className="search-icon"><IconSearch /></span>
              <input placeholder="Поиск товара..." value={query} onChange={(e) => setQuery(e.target.value)} />
              {query && <button className="search-clear" onClick={() => setQuery('')} aria-label="Очистить поиск"><IconClose /></button>}
            </div>
            <div className="product-list">
              {visibleProducts.length === 0 && (
                <div className="empty-state">
                  <span className="empty-icon"><IconSearch /></span>
                  Кухонных товаров пока нет. Отметьте нужные товары галочкой «Кухня» в Настройках → Товары.
                </div>
              )}
              {visibleProducts.map((p) => {
                const inCart = cartById[p.id]
                const qty = inCart ? inCart.quantity : 0
                return (
                  <div className={`product-row ${qty > 0 ? 'in-cart' : ''}`} key={p.id}>
                    <div className="product-info">
                      <div className="name">{categoryIcon(p.category)} {p.name}</div>
                      {p.hint && <div className="hint"><IconLink /> {p.hint}</div>}
                    </div>
                    <div className="price">{money(p.effective_price)} ₸<span className="unit">/{p.unit}</span></div>
                    {qty > 0 ? <Stepper qty={qty} onChange={(v) => setQty(p, v)} /> : (
                      <button className="add-btn" onClick={() => setQty(p, 1)} aria-label="Добавить">+</button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
          <div className="ticket">
            <div className="ticket-head">
              <h2>{currentLocation?.name || 'Точка не выбрана'} · Кухня</h2>
              <div className="sub">{cart.length ? `${cart.length} позиций` : 'Список пуст'}</div>
            </div>
            <div className="ticket-body">
              {groupedCart.length === 0 && <div className="ticket-empty">Добавьте товары слева.</div>}
              {groupedCart.map(([supplierName, items]) => (
                <div className="ticket-group" key={supplierName}>
                  <div className="ticket-group-head">
                    <div className="supplier-name">{supplierName}</div>
                    <div className="ticket-group-actions">
                      {items[0]?.supplier_contact && (
                        <button type="button" className="wa-btn" onClick={() => sendSupplierWhatsApp(items)}><IconWhatsApp /> Текст</button>
                      )}
                      <button type="button" className="wa-btn" onClick={() => sendSupplierPdfWhatsApp(items)}><IconWhatsApp /> PDF</button>
                    </div>
                  </div>
                  {items.map((it) => (
                    <div className="ticket-item" key={it.product_id}>
                      <span className="ti-name">{it.product_name}</span>
                      <Stepper size="sm" qty={it.quantity} onChange={(v) => setQty({ id: it.product_id, unit: it.unit, max_qty: kitchenProducts.find((p) => p.id === it.product_id)?.max_qty, supplier_id: it.supplier_id, effective_price: it.price, payment_note: it.payment_note, name: it.product_name }, v)} />
                      <span className="sum">{money(it.quantity * it.price)} ₸</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div className="ticket-foot">
              <div className="ticket-total"><span>Итого</span><span>{money(grandTotal)} ₸</span></div>
              <div className="ticket-actions">
                <button className="btn" disabled={!cart.length} onClick={() => handleExport('pdf')}>PDF</button>
                <button className="btn" disabled={!cart.length} onClick={() => handleExport('excel')}>Excel</button>
              </div>
              <div className="ticket-actions" style={{ marginTop: 8 }}>
                <button className="btn" disabled={!cart.length} onClick={clearCart}>Очистить</button>
                <button className="btn primary" disabled={!cart.length} onClick={finishOrder}>Завершить закуп</button>
              </div>
            </div>
          </div>
        </div>
      ) : sub === 'stock' ? (
        <div className="main" style={{ gridTemplateColumns: '1fr' }}>
          <div className="panel">
            <StockTab store={store} locations={[location]} products={products.filter((p) => p.is_kitchen)} title="Остатки кухни" />
          </div>
        </div>
      ) : (
        <div className="main" style={{ gridTemplateColumns: '1fr' }}>
          <div className="panel">
            <RevisionTab store={store} locations={[location]} products={products.filter((p) => p.is_kitchen)} source="kitchen" title="Ревизия кухни" />
          </div>
        </div>
      )}

      {toast && (
        <div className={`toast toast-${toast.type}`}>
          <span className="toast-icon">{toast.type === 'success' ? <IconCheck /> : <IconInfo />}</span>
          <span className="toast-text">{toast.text}</span>
        </div>
      )}
    </div>
  )
}
