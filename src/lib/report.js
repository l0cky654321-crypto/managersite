import * as XLSX from 'xlsx'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { DejaVuSansNormal } from './fonts/DejaVuSans-normal.js'
import { DejaVuSansBold } from './fonts/DejaVuSans-bold.js'

const FONT = 'DejaVuSans'

function registerFont(doc) {
  doc.addFileToVFS('DejaVuSans-normal.ttf', DejaVuSansNormal)
  doc.addFont('DejaVuSans-normal.ttf', FONT, 'normal')
  doc.addFileToVFS('DejaVuSans-bold.ttf', DejaVuSansBold)
  doc.addFont('DejaVuSans-bold.ttf', FONT, 'bold')
  doc.setFont(FONT, 'normal')
}

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

function fmt(n) {
  return new Intl.NumberFormat('ru-RU').format(money(n))
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

const ACCENT = [217, 155, 43] // matches --accent brand color
const INK = [31, 36, 48]
const INK_SOFT = [86, 95, 115]
const LINE = [225, 228, 224]

export function exportPDF({ items, locationName, filename, companyName }) {
  const groups = groupBySupplier(items)
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  registerFont(doc)

  const pageWidth = doc.internal.pageSize.getWidth()
  const marginX = 40

  function drawHeader() {
    doc.setFillColor(...INK)
    doc.rect(0, 0, pageWidth, 78, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFont(FONT, 'bold')
    doc.setFontSize(17)
    doc.text(companyName ? companyName : 'Закуп', marginX, 32)
    doc.setFont(FONT, 'normal')
    doc.setFontSize(11)
    doc.text(`Точка: ${locationName || '—'}`, marginX, 52)
    const dateLabel = new Date().toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' })
    doc.setFontSize(9)
    doc.setTextColor(230, 230, 230)
    doc.text(dateLabel, pageWidth - marginX, 52, { align: 'right' })
    doc.setTextColor(...INK)
  }

  function drawFooter() {
    const pageCount = doc.internal.getNumberOfPages()
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i)
      const h = doc.internal.pageSize.getHeight()
      doc.setDrawColor(...LINE)
      doc.line(marginX, h - 34, pageWidth - marginX, h - 34)
      doc.setFont(FONT, 'normal')
      doc.setFontSize(8)
      doc.setTextColor(...INK_SOFT)
      doc.text('Сформировано в приложении «Закуп»', marginX, h - 20)
      doc.text(`Стр. ${i} из ${pageCount}`, pageWidth - marginX, h - 20, { align: 'right' })
    }
  }

  drawHeader()
  let y = 100
  let grandTotal = 0

  for (const g of groups) {
    if (y > 700) { doc.addPage(); drawHeader(); y = 100 }

    doc.setFontSize(12)
    doc.setFont(FONT, 'bold')
    doc.setTextColor(...INK)
    const header = g.supplier_contact ? `${g.supplier_name}   ·   ${g.supplier_contact}` : g.supplier_name
    doc.text(header, marginX, y)

    const body = g.rows.map((r) => {
      const total = money(r.quantity * r.price)
      return [r.product_name, r.unit, String(r.quantity), fmt(r.price), fmt(total)]
    })
    const subtotal = g.rows.reduce((s, r) => s + money(r.quantity * r.price), 0)
    grandTotal += subtotal

    autoTable(doc, {
      startY: y + 10,
      head: [['Товар', 'ед', 'шт', 'цена, тг', 'сумма, тг']],
      body,
      foot: [['', '', '', 'Итого по поставщику:', `${fmt(subtotal)} тг`]],
      theme: 'grid',
      styles: { font: FONT, fontSize: 9.5, cellPadding: 6, lineColor: LINE, lineWidth: 0.6, textColor: INK },
      headStyles: { font: FONT, fontStyle: 'bold', fillColor: INK, textColor: [255, 255, 255], fontSize: 9 },
      footStyles: { font: FONT, fontStyle: 'bold', fillColor: [245, 240, 228], textColor: INK, fontSize: 9.5 },
      alternateRowStyles: { fillColor: [249, 249, 247] },
      columnStyles: {
        0: { cellWidth: 'auto' },
        1: { cellWidth: 40, halign: 'center' },
        2: { cellWidth: 40, halign: 'center' },
        3: { cellWidth: 70, halign: 'right' },
        4: { cellWidth: 80, halign: 'right' },
      },
      margin: { left: marginX, right: marginX },
      didDrawPage: () => { drawHeader() },
    })
    y = doc.lastAutoTable.finalY + 26
  }

  if (y > 700) { doc.addPage(); drawHeader(); y = 100 }
  doc.setFillColor(...ACCENT)
  doc.roundedRect(marginX, y - 20, pageWidth - marginX * 2, 36, 6, 6, 'F')
  doc.setFont(FONT, 'bold')
  doc.setFontSize(13)
  doc.setTextColor(...INK)
  doc.text('ОБЩИЙ ИТОГО', marginX + 14, y + 3)
  doc.text(`${fmt(grandTotal)} тг`, pageWidth - marginX - 14, y + 3, { align: 'right' })
  doc.setTextColor(...INK)

  drawFooter()
  doc.save(`${filename}.pdf`)
}
