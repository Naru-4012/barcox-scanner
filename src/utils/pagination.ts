export const ITEMS_PER_PAGE = 10

export function getPageItems<T>(items: readonly T[], page: number, pageSize = ITEMS_PER_PAGE): T[] {
  if (items.length === 0 || pageSize < 1) return []

  const pageCount = Math.ceil(items.length / pageSize)
  const activePage = Math.min(Math.max(Math.trunc(page), 1), pageCount)
  const end = items.length - (activePage - 1) * pageSize
  const start = Math.max(0, end - pageSize)
  return items.slice(start, end).reverse()
}

export function getPaginationPages(currentPage: number, totalPages: number): Array<number | 'ellipsis'> {
  if (totalPages < 1) return []

  const activePage = Math.min(Math.max(Math.trunc(currentPage), 1), totalPages)
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1)

  const start = Math.max(2, activePage - 2)
  const end = Math.min(totalPages - 1, activePage + 2)
  const pages: Array<number | 'ellipsis'> = [1]

  if (start > 2) pages.push('ellipsis')
  for (let page = start; page <= end; page += 1) pages.push(page)
  if (end < totalPages - 1) pages.push('ellipsis')
  pages.push(totalPages)

  return pages
}
