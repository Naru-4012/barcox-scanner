import { describe, expect, it } from 'vitest'
import { getPageItems, getPaginationPages, ITEMS_PER_PAGE } from '../../src/utils/pagination'

describe('item pagination', () => {
  it('shows no more than ten newest items on a page', () => {
    const items = Array.from({ length: 25 }, (_, index) => index + 1)

    expect(ITEMS_PER_PAGE).toBe(10)
    expect(getPageItems(items, 1)).toEqual([25, 24, 23, 22, 21, 20, 19, 18, 17, 16])
    expect(getPageItems(items, 2)).toEqual([15, 14, 13, 12, 11, 10, 9, 8, 7, 6])
    expect(getPageItems(items, 3)).toEqual([5, 4, 3, 2, 1])
  })

  it('clamps pages to the available range', () => {
    expect(getPageItems([1, 2, 3], 8)).toEqual([3, 2, 1])
    expect(getPageItems([1, 2, 3], 0)).toEqual([3, 2, 1])
    expect(getPageItems([], 1)).toEqual([])
  })

  it('keeps page-number controls compact for large item lists', () => {
    expect(getPaginationPages(1, 20)).toEqual([1, 2, 3, 'ellipsis', 20])
    expect(getPaginationPages(10, 20)).toEqual([1, 'ellipsis', 8, 9, 10, 11, 12, 'ellipsis', 20])
    expect(getPaginationPages(20, 20)).toEqual([1, 'ellipsis', 18, 19, 20])
  })
})
