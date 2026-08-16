import * as XLSX from 'xlsx'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

// items: [{ supplier_name, supplier_contact, product_name, unit, quantity, price, payment_note }]
// groups by supplier, preserving first-seen order.
function groupBySupplier(items) {
  const map = new Map()
  for (const it of items) {
    const key = it.supplier_name || 'Без поставщика'
    if (!map.has(key)) map.set(key, { supplier_name: key, supplier_contact: it.supplier_contact, rows: [] })
    map.get(key).rows.push(it)
  }
  return [...map.values()]
}

function money(n) {
  return Math.round((n || 0) * 100) / 100
}

export function buildFilename(template, { locationName, date }) {
  const d = date || new Date()
  const dateStr = d.toLocaleDateString('ru-RU').split('.').join('-')
  return (template || 'ЗАКУП_{location}_{date}')
    .replaceAll('{location}', (locationName || 'точка').replace(/[\\/:*?"<>|]/g, '_'))
    .replaceAll('{date}', dateStr)
}

export function exportExcel({ items, locationName, filename, companyName }) {
  const groups = groupBySupplier(items)
  const rows = [['Поставщик', 'Контакты', 'Товар', 'ед', 'шт', 'тг', 'Стоимость']]
  let grandTotal = 0

  for (const g of groups) {
    let first = true
    let subtotal = 0
    for (const r of g.rows) {
      const total = money(r.quantity * r.price)
      subtotal += total
      rows.push([
        first ? g.supplier_name : '',
        first ? (g.supplier_contact || '') : '',
        r.product_name,
        r.unit,
        r.quantity,
        r.price,
        total,
      ])
      first = false
    }
    rows.push(['', '', '', '', '', 'Итого по поставщику:', money(subtotal)])
    rows.push([])
    grandTotal += subtotal
  }
  rows.push(['', '', '', '', '', 'ОБЩИЙ ИТОГО:', money(grandTotal)])

  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [
    { wch: 16 }, { wch: 18 }, { wch: 34 }, { wch: 6 }, { wch: 6 }, { wch: 10 }, { wch: 12 },
  ]
  const wb = XLSX.utils.book_new()
  const sheetName = (locationName || 'Закуп').slice(0, 30)
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  XLSX.writeFile(wb, `${filename}.xlsx`)
}

export function exportPDF({ items, locationName, filename, companyName }) {
  const groups = groupBySupplier(items)
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })

  const title = companyName ? `${companyName} — Закуп: ${locationName}` : `Закуп: ${locationName}`
  doc.setFontSize(14)
  doc.text(title, 40, 40)
  doc.setFontSize(10)
  doc.text(new Date().toLocaleDateString('ru-RU'), 40, 58)

  let y = 75
  let grandTotal = 0

  for (const g of groups) {
    doc.setFontSize(11)
    doc.setFont(undefined, 'bold')
    const header = g.supplier_contact ? `${g.supplier_name}  (${g.supplier_contact})` : g.supplier_name
    doc.text(header, 40, y)
    doc.setFont(undefined, 'normal')

    const body = g.rows.map((r) => {
      const total = money(r.quantity * r.price)
      return [r.product_name, r.unit, String(r.quantity), String(r.price), String(total)]
    })
    const subtotal = g.rows.reduce((s, r) => s + money(r.quantity * r.price), 0)
    grandTotal += subtotal

    autoTable(doc, {
      startY: y + 8,
      head: [['Товар', 'ед', 'шт', 'тг', 'Стоимость']],
      body,
      foot: [['', '', '', 'Итого:', String(money(subtotal))]],
      theme: 'grid',
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: [40, 40, 40] },
      footStyles: { fillColor: [235, 235, 235], textColor: [20, 20, 20], fontStyle: 'bold' },
      margin: { left: 40, right: 40 },
      didDrawPage: () => {},
    })
    y = doc.lastAutoTable.finalY + 20
    if (y > 740) { doc.addPage(); y = 40 }
  }

  doc.setFontSize(12)
  doc.setFont(undefined, 'bold')
  doc.text(`ОБЩИЙ ИТОГО: ${money(grandTotal)} тг`, 40, y)

  doc.save(`${filename}.pdf`)
}
