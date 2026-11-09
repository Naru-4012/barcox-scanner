import { describe, expect, it } from 'vitest'
import type { Item } from '../../src/types'
import { getMostRecentlyScannedItem, removeItemById, renumberItems } from '../../src/utils/items'

function createItem(id: string, itemNumber: number, weight: number, scannedAt: string, product?: string): Item {
  return {
    id,
    itemNumber,
    raw: String(weight),
    product,
    weight,
    unit: 'g',
    scannedAt,
    scanType: 'barcode',
  }
}

describe('item list identity and numbering', () => {
  it('removes only the selected ID when weights are identical and closes numbering gaps', () => {
    const items = [
      createItem('a', 1, 42.44, '2026-11-09T10:00:00.000Z'),
      createItem('b', 2, 42.44, '2026-11-09T10:01:00.000Z'),
      createItem('c', 3, 10, '2026-11-09T10:02:00.000Z'),
    ]

    expect(removeItemById(items, 'b')).toEqual([
      { ...items[0], itemNumber: 1 },
      { ...items[2], itemNumber: 2 },
    ])
    expect(items).toHaveLength(3)
  })

  it('re-numbers restored items and removes stale generated display labels', () => {
    expect(renumberItems([
      createItem('a', 5, 1, '2026-11-09T10:00:00.000Z', 'Barcode Scanned 005'),
      createItem('b', 9, 2, '2026-11-09T10:01:00.000Z', 'Bracelet'),
    ])).toMatchObject([
      { id: 'a', itemNumber: 1, product: undefined },
      { id: 'b', itemNumber: 2, product: 'Bracelet' },
    ])
  })

  it('finds the latest scanned weight independent of list order', () => {
    const older = createItem('older', 1, 1, '2026-11-09T10:00:00.000Z')
    const newer = createItem('newer', 2, 42.44, '2026-11-09T10:01:00.000Z')

    expect(getMostRecentlyScannedItem([newer, older])).toBe(newer)
  })
})
