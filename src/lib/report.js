import ExcelJS from 'exceljs'
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

const ACCENT_ARGB = 'FFD99B2B' // matches --accent brand color
const INK_ARGB = 'FF1F2430'
const INK_SOFT_ARGB = 'FF565F73'
const HEAD_FILL_ARGB = 'FFF5F0E4'
const ALT_ROW_ARGB = 'FFF9F9F7'
const LINE_ARGB = 'FFE1E4E0'
const WHITE_ARGB = 'FFFFFFFF'

const thinLine = { style: 'thin', color: { argb: LINE_ARGB } }
function gridBorder(cell) {
  cell.border = { top: thinLine, left: thinLine, bottom: thinLine, right: thinLine }
}
function fillCell(cell, argb) {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } }
}

// Mirrors the PDF layout exactly: a dark title band, then one section per
// supplier (dark header bar with name/contact, a bordered table with the
// same columns/alignment as the PDF, a shaded subtotal row), and a bold
// accent-colored grand-total bar at the end.
export async function exportExcel({ items, locationName, filename, companyName }) {
  const groups = groupBySupplier(items)
  const dateLabel = new Date().toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' })

  const wb = new ExcelJS.Workbook()
  const sheetName = (locationName || 'Закуп').slice(0, 30) || 'Закуп'
  const ws = wb.addWorksheet(sheetName, { views: [{ showGridLines: false }] })

  ws.columns = [
    { width: 46 }, { width: 9 }, { width: 9 }, { width: 15 }, { width: 17 },
  ]

  // ---- Title band (mirrors the dark PDF header) ----
  ws.mergeCells('A1:E1')
  const titleCell = ws.getCell('A1')
  titleCell.value = companyName || 'Закуп'
  titleCell.font = { bold: true, size: 15, color: { argb: WHITE_ARGB } }
  titleCell.alignment = { vertical: 'middle', horizontal: 'left' }
  ws.getRow(1).height = 26
  for (let c = 1; c <= 5; c++) fillCell(ws.getCell(1, c), INK_ARGB)

  ws.mergeCells('A2:C2')
  const locCell = ws.getCell('A2')
  locCell.value = `Точка: ${locationName || '—'}`
  locCell.font = { size: 10.5, color: { argb: WHITE_ARGB } }
  locCell.alignment = { vertical: 'middle', horizontal: 'left' }

  ws.mergeCells('D2:E2')
  const dateCell = ws.getCell('D2')
  dateCell.value = dateLabel
  dateCell.font = { size: 9.5, color: { argb: 'FFE6E6E6' } }
  dateCell.alignment = { vertical: 'middle', horizontal: 'right' }
  ws.getRow(2).height = 20
  for (let c = 1; c <= 5; c++) fillCell(ws.getCell(2, c), INK_ARGB)

  ws.addRow([])

  const colAlign = ['left', 'center', 'center', 'right', 'right']
  let grandTotal = 0

  for (const g of groups) {
    // Supplier header bar
    const supRowNum = ws.rowCount + 1
    ws.addRow([g.supplier_contact ? `${g.supplier_name}   ·   ${g.supplier_contact}` : g.supplier_name, '', '', '', ''])
    ws.mergeCells(supRowNum, 1, supRowNum, 5)
    const supCell = ws.getCell(supRowNum, 1)
    supCell.font = { bold: true, size: 11.5, color: { argb: WHITE_ARGB } }
    supCell.alignment = { vertical: 'middle', horizontal: 'left' }
    ws.getRow(supRowNum).height = 20
    for (let c = 1; c <= 5; c++) fillCell(ws.getCell(supRowNum, c), INK_ARGB)

    // Column header row
    const headRowNum = ws.rowCount + 1
    ws.addRow(['Товар', 'ед', 'шт', 'цена, тг', 'сумма, тг'])
    for (let c = 1; c <= 5; c++) {
      const cell = ws.getCell(headRowNum, c)
      cell.font = { bold: true, size: 9.5, color: { argb: INK_SOFT_ARGB } }
      cell.alignment = { vertical: 'middle', horizontal: colAlign[c - 1] }
      fillCell(cell, HEAD_FILL_ARGB)
      gridBorder(cell)
    }

    // Item rows (bordered grid, alternating shading — matches PDF 'grid' theme)
    let subtotal = 0
    g.rows.forEach((r, i) => {
      const total = money(r.quantity * r.price)
      subtotal += total
      const rowNum = ws.rowCount + 1
      ws.addRow([r.product_name, r.unit, r.quantity, r.price, total])
      const isAlt = i % 2 === 1
      // Estimate how many lines the product name needs at the current
      // column width so the row is tall enough to show the wrapped text
      // instead of clipping it.
      const charsPerLine = 34
      const nameLen = (r.product_name || '').length
      const lineCount = Math.max(1, Math.ceil(nameLen / charsPerLine))
      ws.getRow(rowNum).height = Math.max(18, lineCount * 14)
      for (let c = 1; c <= 5; c++) {
        const cell = ws.getCell(rowNum, c)
        cell.font = { size: 9.5, color: { argb: INK_ARGB } }
        cell.alignment = { vertical: 'middle', horizontal: colAlign[c - 1], wrapText: c === 1 }
        gridBorder(cell)
        if (isAlt) fillCell(cell, ALT_ROW_ARGB)
        if (c >= 3) cell.numFmt = '#,##0.##'
      }
    })
    grandTotal += subtotal

    // Subtotal row
    const footRowNum = ws.rowCount + 1
    ws.addRow(['', '', '', 'Итого по поставщику:', subtotal])
    for (let c = 1; c <= 5; c++) {
      const cell = ws.getCell(footRowNum, c)
      cell.font = { bold: true, size: 9.5, color: { argb: INK_ARGB } }
      cell.alignment = { vertical: 'middle', horizontal: colAlign[c - 1] }
      fillCell(cell, HEAD_FILL_ARGB)
      gridBorder(cell)
      if (c === 5) cell.numFmt = '#,##0.##'
    }

    ws.addRow([])
  }

  // ---- Grand total bar (mirrors the accent-colored PDF total block) ----
  const totalRowNum = ws.rowCount + 1
  ws.addRow(['', '', '', 'ОБЩИЙ ИТОГО', grandTotal])
  ws.mergeCells(totalRowNum, 1, totalRowNum, 3)
  ws.getRow(totalRowNum).height = 22
  for (let c = 1; c <= 5; c++) fillCell(ws.getCell(totalRowNum, c), ACCENT_ARGB)
  const totalLabelCell = ws.getCell(totalRowNum, 4)
  totalLabelCell.font = { bold: true, size: 12.5, color: { argb: INK_ARGB } }
  totalLabelCell.alignment = { vertical: 'middle', horizontal: 'right' }
  const totalValueCell = ws.getCell(totalRowNum, 5)
  totalValueCell.font = { bold: true, size: 12.5, color: { argb: INK_ARGB } }
  totalValueCell.alignment = { vertical: 'middle', horizontal: 'right' }
  totalValueCell.numFmt = '#,##0.## "тг"'

  ws.addRow([])
  const footerRowNum = ws.rowCount + 1
  ws.addRow(['Сформировано в приложении «Закуп»'])
  ws.getCell(footerRowNum, 1).font = { italic: true, size: 8.5, color: { argb: INK_SOFT_ARGB } }

  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filename}.xlsx`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
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
