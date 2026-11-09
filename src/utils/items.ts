import type { Item } from '../types'

const generatedProductLabel = /^(?:QR Scanned|Barcode Scanned|Manual Weight) \d{3,}$/

export function renumberItems(items: readonly Item[]): Item[] {
  return items.map((item, index) => ({
    ...item,
    itemNumber: index + 1,
    product: item.product && generatedProductLabel.test(item.product) ? undefined : item.product,
  }))
}

export function removeItemById(items: readonly Item[], itemId: string): Item[] {
  const index = items.findIndex(item => item.id === itemId)
  if (index < 0) return [...items]

  return renumberItems([...items.slice(0, index), ...items.slice(index + 1)])
}

export function updateItemById(items: readonly Item[], itemId: string, updates: Partial<Pick<Item, 'product' | 'weight' | 'unit' | 'size'>>): Item[] {
  let updated = false
  const nextItems = items.map(item => {
    if (item.id !== itemId) return item
    updated = true
    return { ...item, ...updates }
  })

  return updated ? renumberItems(nextItems) : [...items]
}

export function getMostRecentlyScannedItem(items: readonly Item[]): Item | undefined {
  return items.reduce<Item | undefined>((latest, item) => {
    if (!latest || Date.parse(item.scannedAt) >= Date.parse(latest.scannedAt)) return item
    return latest
  }, undefined)
}
