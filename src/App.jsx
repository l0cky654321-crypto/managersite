import React, { useEffect, useMemo, useState, useCallback } from 'react'
import { supabase, supabaseReady } from './supabaseClient'
import { buildFilename, exportExcel, exportPDF } from './lib/report'

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
    { id: 'p4', supplier_id: 's2', name: 'Сахар стики 5г', category: '', unit: 'шт', price: 1, payment_note: '' },
    { id: 'p5', supplier_id: 's2', name: 'Ведро 850мл, 120шт', category: 'Одноразовая посуда', unit: 'упк', price: 0, payment_note: '' },
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

  return { locations, suppliers, products, locationProducts, settings, loading, reload, setSettings }
}

function money(n) {
  return new Intl.NumberFormat('ru-RU').format(Math.round((n || 0) * 100) / 100)
}

export default function App() {
  const store = useDataStore()
  const { locations, suppliers, products, locationProducts, settings } = store

  const [view, setView] = useState('order')
  const [locationId, setLocationId] = useState('')
  const [query, setQuery] = useState('')
  const [qtyDraft, setQtyDraft] = useState({})
  const [carts, setCarts] = useState({}) // { [locationId]: [items] }

  useEffect(() => {
    if (!locationId && locations.length) setLocationId(locations[0].id)
  }, [locations, locationId])

  const cart = carts[locationId] || []

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

  function addToCart(product, qty) {
    const q = Number(qty) || 1
    if (q <= 0) return
    const sup = supplierById[product.supplier_id]
    setCarts((prev) => {
      const list = prev[locationId] ? [...prev[locationId]] : []
      const idx = list.findIndex((it) => it.product_id === product.id)
      if (idx >= 0) {
        list[idx] = { ...list[idx], quantity: list[idx].quantity + q }
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
          quantity: q,
        })
      }
      return { ...prev, [locationId]: list }
    })
    setQtyDraft((d) => ({ ...d, [product.id]: '' }))
  }

  function removeFromCart(product_id) {
    setCarts((prev) => ({ ...prev, [locationId]: (prev[locationId] || []).filter((it) => it.product_id !== product_id) }))
  }

  function clearCart() {
    setCarts((prev) => ({ ...prev, [locationId]: [] }))
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
    handleExport('excel')
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

      {view === 'order' ? (
        <div className="main">
          <div className="panel">
            <h2>Товары</h2>
            <div className="search-row">
              <input
                placeholder="Поиск товара, категории или поставщика..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="product-list">
              {visibleProducts.length === 0 && (
                <div className="empty-state">Ничего не найдено. Добавьте товары в «Настройки → Товары».</div>
              )}
              {visibleProducts.map((p) => {
                const sup = supplierById[p.supplier_id]
                return (
                  <div className="product-row" key={p.id}>
                    <div>
                      <div className="name">{p.name}</div>
                      <div className="supplier">{sup?.name || '—'}{p.category ? ` · ${p.category}` : ''}</div>
                    </div>
                    <div className="price">{money(p.effective_price)} тг / {p.unit}</div>
                    <input
                      className="qty-input"
                      type="number"
                      min="0"
                      placeholder="1"
                      value={qtyDraft[p.id] ?? ''}
                      onChange={(e) => setQtyDraft((d) => ({ ...d, [p.id]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === 'Enter') addToCart(p, qtyDraft[p.id] || 1) }}
                    />
                    <button className="add-btn" onClick={() => addToCart(p, qtyDraft[p.id] || 1)}>+</button>
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
              {groupedCart.length === 0 && <div className="ticket-empty">Добавьте товары слева — они появятся здесь, сгруппированные по поставщику.</div>}
              {groupedCart.map(([supplierName, items]) => (
                <div className="ticket-group" key={supplierName}>
                  <div className="supplier-name">{supplierName}</div>
                  {items.map((it) => (
                    <div className="ticket-item" key={it.product_id}>
                      <span>{it.product_name}</span>
                      <span className="qty">{it.quantity} {it.unit}</span>
                      <span className="sum">{money(it.quantity * it.price)}</span>
                      <button className="remove" onClick={() => removeFromCart(it.product_id)}>✕</button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div className="ticket-foot">
              <div className="ticket-total">
                <span>Итого</span>
                <span>{money(grandTotal)} тг</span>
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

      <div className="footer-note">Данные хранятся в Supabase · Отчёты формируются на устройстве, ничего не отправляется на сторонние серверы</div>
    </div>
  )
}

function Settings({ store }) {
  const [tab, setTab] = useState('locations')
  return (
    <div className="main" style={{ gridTemplateColumns: '1fr' }}>
      <div className="panel">
        <nav style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
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
