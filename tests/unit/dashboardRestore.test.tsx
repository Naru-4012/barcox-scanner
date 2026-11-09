import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '../../src/types'

const dashboardState = vi.hoisted(() => ({
  loadRemoteSession: vi.fn<() => Promise<Session | null>>(),
}))

vi.mock('../../src/services/supabaseClient', () => ({
  supabase: {
    auth: {
      onAuthStateChange: (callback: (event: string, session: { user: { email: string } } | null) => void) => {
        callback('SIGNED_IN', { user: { email: 'operator@example.com' } })
        return { data: { subscription: { unsubscribe: vi.fn() } } }
      },
      signOut: async () => ({ error: null }),
    },
  },
}))

vi.mock('../../src/features/session/api/remoteSession', () => ({
  loadRemoteSession: dashboardState.loadRemoteSession,
  saveRemoteSession: vi.fn(async () => undefined),
}))

vi.mock('../../src/features/catalog/api/productCatalog', () => ({
  lookupProductByCode: vi.fn(async () => null),
}))

vi.mock('../../src/features/scanner/services/scanFeedback', () => ({
  playScanFeedback: vi.fn(),
}))

import Dashboard from '../../src/pages/Dashboard/Dashboard'

describe('dashboard remote session restoration', () => {
  beforeEach(() => {
    localStorage.clear()
    dashboardState.loadRemoteSession.mockReset()
    dashboardState.loadRemoteSession.mockResolvedValue({
      business: 'Vedan Silver',
      productName: 'Silver ornaments',
      number: 'BX-20261109-001',
      status: 'active',
      items: [],
    })
  })

  it('does not restore the previous cloud session after starting a new session', async () => {
    render(<Dashboard />)

    expect(await screen.findByRole('heading', { name: 'Vedan Silver' })).toBeTruthy()
    expect(dashboardState.loadRemoteSession).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: /New session/ }))

    expect(await screen.findByRole('heading', { name: 'Start a new session' })).toBeTruthy()
    await waitFor(() => expect(dashboardState.loadRemoteSession).toHaveBeenCalledOnce())
  })

  it('edits an item by its stable ID and refreshes the displayed weight', async () => {
    dashboardState.loadRemoteSession.mockResolvedValue({
      business: 'Vedan Silver',
      productName: 'Silver ornaments',
      number: 'BX-20261109-001',
      status: 'active',
      items: [{
        id: 'item-1',
        itemNumber: 1,
        raw: 'QR-ITEM-1',
        product: 'Silver ring',
        weight: 42.44,
        unit: 'g',
        scannedAt: '2026-11-09T10:00:00.000Z',
        scanType: 'qr',
      }],
    })
    render(<Dashboard />)

    fireEvent.click(await screen.findByRole('button', { name: /Edit item 1: Silver ring/ }))
    fireEvent.change(screen.getByLabelText('Weight (grams)'), { target: { value: '43.1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findAllByText('43.1 g')).not.toHaveLength(0)
    expect(screen.queryByText('42.44 g')).toBeNull()
  })
})
