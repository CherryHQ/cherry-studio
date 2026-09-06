// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { FileComposerToken } from '../ComposerToken'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal())

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: vi.fn() }
}))

vi.mock('@renderer/services/ImagePreviewService', () => ({
  ImagePreviewService: { show: vi.fn() }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const originalResizeObserver = globalThis.ResizeObserver

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as typeof ResizeObserver
})

afterAll(() => {
  cleanup()
  globalThis.ResizeObserver = originalResizeObserver
})

describe('FileComposerToken tooltip integration', () => {
  it('keeps the real tooltip trigger attached to an activatable sent file', async () => {
    render(
      <FileComposerToken
        readOnly
        onReadOnlyFilePreviewActivate={vi.fn()}
        readOnlyFilePreview={{ url: 'file:///tmp/report.pdf', mediaType: 'application/pdf' }}
        token={{ id: 'file:report', kind: 'file', label: 'report.pdf' }}
      />
    )

    const trigger = screen.getByRole('button', { name: 'report.pdf' })
    const matchesSpy = vi.spyOn(trigger, 'matches').mockImplementation((selector) => selector === ':focus-visible')
    fireEvent.focus(trigger)

    expect(await screen.findByRole('tooltip')).toHaveTextContent('/tmp/report.pdf')
    matchesSpy.mockRestore()
  })
})
