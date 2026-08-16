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
  const [carts, setCarts] = useState({}) // { [locationId]: [items] }
  const [lastOrderInfo, setLastOrderInfo] = useState(null)
  const [repeatBusy, setRepeatBusy] = useState(false)
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)

  useEffect(() => {
    if (!locationId && locations.length) setLocationId(locations[0].id)
  }, [locations, locationId])

  useEffect(() => {
    setLastOrderInfo(null)
    if (locationId) store.loadLastOrder(locationId).then((res) => setLastOrderInfo(res))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId])

  function showToast(text) {
    setToast(text)
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

  // Products grouped Поставщик -> Категория -> Товары, always fully expanded.
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

  const totalProductCount = visibleProducts.length

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
    if (!res) { showToast('Прошлых закупов по этой точке не найдено'); return }
    if (cart.length && !window.confirm('Текущий список будет заменён товарами прошлого закупа. Продолжить?')) return
    setCarts((prev) => ({ ...prev, [locationId]: res.items }))
    showToast('Прошлый закуп загружен — проверьте количества')
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
    if (kind === 'excel') exportExcel(payload)
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
    showToast('Закуп завершён и сохранён')
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
        <div className="loading-state"><div className="spinner" /> Загрузка данных…</div>
      ) : view === 'order' ? (
        <div className="main">
          <div className="panel">
            <div className="panel-head-row">
              <h2>Товары {totalProductCount > 0 && <span className="category-count">{totalProductCount}</span>}</h2>
              <div className="panel-head-actions">
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
            <div className="product-list">
              {visibleProducts.length === 0 && (
                <div className="empty-state">Ничего не найдено. Добавьте товары в «Настройки → Товары».</div>
              )}
              {groupedBySupplier.map((sup) => {
                const inCartCountSupplier = sup.categories.reduce(
                  (n, [, list]) => n + list.filter((p) => cartById[p.id]).length,
                  0
                )
                return (
                  <div className="supplier-group" key={sup.supplierId}>
                    <div className="supplier-head">
                      <IconTruck />
                      <span className="supplier-name">{sup.supplierName}</span>
                      <span className="category-count">{sup.total}</span>
                      {inCartCountSupplier > 0 && <span className="category-badge">{inCartCountSupplier} в списке</span>}
                    </div>
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
                  </div>
                )
              })}
            </div>
          </div>

          <div className="ticket">
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

      {toast && <div className="toast">{toast}</div>}

      <div className="footer-note">Данные хранятся в Supabase · Отчёты формируются на устройстве, ничего не отправляется на сторонние серверы</div>
    </div>
  )
}

function Settings({ store }) {
  const [tab, setTab] = useState('locations')
  return (
    <div className="main" style={{ gridTemplateColumns: '1fr' }}>
      <div className="panel">
        <nav style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
          {[
            ['locations', 'Точки'],
            ['suppliers', 'Поставщики'],
            ['products', 'Товары'],
            ['report', 'Отчёт'],
          ].map(([k, label]) => (
            <button key={k} className={`tab-btn ${tab === k ? 'active' : ''}`} style={{ background: tab === k ? 'var(--ink)' : 'transparent', color: tab === k ? '#fff' : 'var(--ink-soft)' }} onClick={() => setTab(k)}>{label}</button>
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

  async function add() {
    if (!name.trim()) return
    if (supabaseReady) await supabase.from('locations').insert({ name: name.trim(), sort_order: locations.length })
    setName('')
    reload()
  }
  async function remove(id) {
    if (supabaseReady) await supabase.from('locations').delete().eq('id', id)
    reload()
  }
  async function rename(id, value) {
    if (supabaseReady) await supabase.from('locations').update({ name: value }).eq('id', id)
    reload()
  }

  return (
    <div>
      <div className="row-form">
        <input placeholder="Название точки (напр. AFRO)" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button className="btn primary" onClick={add}>Добавить точку</button>
      </div>
      <table className="data-table">
        <thead><tr><th>Название</th><th></th></tr></thead>
        <tbody>
          {locations.map((l) => (
            <tr key={l.id}>
              <td><input defaultValue={l.name} onBlur={(e) => e.target.value !== l.name && rename(l.id, e.target.value)} style={{ border: 'none', background: 'transparent', font: 'inherit', width: '100%' }} /></td>
              <td><button className="del-link" onClick={() => remove(l.id)}>удалить</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SuppliersTab({ store }) {
  const { suppliers, reload } = store
  const [form, setForm] = useState({ name: '', contact: '', note: '' })

  async function add() {
    if (!form.name.trim()) return
    if (supabaseReady) await supabase.from('suppliers').insert({ ...form, sort_order: suppliers.length })
    setForm({ name: '', contact: '', note: '' })
    reload()
  }
  async function remove(id) {
    if (supabaseReady) await supabase.from('suppliers').delete().eq('id', id)
    reload()
  }
  async function update(id, field, value) {
    if (supabaseReady) await supabase.from('suppliers').update({ [field]: value }).eq('id', id)
    reload()
  }

  return (
    <div>
      <div className="row-form">
        <input placeholder="Поставщик" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        <input placeholder="Контакты" value={form.contact} onChange={(e) => setForm((f) => ({ ...f, contact: e.target.value }))} />
        <input placeholder="Примечание (напр. с кассы)" value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
        <button className="btn primary" onClick={add}>Добавить</button>
      </div>
      <table className="data-table">
        <thead><tr><th>Поставщик</th><th>Контакты</th><th>Примечание</th><th></th></tr></thead>
        <tbody>
          {suppliers.map((s) => (
            <tr key={s.id}>
              <td><input defaultValue={s.name} onBlur={(e) => e.target.value !== s.name && update(s.id, 'name', e.target.value)} style={{ border: 'none', background: 'transparent', font: 'inherit', width: '100%' }} /></td>
              <td><input defaultValue={s.contact} onBlur={(e) => e.target.value !== s.contact && update(s.id, 'contact', e.target.value)} style={{ border: 'none', background: 'transparent', font: 'inherit', width: '100%' }} /></td>
              <td><input defaultValue={s.note} onBlur={(e) => e.target.value !== s.note && update(s.id, 'note', e.target.value)} style={{ border: 'none', background: 'transparent', font: 'inherit', width: '100%' }} /></td>
              <td><button className="del-link" onClick={() => remove(s.id)}>удалить</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ProductsTab({ store }) {
  const { products, suppliers, reload } = store
  const [form, setForm] = useState({ name: '', supplier_id: '', category: '', unit: 'шт', price: '', payment_note: '' })

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
    setForm({ name: '', supplier_id: '', category: '', unit: 'шт', price: '', payment_note: '' })
    reload()
  }
  async function remove(id) {
    if (supabaseReady) await supabase.from('products').delete().eq('id', id)
    reload()
  }
  async function update(id, field, value) {
    if (supabaseReady) await supabase.from('products').update({ [field]: value }).eq('id', id)
    reload()
  }

  return (
    <div>
      <div className="row-form">
        <input placeholder="Товар" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        <select value={form.supplier_id} onChange={(e) => setForm((f) => ({ ...f, supplier_id: e.target.value }))}>
          <option value="">Поставщик...</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input placeholder="Категория" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} />
        <input placeholder="ед (шт/кг/л)" value={form.unit} onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))} />
        <input placeholder="Цена, тг" type="number" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} />
        <button className="btn primary" onClick={add}>Добавить товар</button>
      </div>
      <table className="data-table">
        <thead><tr><th>Товар</th><th>Поставщик</th><th>Категория</th><th>ед</th><th>тг</th><th></th></tr></thead>
        <tbody>
          {products.map((p) => (
            <tr key={p.id}>
              <td><input defaultValue={p.name} onBlur={(e) => e.target.value !== p.name && update(p.id, 'name', e.target.value)} style={{ border: 'none', background: 'transparent', font: 'inherit', width: '100%' }} /></td>
              <td>
                <select defaultValue={p.supplier_id || ''} onChange={(e) => update(p.id, 'supplier_id', e.target.value || null)} style={{ border: 'none', background: 'transparent', font: 'inherit' }}>
                  <option value="">—</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </td>
              <td><input defaultValue={p.category} onBlur={(e) => e.target.value !== p.category && update(p.id, 'category', e.target.value)} style={{ border: 'none', background: 'transparent', font: 'inherit', width: '100%' }} /></td>
              <td><input defaultValue={p.unit} onBlur={(e) => e.target.value !== p.unit && update(p.id, 'unit', e.target.value)} style={{ border: 'none', background: 'transparent', font: 'inherit', width: 44 }} /></td>
              <td><input defaultValue={p.price} type="number" onBlur={(e) => Number(e.target.value) !== p.price && update(p.id, 'price', Number(e.target.value))} style={{ border: 'none', background: 'transparent', font: 'inherit', width: 64 }} /></td>
              <td><button className="del-link" onClick={() => remove(p.id)}>удалить</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ReportTab({ store }) {
  const { settings, setSettings, reload } = store
  const [local, setLocal] = useState(settings)

  useEffect(() => setLocal(settings), [settings])

  async function save() {
    if (supabaseReady) await supabase.from('app_settings').update(local).eq('id', 1)
    setSettings(local)
    reload()
  }

  return (
    <div style={{ maxWidth: 480 }}>
      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 13, color: 'var(--ink-soft)', display: 'block', marginBottom: 4 }}>Шаблон имени файла</label>
        <input
          style={{ width: '100%', padding: 10, border: '1px solid var(--line)', borderRadius: 8 }}
          value={local.report_filename_template || ''}
          onChange={(e) => setLocal((s) => ({ ...s, report_filename_template: e.target.value }))}
        />
        <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 4 }}>Доступно: <span className="badge">{'{location}'}</span> <span className="badge">{'{date}'}</span></div>
      </div>
      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 13, color: 'var(--ink-soft)', display: 'block', marginBottom: 4 }}>Название компании (для PDF)</label>
        <input
          style={{ width: '100%', padding: 10, border: '1px solid var(--line)', borderRadius: 8 }}
          value={local.company_name || ''}
          onChange={(e) => setLocal((s) => ({ ...s, company_name: e.target.value }))}
        />
      </div>
      <button className="btn primary" onClick={save}>Сохранить</button>
    </div>
  )
}
