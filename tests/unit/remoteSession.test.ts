import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '../../src/types'

const remoteState = vi.hoisted(() => ({
  calls: [] as string[],
  existingPages: [[{ id: 'item-1' }, { id: 'item-deleted' }, { id: 'item-3' }]] as Array<Array<{ id: string }>>,
  itemPages: [[]] as Array<Array<Record<string, unknown>>>,
  sessionRow: {
    id: 'session-1',
    session_number: 'BX-20261109-001',
    business_name: 'Vedan Silver',
    product_name: null,
    status: 'active',
    started_at: '2026-11-09T10:00:00.000Z',
  },
}))

vi.mock('../../src/services/supabaseClient', () => ({
  supabase: {
    auth: {
      getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }),
    },
    schema: () => ({
      from: (table: string) => {
        if (table === 'scan_sessions') {
          return {
            upsert: () => ({
              select: () => ({
                single: async () => ({ data: { id: 'session-1' }, error: null }),
              }),
            }),
            select: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: remoteState.sessionRow, error: null }),
                }),
              }),
            }),
          }
        }

        return {
          select: (columns: string) => {
            if (columns === 'id') remoteState.calls.push('select-existing-ids')
            return {
              eq: () => ({
                order: () => ({
                  range: async (from: number) => ({
                    data: remoteState.itemPages[Math.floor(from / 1000)] ?? [],
                    error: null,
                  }),
                }),
                range: async (from: number) => ({
                  data: remoteState.existingPages[Math.floor(from / 1000)] ?? [],
                  error: null,
                }),
              }),
            }
          },
          delete: () => ({
            in: async (_column: string, ids: string[]) => {
              remoteState.calls.push(`delete:${ids.join(',')}`)
              return { error: null }
            },
          }),
          upsert: async (items: { id: string }[]) => {
            remoteState.calls.push(`upsert:${items.map(item => item.id).join(',')}`)
            return { error: null }
          },
        }
      },
    }),
  },
}))

import { saveRemoteSession } from '../../src/features/session/api/remoteSession'
import { loadRemoteSession } from '../../src/features/session/api/remoteSession'

describe('remote session synchronization', () => {
  beforeEach(() => {
    remoteState.calls.length = 0
    remoteState.existingPages = [[{ id: 'item-1' }, { id: 'item-deleted' }, { id: 'item-3' }]]
    remoteState.itemPages = [[]]
  })

  it('deletes removed rows before upserting renumbered rows', async () => {
    const session: Session = {
      business: 'Vedan Silver',
      number: 'BX-20261109-001',
      status: 'active',
      items: [
        { id: 'item-1', itemNumber: 1, raw: '1g', weight: 1, unit: 'g', scannedAt: '2026-11-09T10:00:00.000Z' },
        { id: 'item-3', itemNumber: 2, raw: '3g', weight: 3, unit: 'g', scannedAt: '2026-11-09T10:02:00.000Z' },
      ],
    }

    await saveRemoteSession(session)

    expect(remoteState.calls).toEqual([
      'select-existing-ids',
      'delete:item-deleted',
      'upsert:item-1,item-3',
    ])
  })

  it('syncs only changed items after a known baseline is established', async () => {
    const previousSession: Session = {
      business: 'Vedan Silver',
      number: 'BX-20261109-001',
      status: 'active',
      items: [
        { id: 'item-1', itemNumber: 1, raw: '1g', weight: 1, unit: 'g', scannedAt: '2026-11-09T10:00:00.000Z' },
        { id: 'item-deleted', itemNumber: 2, raw: '2g', weight: 2, unit: 'g', scannedAt: '2026-11-09T10:01:00.000Z' },
        { id: 'item-3', itemNumber: 3, raw: '3g', weight: 3, unit: 'g', scannedAt: '2026-11-09T10:02:00.000Z' },
      ],
    }
    const session: Session = {
      ...previousSession,
      items: [
        previousSession.items[0],
        { ...previousSession.items[2], itemNumber: 2 },
      ],
    }

    await saveRemoteSession(session, previousSession)

    expect(remoteState.calls).toEqual([
      'delete:item-deleted',
      'upsert:item-3',
    ])
  })

  it('loads remote item pages beyond the database default page size', async () => {
    const makeRemoteItem = (index: number) => ({
      id: `item-${index + 1}`,
      item_number: index + 1,
      raw_payload: `${index + 1}g`,
      product: null,
      weight: 1,
      unit: 'g',
      size: null,
      purity: null,
      scan_type: 'manual',
      scanned_at: '2026-11-09T10:00:00.000Z',
    })
    remoteState.itemPages = [
      Array.from({ length: 1000 }, (_, index) => makeRemoteItem(index)),
      [makeRemoteItem(1000)],
    ]

    const session = await loadRemoteSession()

    expect(session?.items).toHaveLength(1001)
    expect(session?.items.at(-1)?.itemNumber).toBe(1001)
  })
})
