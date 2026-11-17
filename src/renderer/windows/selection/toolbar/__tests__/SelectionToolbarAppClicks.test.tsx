import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import SelectionToolbarApp from '../SelectionToolbarApp'

vi.mock('../SelectionToolbar', () => ({ default: () => <button type="button">Copy</button> }))
vi.mock('@renderer/components/ThemeProvider', () => ({
  ThemeProvider: ({ children }: { children: ReactNode }) => children
}))

const request = vi.mocked(window.api.ipcApi.request)

describe('SelectionToolbarApp click attribution', () => {
  afterEach(() => {
    cleanup()
    request.mockClear()
  })

  it('reports toolbar clicks on the selection page', () => {
    render(<SelectionToolbarApp />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))

    expect(request).toHaveBeenCalledWith(
      'analytics.track',
      expect.objectContaining({ event: 'ui_clicked', page: 'selection' })
    )
  })
})
