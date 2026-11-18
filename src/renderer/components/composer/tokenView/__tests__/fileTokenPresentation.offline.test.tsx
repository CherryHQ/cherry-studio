import { _api } from '@iconify/react'
import { render, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

import { getFileTokenPresentation } from '../fileTokenPresentation'

vi.unmock('@iconify/react')

const presentationFor = (name: string) => getFileTokenPresentation(undefined, name)

it.each(['offline.md', 'unknown.xyz'])('keeps chip and preview glyphs visible offline for %s', async (name) => {
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
    await waitFor(() => expect(offlineFetch).toHaveBeenCalled())
    for (const slot of ['chip', 'preview']) {
      const glyph = view.getByTestId(slot).querySelector('svg')
      expect(glyph).toBeVisible()
      expect(glyph?.querySelector('path')).not.toBeNull()
    }
  } finally {
    view.unmount()
    if (originalFetch) _api.setFetch(originalFetch)
  }
})
