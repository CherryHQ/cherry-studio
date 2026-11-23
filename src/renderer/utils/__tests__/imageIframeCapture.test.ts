import * as htmlToImage from 'html-to-image'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { captureScrollableIframe } from '../image'

vi.mock('html-to-image', () => ({ toCanvas: vi.fn() }))

describe('iframe font inlining', () => {
  let iframe: HTMLIFrameElement
  const fontUrl = 'https://example.com/capture-font.woff2'

  beforeEach(() => {
    vi.mocked(htmlToImage.toCanvas).mockReset().mockResolvedValue(document.createElement('canvas'))
    iframe = document.createElement('iframe')
    document.body.appendChild(iframe)
    const doc = iframe.contentDocument!
    doc.head.innerHTML = `<style>@font-face { font-family: Capture; src: url("${fontUrl}") }</style>`
    Object.defineProperty(doc.defaultView!, 'requestAnimationFrame', {
      configurable: true,
      value: (callback: FrameRequestCallback) => {
        callback(0)
        return 1
      }
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        blob: async () => new Blob(['font'], { type: 'font/woff2' })
      })
    )
  })

  afterEach(() => {
    iframe.remove()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('embeds successfully read font bytes into the exported CSS', async () => {
    await captureScrollableIframe({ current: iframe })
    const options = vi.mocked(htmlToImage.toCanvas).mock.calls.at(-1)?.[1]

    expect(options?.fontEmbedCSS).toContain('url(data:font/woff2;base64,Zm9udA==)')
    expect(iframe.contentDocument!.querySelector('[data-cs-inline-fonts]')).toBeNull()
  })

  it('retains the font URL when FileReader is aborted instead of exporting url(null)', async () => {
    const readAsDataURL = FileReader.prototype.readAsDataURL
    vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function (this: FileReader, blob: Blob) {
      readAsDataURL.call(this, blob)
      this.abort()
    })

    await captureScrollableIframe({ current: iframe })
    const options = vi.mocked(htmlToImage.toCanvas).mock.calls.at(-1)?.[1]

    expect(options?.fontEmbedCSS).toContain(`url(${fontUrl})`)
    expect(options?.fontEmbedCSS).not.toContain('url(null)')
    expect(iframe.contentDocument!.querySelector('[data-cs-inline-fonts]')).toBeNull()
  })
})
