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
    { id: 'p5', supplier_id: 's2', name: 'Ведро 850мл, 120шт', category: 'Одноразовая посуда', unit: 'упк', price: 1900, payment_note: '' },
  ],
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
      setLocations(DEMO.locations)
      setSuppliers(DEMO.suppliers)
      setProducts(DEMO.products)
      setLocationProducts([])
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

  return { locations, suppliers, products, locationProducts, settings, loading, reload, setSettings, loadLastOrder }
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
  const toastTimer = useRef(null)
  const ticketRef = useRef(null)

  useEffect(() => {
    if (!locationId && locations.length) setLocationId(locations[0].id)
  }, [locations, locationId])

  useEffect(() => {
    setLastOrderInfo(null)
    setCategoryFilter('')
    setCollapsed({})
    if (locationId) store.loadLastOrder(locationId).then((res) => setLastOrderInfo(res))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId])

  function showToast(text, type = 'success') {
    setToast({ text, type })
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2600)
  }

  const cart = carts[locationId] || []
  const cartById = useMemo(() => Object.fromEntries(cart.map((it) => [it.product_id, it])), [cart])

  const supplierById = useMemo(() => Object.fromEntries(suppliers.map((s) => [s.id, s])), [suppliers])

  const visibleProducts = useMemo(() => {
    const scoped = locationProducts.filter((lp) => lp.location_id === locationId)
    const hasScope = scoped.length > 0
    const scopedIds = new Set(scoped.map((lp) => lp.product_id))
    const overrideById = Object.fromEntries(scoped.map((lp) => [lp.product_id, lp.price_override]))

    let list = products.filter((p) => (hasScope ? scopedIds.has(p.id) : true))
    if (query.trim()) {
      const q = query.trim().toLowerCase()
      list = list.filter((p) => {
        const sup = supplierById[p.supplier_id]
        return (
          p.name.toLowerCase().includes(q) ||
          (p.category || '').toLowerCase().includes(q) ||
          (sup?.name || '').toLowerCase().includes(q)
        )
      })
    }
    return list.map((p) => ({
      ...p,
      effective_price: overrideById[p.id] != null ? overrideById[p.id] : p.price,
    }))
  }, [products, locationProducts, locationId, query, supplierById])

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
      </div>

      {!supabaseReady && (
        <div className="notice">
          Supabase не подключён — работает демо-режим (данные не сохраняются). Заполните <code>.env</code> по образцу <code>.env.example</code> и подключите проект Supabase (см. README).
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
                <div className="empty-state">Ничего не найдено. Добавьте товары в «Настройки → Товары».</div>
              )}
              {categoryFilter && displayedGroups.length === 0 && (
                <div className="empty-state">В этой категории нет товаров для этой точки.</div>
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
                  <div className="supplier-name">{supplierName}</div>
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
          <span className="toast-icon">{toast.type === 'success' ? <IconCheck /> : <IconInfo />}</span>
          {toast.text}
        </div>
      )}

      <div className="footer-note">Данные хранятся в Supabase · Отчёты формируются на устройстве, ничего не отправляется на сторонние серверы</div>
    </div>
  )
}

function ConfirmDialog({ open, title, message, confirmLabel = 'Удалить', onCancel, onConfirm }) {
  if (!open) return null
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
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
  const { locations, reload } = store
  const [name, setName] = useState('')
  const [confirmTarget, setConfirmTarget] = useState(null)

  async function add() {
    if (!name.trim()) return
    if (supabaseReady) await supabase.from('locations').insert({ name: name.trim(), sort_order: locations.length })
    setName('')
    reload()
  }
  async function remove(id) {
    if (supabaseReady) await supabase.from('locations').delete().eq('id', id)
    setConfirmTarget(null)
    reload()
  }
  async function rename(id, value) {
    if (supabaseReady) await supabase.from('locations').update({ name: value }).eq('id', id)
    reload()
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
  const { suppliers, reload } = store
  const [form, setForm] = useState({ name: '', contact: '', note: '' })
  const [confirmTarget, setConfirmTarget] = useState(null)
  const [q, setQ] = useState('')

  async function add() {
    if (!form.name.trim()) return
    if (supabaseReady) await supabase.from('suppliers').insert({ ...form, sort_order: suppliers.length })
    setForm({ name: '', contact: '', note: '' })
    reload()
  }
  async function remove(id) {
    if (supabaseReady) await supabase.from('suppliers').delete().eq('id', id)
    setConfirmTarget(null)
    reload()
  }
  async function update(id, field, value) {
    if (supabaseReady) await supabase.from('suppliers').update({ [field]: value }).eq('id', id)
    reload()
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
const emptyProductForm = { name: '', supplier_id: '', category: '', unit: 'шт', price: '', payment_note: '' }

function ProductsTab({ store }) {
  const { products, suppliers, reload } = store
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
    if (supabaseReady) {
      await supabase.from('products').insert({
        ...form,
        supplier_id: form.supplier_id || null,
        price: Number(form.price) || 0,
        sort_order: products.length,
      })
    }
    setForm(emptyProductForm)
    nameInputRef.current?.focus()
    reload()
  }
  async function remove(id) {
    if (supabaseReady) await supabase.from('products').delete().eq('id', id)
    setConfirmTarget(null)
    reload()
  }
  async function update(id, field, value) {
    if (supabaseReady) await supabase.from('products').update({ [field]: value }).eq('id', id)
    reload()
  }
  function duplicateToForm(p) {
    setForm({
      name: p.name + ' (копия)',
      supplier_id: p.supplier_id || '',
      category: p.category || '',
      unit: p.unit || 'шт',
      price: p.price ?? '',
      payment_note: p.payment_note || '',
    })
    nameInputRef.current?.focus()
    nameInputRef.current?.select()
  }
  function onKeyDown(e) { if (e.key === 'Enter') add() }

  // Bulk import from CSV: name,category,unit,price,supplier,payment_note
  // Lets a large price list be filled in one go instead of typing every
  // product by hand.
  function downloadTemplate() {
    const csv = 'name,category,unit,price,supplier,payment_note\nСалфетки 24*24,Салфетки,шт,124,Карина,оплата с кассы\n'
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'шаблон_товаров.csv'; a.click()
    URL.revokeObjectURL(url)
  }
  function parseCsv(text) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length)
    if (!lines.length) return []
    const rows = lines.map((line) => line.split(',').map((c) => c.trim().replace(/^"|"$/g, '')))
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
          sort_order: products.length + i,
        }))
      if (!toInsert.length) { setImportStatus('В файле не найдено строк с товарами'); return }
      if (supabaseReady) await supabase.from('products').insert(toInsert)
      setImportStatus(`Добавлено товаров: ${toInsert.length}`)
      reload()
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

      {products.length > 6 && (
        <div className="settings-search">
          <IconSearch />
          <input placeholder="Поиск по товарам, категории или поставщику..." value={q} onChange={(e) => setQ(e.target.value)} />
          <span className="settings-search-count">{filtered.length} из {products.length}</span>
        </div>
      )}

      <div className="table-scroll">
        <table className="data-table">
          <thead><tr><th>Товар</th><th>Поставщик</th><th>Категория</th><th>ед</th><th>тг</th><th>Примечание</th><th></th></tr></thead>
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
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="dup-link" onClick={() => duplicateToForm(p)} title="Заполнить форму данными этого товара, чтобы быстро добавить похожий">дублировать</button>
                  <button className="del-link" onClick={() => setConfirmTarget(p)}>удалить</button>
                </td>
              </tr>
            ))}
            {products.length === 0 && <tr><td colSpan={7} style={{ color: 'var(--ink-soft)', textAlign: 'center', padding: 20 }}>Товаров пока нет — добавьте вручную или импортируйте CSV</td></tr>}
            {products.length > 0 && filtered.length === 0 && <tr><td colSpan={7} style={{ color: 'var(--ink-soft)', textAlign: 'center', padding: 20 }}>Ничего не найдено по запросу «{q}»</td></tr>}
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
  const { settings, setSettings, reload } = store
  const [local, setLocal] = useState(settings)
  const [saved, setSaved] = useState(false)

  useEffect(() => setLocal(settings), [settings])

  async function save() {
    if (supabaseReady) await supabase.from('app_settings').update(local).eq('id', 1)
    setSettings(local)
    reload()
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
