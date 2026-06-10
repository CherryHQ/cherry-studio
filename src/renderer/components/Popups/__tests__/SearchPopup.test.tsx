// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  hide: vi.fn(),
  show: vi.fn()
}))

vi.mock('../../TopView', () => ({
  TopView: {
    hide: mocks.hide,
    show: mocks.show
  }
}))

vi.mock('@renderer/components/GlobalSearch/GlobalSearchPanel', () => ({
  GlobalSearchPanel: () => <input aria-label="Search input" />
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => (key === 'globalSearch.open' ? 'Open global search' : key)
  })
}))

import SearchPopup from '../SearchPopup'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SearchPopup', () => {
  it('does not autofocus the search input when opened', async () => {
    mocks.show.mockImplementation((element: ReactElement) => {
      render(element)
    })

    void SearchPopup.show()

    await waitFor(() => {
      expect(screen.getByLabelText('Search input')).not.toHaveFocus()
    })
  })
})
