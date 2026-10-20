import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CSSProperties } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Dialog, DialogContent, DialogTitle } from '@cherrystudio/ui'

import { Preview } from '../Preview'
import { PreviewError, type PreviewDocument, type PreviewSource } from '../source'

vi.mock('../filePreviewRegistry', async () => {
  const { useState } = await import('react')
  const { useTranslation } = await import('react-i18next')
  const { FilePreviewLayout } = await import('../FilePreviewLayout')
  const { PreviewError } = await import('../source')
  function TestPlugin({ sourceId }: { sourceId: string }) {
    const { t } = useTranslation()
    const [page, setPage] = useState(1)
    if (sourceId === 'render-error') throw new PreviewError('source_changed', 'Document changed')
    return (
      <FilePreviewLayout.Frame>
        <div>{sourceId}</div>
        <span>{t('file_preview.loading')}</span>
        <button type="button" onClick={() => setPage(page + 1)}>
          Page {page}
        </button>
      </FilePreviewLayout.Frame>
    )
  }
  return {
    resolvePreviewPlugin: (name: string) =>
      name.endsWith('.unsupported')
        ? null
        : {
            id: 'test',
            load: async () => ({ default: TestPlugin })
          }
  }
})
vi.unmock('@cherrystudio/ui')

afterEach(cleanup)

function document(): PreviewDocument {
  return {
    size: 1,
    revision: 'v1',
    readRange: async () => new Uint8Array([1]),
    close: vi.fn().mockResolvedValue(undefined)
  }
}

function source(id: string, open: PreviewSource['open']): PreviewSource {
  return { id, name: 'test.pdf', open }
}

describe('preview root', () => {
  it('keeps dialogs and their backdrops inside the scoped preview stylesheet', async () => {
    const view = render(
      <Preview
        source={source('dialog', async () => document())}
        header={
          <Dialog defaultOpen>
            <DialogContent aria-describedby={undefined}>
              <DialogTitle>Document outline</DialogTitle>
            </DialogContent>
          </Dialog>
        }
      />
    )
    const dialog = await screen.findByRole('dialog', { name: 'Document outline' })
    const root = view.container.querySelector('[data-file-preview-root]')

    // Packaged styles only apply within this root; a body portal leaves the modal invisible.
    await waitFor(() => {
      expect(root).toContainElement(dialog)
      expect(root).toContainElement(view.baseElement.querySelector('[data-slot="dialog-overlay"]'))
    })
  })

  it('carries host classes and token overrides, which is how mobile themes the preview', async () => {
    const view = render(
      <Preview
        source={source('styled', async () => document())}
        header={<span>Document</span>}
        className="dark"
        style={{ '--background': 'black' } as CSSProperties}
      />
    )
    await screen.findByText('styled')

    const root = view.container.querySelector('[data-file-preview-root]')
    expect(root).toHaveClass('file-preview-root', 'dark')
    expect(root).toHaveStyle({ '--background': 'black' })
    // Repeated roots redeclare packaged tokens and mask the host's root override.
    expect(view.container.querySelectorAll('.file-preview-root')).toHaveLength(1)
    expect(view.container.querySelectorAll('[data-file-preview-root]')).toHaveLength(1)
  })
})

describe('preview sessions', () => {
  it('closes a late open after unmount instead of leaking its document', async () => {
    const opened = document()
    let resolve!: (document: PreviewDocument) => void
    const pending = new Promise<PreviewDocument>((done) => {
      resolve = done
    })
    const view = render(<Preview source={source('old', () => pending)} />)
    view.unmount()
    await act(async () => {
      resolve(opened)
      await pending
    })
    expect(opened.close).toHaveBeenCalledTimes(1)
  })

  it('discards a superseded open without replacing the current document', async () => {
    const old = document()
    const current = document()
    let resolve!: (document: PreviewDocument) => void
    const pending = new Promise<PreviewDocument>((done) => {
      resolve = done
    })
    const view = render(<Preview source={source('old', () => pending)} />)
    view.rerender(<Preview source={source('current', async () => current)} />)
    await screen.findByText('current')
    await act(async () => {
      resolve(old)
      await pending
    })
    expect(screen.queryByText('old')).not.toBeInTheDocument()
    expect(old.close).toHaveBeenCalledTimes(1)
    expect(current.close).not.toHaveBeenCalled()
    view.unmount()
    expect(current.close).toHaveBeenCalledTimes(1)
  })

  it('opens a new session on refresh and closes each session once', async () => {
    const first = document()
    const second = document()
    const open = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    const input = source('same', open)
    const view = render(<Preview source={input} />)
    await screen.findByText('same')
    view.rerender(<Preview source={input} refreshKey={1} />)
    await waitFor(() => expect(open).toHaveBeenCalledTimes(2))
    await screen.findByText('same')
    expect(first.close).toHaveBeenCalledTimes(1)
    view.unmount()
    expect(second.close).toHaveBeenCalledTimes(1)
  })

  it('closes a document rejected by the size contract and reports a stable error', async () => {
    const opened = { ...document(), size: -1 }
    const onError = vi.fn()
    const onDiagnostic = vi.fn()
    render(<Preview source={source('invalid', async () => opened)} onError={onError} onDiagnostic={onDiagnostic} />)
    await screen.findByRole('heading', { name: 'Preview failed' })
    expect(opened.close).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'invalid_range' }))
    expect(onDiagnostic).toHaveBeenCalledTimes(1)
    expect(onDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'error',
        code: 'invalid_range',
        detail: onError.mock.calls[0][0]
      })
    )
  })

  it('reopens a previously failed source after switching away and back', async () => {
    const recovered = document()
    const open = vi.fn().mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValueOnce(recovered)
    const input = source('recovered', open)
    const view = render(<Preview source={input} />)
    await screen.findByRole('heading', { name: 'Preview failed' })
    view.rerender(<Preview source={source('other', async () => document())} />)
    await screen.findByText('other')
    view.rerender(<Preview source={input} />)
    await screen.findByText('recovered')
    expect(screen.queryByRole('heading', { name: 'Preview failed' })).not.toBeInTheDocument()
    view.unmount()
    expect(recovered.close).toHaveBeenCalledTimes(1)
  })

  it('keeps the open document and current page when the locale changes', async () => {
    const user = userEvent.setup()
    const opened = document()
    const open = vi.fn().mockResolvedValue(opened)
    const input = source('translated', open)
    const view = render(<Preview source={input} locale="en-us" />)
    await user.click(await screen.findByRole('button', { name: 'Page 1' }))
    view.rerender(<Preview source={input} locale="zh-cn" />)

    expect(screen.getByRole('button', { name: 'Page 2' })).toBeInTheDocument()
    expect(screen.queryByText('Loading preview...')).not.toBeInTheDocument()
    expect(open).toHaveBeenCalledTimes(1)
    expect(opened.close).not.toHaveBeenCalled()
  })

  it('requests opening an unsupported format only after the user clicks', async () => {
    const user = userEvent.setup()
    const open = vi.fn()
    const onRequestOpen = vi.fn()
    const input = { id: 'unsupported', name: 'file.unsupported', open }
    const view = render(<Preview source={input} onRequestOpen={onRequestOpen} />)
    view.rerender(<Preview source={input} refreshKey={1} onRequestOpen={onRequestOpen} />)

    expect(onRequestOpen).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Open with default app' }))
    expect(onRequestOpen).toHaveBeenCalledExactlyOnceWith('unsupported')
  })

  it('reports a source-open failure once through both host channels without changing its error code', async () => {
    const error = new PreviewError('closed', 'Source closed')
    const onError = vi.fn()
    const onDiagnostic = vi.fn()
    render(
      <Preview
        source={source('closed', async () => {
          throw error
        })}
        onError={onError}
        onDiagnostic={onDiagnostic}
      />
    )

    await screen.findByRole('heading', { name: 'Preview failed' })
    expect(onError).toHaveBeenCalledExactlyOnceWith(error)
    expect(onDiagnostic).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        level: 'error',
        code: 'closed',
        detail: error
      })
    )
  })

  it('contains render failures, closes the document and reports one diagnostic and error', async () => {
    const opened = document()
    const onError = vi.fn()
    const onDiagnostic = vi.fn()
    render(
      <Preview source={source('render-error', async () => opened)} onError={onError} onDiagnostic={onDiagnostic} />
    )

    await screen.findByRole('heading', { name: 'Preview failed' })
    expect(opened.close).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'source_changed' }))
    expect(onDiagnostic).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        level: 'error',
        code: 'source_changed',
        detail: onError.mock.calls[0][0]
      })
    )
  })
})
