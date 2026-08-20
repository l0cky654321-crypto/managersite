import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { supabase, supabaseReady } from './supabaseClient'

const DEMO = {
  locations: [
    { id: 'demo-afro', name: 'AFRO' },
    { id: 'demo-karina', name: 'Karina' },
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
  const [settings, setSettings] = useState({ report_filename_template: 'ЗАКУП_{location}_{date}', company_name: '' })
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
    const [loc, sup, prod, lp, st] = await Promise.all([
      supabase.from('locations').select('*').order('sort_order').order('name'),
      supabase.from('suppliers').select('*').order('sort_order').order('name'),
      supabase.from('products').select('*').eq('is_archived', false).order('sort_order').order('name'),
      supabase.from('location_products').select('*'),
      supabase.from('app_settings').select('*').eq('id', 1).maybeSingle(),
    ])
    setLocations(loc.data || [])
    setSuppliers(sup.data || [])
    setProducts(prod.data || [])
    setLocationProducts(lp.data || [])
    if (st.data) setSettings(st.data)
    setLoading(false)
  }, [])

  useEffect(() => { reload() }, [reload])

  const loadLastOrder = useCallback(async (locationId) => {
    if (!supabaseReady || !locationId) return null
    const { data: order } = await supabase
      .from('orders')
      .select('*')
      .eq('location_id', locationId)
      .eq('status', 'finished')
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
  const loadFrequentProducts = useCallback(async (locationId) => {
    if (!supabaseReady || !locationId) return []
    const { data, error } = await supabase
      .from('order_items')
      .select('product_id, orders!inner(location_id, status, finished_at)')
      .eq('orders.location_id', locationId)
      .eq('orders.status', 'finished')
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

  return {
    locations, suppliers, products, locationProducts, settings, loading, reload, setSettings, loadLastOrder, loadFrequentProducts,
    addLocation, updateLocation, removeLocation,
    addSupplier, updateSupplier, removeSupplier,
    addProduct, addProductsBulk, updateProduct, removeProduct,
    saveSettings,
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
    const list = products.filter((p) => (hasScope ? scopedIds.has(p.id) : true))
    return list.map((p) => ({
      ...p,
      effective_price: overrideById[p.id] != null ? overrideById[p.id] : p.price,
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

  function toggleTheme() {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
  }

  async function finishOrder() {
    if (!cart.length) return
    if (supabaseReady) {
      const { data: order } = await supabase
        .from('orders')
        .insert({ location_id: locationId, status: 'finished', finished_at: new Date().toISOString() })
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
          <button className={`tab-btn ${view === 'settings' ? 'active' : ''}`} onClick={() => setView('settings')}>Настройки</button>
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
                    {items[0]?.supplier_contact && (
                      <button
                        type="button"
                        className="wa-btn"
                        onClick={() => sendSupplierWhatsApp(items)}
                        title={`Отправить заказ «${supplierName}» в WhatsApp`}
                      >
                        <IconWhatsApp /> WhatsApp
                      </button>
                    )}
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
                <button className="btn" disabled={!cart.length} onClick={clearCart}>Очистить</button>
                <button className="btn primary" disabled={!cart.length} onClick={finishOrder}>Завершить закуп</button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <Settings store={store} />
      )}

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
        {tab === 'report' && <ReportTab store={store} />}
      </div>
    </div>
  )
}

function LocationsTab({ store }) {
  const { locations, addLocation, updateLocation, removeLocation } = store
  const [name, setName] = useState('')
  const [confirmTarget, setConfirmTarget] = useState(null)

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

  return (
    <div>
      <div className="row-form">
        <input placeholder="Название точки (напр. AFRO)" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} autoFocus />
        <button className="btn primary" onClick={add}>Добавить точку</button>
      </div>
      <div className="table-scroll">
        <table className="data-table">
          <thead><tr><th>Название</th><th></th></tr></thead>
          <tbody>
            {locations.map((l) => (
              <tr key={l.id}>
                <td><input defaultValue={l.name} onBlur={(e) => e.target.value !== l.name && rename(l.id, e.target.value)} style={{ border: 'none', background: 'transparent', font: 'inherit', width: '100%' }} /></td>
                <td><button className="del-link" onClick={() => setConfirmTarget(l)}>удалить</button></td>
              </tr>
            ))}
            {locations.length === 0 && <tr><td colSpan={2} style={{ color: 'var(--ink-soft)', textAlign: 'center', padding: 20 }}>Точек пока нет — добавьте первую выше</td></tr>}
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
const emptyProductForm = { name: '', supplier_id: '', category: '', unit: 'шт', price: '', payment_note: '', hint: '' }

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

      {products.length > 6 && (
        <div className="settings-search">
          <IconSearch />
          <input placeholder="Поиск по товарам, категории или поставщику..." value={q} onChange={(e) => setQ(e.target.value)} />
          <span className="settings-search-count">{filtered.length} из {products.length}</span>
        </div>
      )}

      <div className="table-scroll">
        <table className="data-table">
          <thead><tr><th>Товар</th><th>Поставщик</th><th>Категория</th><th>ед</th><th>тг</th><th>Примечание</th><th>Подсказка</th><th></th></tr></thead>
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
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="dup-link" onClick={() => duplicateToForm(p)} title="Заполнить форму данными этого товара, чтобы быстро добавить похожий">дублировать</button>
                  <button className="del-link" onClick={() => setConfirmTarget(p)}>удалить</button>
                </td>
              </tr>
            ))}
            {products.length === 0 && <tr><td colSpan={8} style={{ color: 'var(--ink-soft)', textAlign: 'center', padding: 20 }}>Товаров пока нет — добавьте вручную или импортируйте CSV</td></tr>}
            {products.length > 0 && filtered.length === 0 && <tr><td colSpan={8} style={{ color: 'var(--ink-soft)', textAlign: 'center', padding: 20 }}>Ничего не найдено по запросу «{q}»</td></tr>}
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
