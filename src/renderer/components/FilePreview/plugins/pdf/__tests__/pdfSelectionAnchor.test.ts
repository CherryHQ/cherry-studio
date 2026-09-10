import { afterEach, describe, expect, it } from 'vitest'

import { pageToPdfAnchor } from '../pdfSelectionAnchor'

function buildPage(pageNumber: string | null): HTMLDivElement {
  const page = document.createElement('div')
  page.className = 'page'
  if (pageNumber !== null) page.setAttribute('data-page-number', pageNumber)
  document.body.appendChild(page)
  return page
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('pageToPdfAnchor', () => {
  it('resolves a click inside a rendered page to its one-based number', () => {
    const page = buildPage('3')
    const span = document.createElement('span')
    page.appendChild(span)

    expect(pageToPdfAnchor(span)).toEqual({ page: 3 })
  })

  it('returns null outside any page or for a malformed page number', () => {
    expect(pageToPdfAnchor(buildPage(null))).toBeNull()
    expect(pageToPdfAnchor(buildPage('0'))).toBeNull()
    expect(pageToPdfAnchor(buildPage('2.5'))).toBeNull()
  })
})
