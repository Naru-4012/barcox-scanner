import { beforeEach, describe, expect, it } from 'vitest'
import { makeSessionNumber } from '../services/scanner'
import { clearSession, loadSession, saveSession } from '../services/sessionStorage'
import { EMPTY_SESSION, type Session } from '../types'

describe('session persistence', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns empty session when no storage data exists', () => {
    expect(loadSession()).toEqual(EMPTY_SESSION)
  })

  it('saves and rehydrates a valid session', () => {
    const session: Session = {
      business: 'Vedant Silver',
      number: 'BX-20260827-001',
      status: 'active',
      items: [{
        id: 'item-1',
        itemNumber: 1,
        raw: 'ABC-100\nWeight: 250g',
        product: 'ABC-100',
        weight: 250,
        unit: 'g',
        scannedAt: '2026-01-01T00:00:00.000Z',
      }],
    }

    saveSession(session)
    expect(loadSession()).toEqual(session)
  })

  it('clears session storage when invalid JSON is present', () => {
    localStorage.setItem('barcox-session', '{invalid-json')
    expect(loadSession()).toEqual(EMPTY_SESSION)
    expect(localStorage.getItem('barcox-session')).toBeNull()
  })

  it('clears structurally invalid session data', () => {
    localStorage.setItem('barcox-session', JSON.stringify({ business: 'X', items: [] }))
    expect(loadSession()).toEqual(EMPTY_SESSION)
    expect(localStorage.getItem('barcox-session')).toBeNull()
  })

  it('removes current session from storage', () => {
    saveSession({ ...EMPTY_SESSION, business: 'X' })
    clearSession()
    expect(localStorage.getItem('barcox-session')).toBeNull()
  })

  it('increments vendor-aware session numbers by date without resetting across sessions', () => {
    const vendorA = 'Vedant Silver'
    const vendorB = 'ABC Silver'

    const first = makeSessionNumber(vendorA)
    const second = makeSessionNumber(vendorA)
    const newVendor = makeSessionNumber(vendorB)
    const previousVendor = makeSessionNumber(vendorA)

    expect(first).toMatch(/^BX-\d{8}-001$/)
    expect(second).toMatch(/^BX-\d{8}-002$/)
    expect(newVendor).toMatch(/^BX-\d{8}-001$/)
    expect(previousVendor).toMatch(/^BX-\d{8}-003$/)
  })
})
