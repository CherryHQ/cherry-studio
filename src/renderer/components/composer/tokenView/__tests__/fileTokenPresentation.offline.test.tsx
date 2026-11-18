import materialIconTheme from '@iconify-json/material-icon-theme/icons.json'
import { _api } from '@iconify/react'
import { render } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

import { getFileTokenPresentation } from '../fileTokenPresentation'

vi.unmock('@iconify/react')

const presentationFor = (name: string) => getFileTokenPresentation(undefined, name)

it.each([
  ['offline.md', 'markdown'],
  ['artifact.html', 'html'],
  ['unknown.xyz', 'document']
] as const)('renders bundled chip and preview glyphs without fetching for %s', (name, iconName) => {
  const originalFetch = _api.getFetch()
  const offlineFetch = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'))
  _api.setFetch(offlineFetch)
  const presentation = presentationFor(name)
  const view = render(
    <>
      <span data-testid="chip">{presentation.icon}</span>
      <span data-testid="preview">{presentation.previewIcon}</span>
    </>
  )

  try {
    const expected = new DOMParser()
      .parseFromString(
        `<svg xmlns="http://www.w3.org/2000/svg">${materialIconTheme.icons[iconName].body}</svg>`,
        'text/html'
      )
      .querySelector('svg')!
    for (const slot of ['chip', 'preview']) {
      const glyph = view.getByTestId(slot).querySelector('svg')
      expect(glyph).toBeVisible()
      expect(glyph?.innerHTML).toBe(expected.innerHTML)
    }
    expect(offlineFetch).not.toHaveBeenCalled()
  } finally {
    view.unmount()
    if (originalFetch) _api.setFetch(originalFetch)
  }
})
