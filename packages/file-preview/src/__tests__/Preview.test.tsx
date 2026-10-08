import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import type { CSSProperties, ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Preview } from '../Preview'
import type { PreviewDocument, PreviewSource } from '../source'

vi.mock('../filePreviewRegistry', () => ({
  resolvePreviewPlugin: () => ({
    id: 'test',
    load: async () => ({ default: ({ sourceId }: { sourceId: string }) => <div>{sourceId}</div> })
  })
}))
vi.mock('@cherrystudio/ui', () => ({
  EmptyState: ({ title }: { title: string }) => <div>{title}</div>,
  Scrollbar: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PortalContainerProvider: ({ children }: { children: ReactNode }) => children
}))
vi.mock('react-i18next', () => ({
  I18nextProvider: ({ children }: { children: ReactNode }) => children,
  useTranslation: () => ({ t: (key: string) => key })
}))

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
  it('carries host classes and token overrides, which is how mobile themes the preview', async () => {
    const view = render(
      <Preview
        source={source('styled', async () => document())}
        className="dark"
        style={{ '--background': 'black' } as CSSProperties}
      />
    )
    await screen.findByText('styled')

    const root = view.container.querySelector('[data-file-preview-root]')
    expect(root).toHaveClass('file-preview-root', 'dark')
    expect(root).toHaveStyle({ '--background': 'black' })
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
    render(<Preview source={source('invalid', async () => opened)} onError={onError} />)
    await screen.findByText('file_preview.load_error.title')
    expect(opened.close).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'invalid_range' }))
  })

  it('reopens a previously failed source after switching away and back', async () => {
    const recovered = document()
    const open = vi.fn().mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValueOnce(recovered)
    const input = source('recovered', open)
    const view = render(<Preview source={input} />)
    await screen.findByText('file_preview.load_error.title')
    view.rerender(<Preview source={source('other', async () => document())} />)
    await screen.findByText('other')
    view.rerender(<Preview source={input} />)
    await screen.findByText('recovered')
    expect(screen.queryByText('file_preview.load_error.title')).not.toBeInTheDocument()
    view.unmount()
    expect(recovered.close).toHaveBeenCalledTimes(1)
  })
})
