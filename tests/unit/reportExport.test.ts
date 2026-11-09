import { describe, expect, it } from 'vitest'
import { buildCsvRows, buildPdfItemCells, getPdfFilename } from '../../src/features/reports/services/reportExport'
import type { Session } from '../../src/types'

describe('report export logic', () => {
  const session: Session = {
    business: 'Vedant Silver',
    productName: 'Silver ornaments',
    number: 'BX-20260827-001',
    status: 'active',
    items: [
      {
        id: '1',
        itemNumber: 1,
        raw: 'ABC-100\nWeight: 250g',
        product: 'ABC-100',
        weight: 250,
        unit: 'g',
        purity: '22K',
        scannedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: '2',
        itemNumber: 2,
        raw: '42.5',
        weight: 42.5,
        unit: 'g',
        scannedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  }

  it('builds CSV rows with unique product labels', () => {
    const rows = buildCsvRows(session)

    expect(rows[0]).toEqual(['Item Number', 'Product', 'Size', 'Weight', 'Unit', 'Scanned At'])
    expect(rows[1][1]).toBe('ABC-100')
    expect(rows[1][3]).toBe(250)
    expect(rows[2][1]).toBe('Manual Weight 002')
    expect(rows[2][3]).toBe(42.5)
  })

  it('creates a safe PDF filename from the business name', () => {
    const fileName = getPdfFilename(session)
    expect(fileName).toMatch(/^Vedant_Silver_\d{4}-\d{2}-\d{2}\.pdf$/)
  })

  it('keeps each item weight in its matching PDF weight cell', () => {
    expect(buildPdfItemCells(session.items[0])).toEqual(['1', 'ABC-100', '250', 'g', 'ABC-100\nWeight: 250g'])
    expect(buildPdfItemCells(session.items[1])).toEqual(['2', 'Manual Weight 002', '42.5', 'g', ''])
  })

  it('omits purity from CSV and PDF report tables', () => {
    expect(buildCsvRows(session)[0]).not.toContain('Purity')
    expect(buildPdfItemCells(session.items[0])).not.toContain('22K')
  })
})
