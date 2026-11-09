export type Item = {
  id: string
  itemNumber: number
  raw: string
  product?: string
  weight: number
  unit: string
  size?: string
  purity?: string
  scannedAt: string
  scanType?: ScanType
}

export type ScanType = 'qr' | 'barcode' | 'manual'

export type SessionStatus = 'active' | 'paused' | 'completed'

export type Session = {
  business: string
  productName?: string
  number: string
  items: Item[]
  status: SessionStatus
  updatedAt?: string
}

export type ParsedItem = Omit<Item, 'id' | 'itemNumber' | 'scannedAt'>

export const EMPTY_SESSION: Session = {
  business: '',
  productName: '',
  number: '',
  items: [],
  status: 'active',
  updatedAt: new Date(0).toISOString(),
}
