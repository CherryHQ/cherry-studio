import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { toCanvas } from 'html-to-image'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import { CodeStyleProvider } from '@renderer/components/CodeStyleProvider'
import { exportService } from '@renderer/services/ExportService'
import { toast } from '@renderer/services/toast'

import TranslateOutputPane from '../TranslateOutputPane'

vi.mock('react-i18next', () => {
  const t = (key: string) => key
  return { initReactI18next: { type: '3rdParty', init: vi.fn() }, useTranslation: () => ({ t }) }
})
vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())
// Rasterization and the OS clipboard are the external boundaries. Keep the
// output pane, markdown renderer, export queue, and PNG clipboard utility real.
vi.mock('html-to-image', () => ({ toCanvas: vi.fn() }))

const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
const canvas = () => ({ width: 360, height: 4096, toDataURL: () => png }) as HTMLCanvasElement
const write = vi.fn<(items: ClipboardItem[]) => Promise<void>>()
const props = () => ({
  translatedContent: 'Translated text',
  enableMarkdown: false,
  translating: false,
  copied: false,
  onCopy: vi.fn(),
  onExportToNotes: vi.fn(),
  onScroll: vi.fn()
})
const button = () => screen.getByRole('button', { name: 'preview.copy.image' })
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

beforeAll(() => {
  // Ensure the real service has loaded before testing a user's first click.
  expect(exportService).toBeDefined()
  vi.stubGlobal(
    'ClipboardItem',
    class {
      readonly types: string[]
      constructor(private readonly data: Record<string, Blob>) {
        this.types = Object.keys(data)
      }
      async getType(type: string) {
        return this.data[type]
      }
    }
  )
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write } })
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(private readonly callback: IntersectionObserverCallback) {}
      observe(target: Element) {
        this.callback(
          [{ isIntersecting: true, target } as IntersectionObserverEntry],
          this as unknown as IntersectionObserver
        )
      }
      unobserve() {}
      disconnect() {}
    }
  )
})
afterAll(() => {
  vi.unstubAllGlobals()
})
beforeEach(() => {
  vi.mocked(toCanvas)
    .mockReset()
    .mockImplementation(async () => canvas())
  write.mockReset().mockResolvedValue(undefined)
})

describe('copy translated output as an image', () => {
  it('copies the full scroll height, without output controls or the character counter', async () => {
    const text = 'First translated line\n' + 'Long translation\n'.repeat(200) + 'Last translated line'
    const view = render(<TranslateOutputPane {...props()} translatedContent={text} />)
    const body = view.container.querySelector<HTMLDivElement>('[data-ui="translate.output-content"]')!
    Object.defineProperties(body, { scrollWidth: { value: 360 }, scrollHeight: { value: 4096 } })
    fireEvent.click(button())
    await waitFor(() => expect(write).toHaveBeenCalledOnce())
    expect(toCanvas).toHaveBeenLastCalledWith(body, expect.objectContaining({ width: 360, height: 4096 }))
    expect(body).toHaveTextContent('First translated line')
    expect(body).toHaveTextContent('Last translated line')
    expect(body.querySelector('button')).toBeNull()
    expect(body.textContent).toBe(text)
    const item = write.mock.calls[0][0][0]
    expect(item.types).toEqual(['image/png'])
    expect((await item.getType('image/png')).type).toBe('image/png')
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('message.copied'))
  })

  it('captures rendered Markdown and KaTeX instead of their source markers', async () => {
    const view = render(
      <TranslateOutputPane {...props()} enableMarkdown translatedContent={'## Translation\n\n**Result**: $x^2$'} />,
      { wrapper: CodeStyleProvider }
    )
    expect(screen.getByRole('heading', { name: 'Translation' })).toBeInTheDocument()
    const body = view.container.querySelector<HTMLDivElement>('[data-ui="translate.output-content"]')!
    expect(body.querySelector('.katex')).not.toBeNull()
    fireEvent.click(button())
    await waitFor(() => expect(write).toHaveBeenCalledOnce())
    expect(toCanvas).toHaveBeenLastCalledWith(body, expect.any(Object))
    expect(body.textContent).not.toContain('##')
    expect(body.textContent).not.toContain('**')
  })

  it.each([
    { translatedContent: '' },
    { translatedContent: '   ' },
    { translatedContent: 'Partial result', translating: true }
  ])('disables copying for unavailable or streaming output: %j', (overrides) => {
    render(<TranslateOutputPane {...props()} {...overrides} />)
    expect(button()).toBeDisabled()
    fireEvent.click(button())
    expect(toCanvas).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
  })

  it('waits for the clipboard write and prevents duplicate clicks', async () => {
    const pending = deferred<void>()
    write.mockReturnValueOnce(pending.promise)
    render(<TranslateOutputPane {...props()} />)
    fireEvent.click(button())
    fireEvent.click(button())
    await waitFor(() => expect(write).toHaveBeenCalledOnce())
    expect(button()).toBeDisabled()
    expect(toast.success).not.toHaveBeenCalled()
    await act(async () => pending.resolve())
    await waitFor(() => expect(button()).toBeEnabled())
    expect(toast.success).toHaveBeenCalledOnce()
  })

  it('reports a rejected clipboard write and permits a retry', async () => {
    write.mockRejectedValueOnce(new Error('Clipboard unavailable'))
    render(<TranslateOutputPane {...props()} />)
    fireEvent.click(button())
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('common.copy_failed'))
    expect(toast.success).not.toHaveBeenCalled()
    expect(button()).toBeEnabled()
    fireEvent.click(button())
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('message.copied'))
    expect(write).toHaveBeenCalledTimes(2)
  })

  it('reports rasterization failures without writing to the clipboard', async () => {
    vi.mocked(toCanvas).mockRejectedValueOnce(new Error('Canvas unavailable'))
    render(<TranslateOutputPane {...props()} />)
    fireEvent.click(button())
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('common.copy_failed'))
    expect(write).not.toHaveBeenCalled()
    expect(button()).toBeEnabled()
  })

  it.each(['replace', 'restart', 'unmount'] as const)('discards a capture after %s', async (change) => {
    const pending = deferred<HTMLCanvasElement>()
    vi.mocked(toCanvas).mockReturnValueOnce(pending.promise)
    const initial = props()
    const view = render(<TranslateOutputPane {...initial} />)
    fireEvent.click(button())
    await waitFor(() => expect(toCanvas).toHaveBeenCalledOnce())
    if (change === 'unmount') view.unmount()
    else if (change === 'restart') view.rerender(<TranslateOutputPane {...initial} translating />)
    else {
      view.rerender(<TranslateOutputPane {...initial} translatedContent="Replacement" />)
      view.rerender(<TranslateOutputPane {...initial} />)
    }
    await act(async () => {
      pending.resolve(canvas())
    })
    // The real export queue finishes its warmup and final rasterization.
    await waitFor(() => expect(toCanvas).toHaveBeenCalledTimes(2))
    if (change !== 'unmount') await waitFor(() => expect(button()).toHaveAttribute('aria-busy', 'false'))
    expect(write).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })
})
