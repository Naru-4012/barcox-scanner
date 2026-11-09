import { jsPDF } from 'jspdf'
import type { Item, Session } from '../../../types'
import { formatDate, formatWeight, getItemDisplayName, weightInGrams } from '../../scanner/services/scanner'

export function buildCsvRows(session: Session) {
  return [
    ['Item Number', 'Product', 'Size', 'Weight', 'Unit', 'Scanned At'],
    ...session.items.map(item => [
      item.itemNumber,
      getItemDisplayName(item.product, item.itemNumber, item.scanType),
      item.size || '',
      item.weight,
      item.unit,
      item.scannedAt,
    ]),
  ]
}

function escapeCsvValue(value: string | number) {
  const text = String(value)
  const safeText = /^[\u0000-\u0020]*[=+\-@]/.test(text) ? `'${text}` : text
  return `"${safeText.replace(/"/g, '""')}"`
}

export function buildCsvContent(session: Session) {
  return buildCsvRows(session).map(row => row.map(escapeCsvValue).join(',')).join('\n')
}

export function getPdfFilename(session: Session) {
  const safeBusiness = (session.business || 'barcox').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/_+/g, '_')
  const dateStamp = new Date().toISOString().slice(0, 10)
  return `${safeBusiness || 'barcox'}_${dateStamp}.pdf`
}

export function buildPdfItemCells(item: Item): string[] {
  const raw = item.raw.trim()
  const rawIsWeightOnly = /^[0-9]+(?:\.[0-9]+)?\s*(?:g|gm|gms|gram|grams|kg|kgs|mg|mgs)?$/i.test(raw)
  const rawRepeatsProductAndWeight = Boolean(item.product) &&
    raw.toLowerCase() === `${item.product}${item.weight}`.toLowerCase()
  const details = [
    item.size ? `Size ${item.size}` : '',
    raw !== item.product && !rawIsWeightOnly && !rawRepeatsProductAndWeight ? raw : '',
  ].filter(Boolean).join(' - ')

  return [
    item.itemNumber.toString(),
    getItemDisplayName(item.product, item.itemNumber, item.scanType),
    item.weight.toLocaleString('en-IN', { maximumFractionDigits: 3 }),
    item.unit,
    details,
  ]
}

export function downloadCsv(session: Session) {
  const csvText = buildCsvContent(session)
  const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${session.number || 'barcox-session'}.csv`
  document.body.append(link)
  try {
    link.click()
  } finally {
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}

export function downloadPdf(session: Session, total: number) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const margin = 16
  const contentW = pageW - margin * 2
  const now = new Date()
  const violet: [number, number, number] = [124, 58, 237]
  const columns = [
    { title: '#', width: 12, align: 'left' as const },
    { title: 'Product', width: 80, align: 'left' as const },
    { title: 'Weight', width: 26, align: 'right' as const },
    { title: 'Unit', width: 16, align: 'left' as const },
    { title: 'Other details', width: contentW - 134, align: 'left' as const },
  ]
  const headerHeight = 9
  const rowHeight = 10

  function pageHeader(batchNumber: number, batchCount: number) {
    doc.setTextColor(30, 27, 75)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(15)
    doc.text('BarcoX - Product Scan Report', margin, 16)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(100)
    const reportIdentity = [session.business, session.productName, session.number || 'Working session'].filter(Boolean).join('  /  ')
    doc.text(reportIdentity, margin, 22)
    doc.text(`Page ${doc.getNumberOfPages()}`, pageW - margin, 16, { align: 'right' })
    doc.text(`Generated on ${formatDate(now)}`, pageW - margin, 22, { align: 'right' })
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(...violet)
    doc.text(batchNumber > batchCount ? 'Report summary' : `Batch ${batchNumber} of ${batchCount}`, margin, 32)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(100)
    const itemCountLabel = batchNumber > batchCount
      ? `${session.items.length} total items`
      : `${Math.min(10, Math.max(0, session.items.length - (batchNumber - 1) * 10))} items`
    doc.text(itemCountLabel, pageW - margin, 32, { align: 'right' })
  }

  function tableHeader(y: number) {
    doc.setFillColor(...violet)
    doc.rect(margin, y - 5, contentW, headerHeight, 'F')
    doc.setTextColor(255)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    let x = margin + 3
    columns.forEach(column => {
      if (column.align === 'right') {
        doc.text(column.title, x + column.width - 3, y + 1, { align: 'right' })
      } else {
        doc.text(column.title, x, y + 1)
      }
      x += column.width
    })
    doc.setTextColor(35, 35, 35)
    return y + headerHeight
  }

  const batchCount = Math.max(1, Math.ceil(session.items.length / 10))
  for (let batchIndex = 0; batchIndex < batchCount; batchIndex++) {
    if (batchIndex > 0) doc.addPage()
    const batchItems = session.items.slice(batchIndex * 10, batchIndex * 10 + 10)
    pageHeader(batchIndex + 1, batchCount)
    let y = tableHeader(42)
    batchItems.forEach((item, itemIndex) => {
      const cells = buildPdfItemCells(item)
      if (itemIndex % 2 === 1) { doc.setFillColor(246, 244, 255); doc.rect(margin, y - 5, contentW, rowHeight, 'F') }
      doc.setDrawColor(225, 223, 235)
      doc.rect(margin, y - 5, contentW, rowHeight)
      let x = margin + 3
      cells.forEach((cell, index) => {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(35, 35, 35)
        const text = doc.splitTextToSize(cell, columns[index].width - 6)
        const rightAligned = columns[index].align === 'right'
        doc.text(text[0] || '', rightAligned ? x + columns[index].width - 3 : x, y + 1, rightAligned ? { align: 'right' } : undefined)
        x += columns[index].width
      })
      y += rowHeight
    })
    doc.setDrawColor(...violet)
    doc.line(margin, y + 5, pageW - margin, y + 5)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(30, 27, 75)
    doc.text(`Batch ${batchIndex + 1} subtotal`, margin, y + 14)
    doc.text(formatWeight(batchItems.reduce((sum, item) => sum + weightInGrams(item.weight, item.unit), 0)), pageW - margin, y + 14, { align: 'right' })
  }

  doc.addPage()
  pageHeader(batchCount + 1, batchCount)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(30, 27, 75)
  doc.text('Session summary', margin, 48)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(35, 35, 35)
  doc.text(`Business Name: ${session.business || '—'}`, margin, 61)
  doc.text(`Product Name: ${session.productName || '—'}`, margin, 71)
  doc.text(`Total Items: ${session.items.length}`, margin, 81)
  doc.text(`Total Weight: ${formatWeight(total)}`, margin, 91)

  doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(120)
  const finalPage = doc.getNumberOfPages()
  for (let page = 1; page <= finalPage; page++) {
    doc.setPage(page)
    if (page !== finalPage) doc.text('BarcoX - Scan. Track. Done.', margin, pageH - 9)
    if (page === finalPage) doc.text('Generated by BarcoX', margin, pageH - 9)
    doc.text(`Page ${page} of ${finalPage}`, pageW - margin, pageH - 9, { align: 'right' })
  }

  doc.save(getPdfFilename(session))
}
