import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import HtmlArtifactsCard from '../HtmlArtifactsCard'

const mocks = vi.hoisted(() => ({
  createTempFile: vi.fn(),
  error: vi.fn(),
  HtmlArtifactsPopup: vi.fn(({ open }) => (open ? <div data-testid="html-artifacts-popup" /> : null)),
  openPath: vi.fn(),
  save: vi.fn(),
  success: vi.fn(),
  write: vi.fn()
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, ...props }: any) => (
    <button type="button" {...props}>
      {children}
    </button>
  )
}))

vi.mock('@cherrystudio/ui/lib/utils', () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ')
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn()
    })
  }
}))

vi.mock('@renderer/utils/error', () => ({
  formatErrorMessageWithPrefix: vi.fn((error, prefix) => `${prefix}: ${(error as Error).message}`)
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key
  })
}))

vi.mock('../HtmlArtifactsPopup', () => ({
  default: mocks.HtmlArtifactsPopup
}))

describe('HtmlArtifactsCard', () => {
  const html = '<!doctype html><html><head><title>Sample Page</title></head><body>Hello</body></html>'

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createTempFile.mockResolvedValue('/tmp/artifacts-preview.html')
    mocks.openPath.mockResolvedValue(undefined)
    mocks.save.mockResolvedValue('/tmp/Sample-Page.html')
    mocks.write.mockResolvedValue(undefined)

    Object.defineProperty(window, 'api', {
      configurable: true,
      writable: true,
      value: {
        file: {
          createTempFile: mocks.createTempFile,
          openPath: mocks.openPath,
          save: mocks.save,
          write: mocks.write
        }
      }
    })

    Object.defineProperty(window, 'toast', {
      configurable: true,
      writable: true,
      value: {
        error: mocks.error,
        success: mocks.success
      }
    })
  })

  it('opens the generated HTML file through the file API', async () => {
    render(<HtmlArtifactsCard html={html} />)

    fireEvent.click(screen.getByRole('button', { name: 'chat.artifacts.button.openExternal' }))

    await waitFor(() => expect(mocks.openPath).toHaveBeenCalledWith('/tmp/artifacts-preview.html'))
    expect(mocks.createTempFile).toHaveBeenCalledWith('artifacts-preview.html')
    expect(mocks.write).toHaveBeenCalledWith('/tmp/artifacts-preview.html', html)
    expect(mocks.error).not.toHaveBeenCalled()
  })

  it('shows an error when opening the generated HTML file fails', async () => {
    mocks.openPath.mockRejectedValueOnce(new Error('open failed'))

    render(<HtmlArtifactsCard html={html} />)

    fireEvent.click(screen.getByRole('button', { name: 'chat.artifacts.button.openExternal' }))

    await waitFor(() =>
      expect(mocks.error).toHaveBeenCalledWith('chat.artifacts.preview.openExternal.error.content: open failed')
    )
  })

  it('downloads the HTML artifact and reports save failures', async () => {
    render(<HtmlArtifactsCard html={html} />)

    fireEvent.click(screen.getByRole('button', { name: 'code_block.download.label' }))

    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith('Sample-Page.html', html))
    expect(mocks.success).toHaveBeenCalledWith('message.download.success')

    mocks.save.mockRejectedValueOnce(new Error('save failed'))
    fireEvent.click(screen.getByRole('button', { name: 'code_block.download.label' }))

    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('message.download.failed: save failed'))
  })
})
