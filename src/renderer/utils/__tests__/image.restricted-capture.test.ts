import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn() } }))
vi.mock('@renderer/i18n/resolver', () => ({ default: { t: (key: string) => key } }))

import { captureScrollableIframe } from '../image'

// Runs the real html-to-image library (not mocked) and records every network fetch it attempts.
// html-to-image caches fetched resources by URL for the whole module lifetime, so every case needs its own URL.
let urlCounter = 0
const uniqueRemote = () => `https://example.com/collect-${urlCounter++}?secret=VALUE`

function createIframeRef(bodyHtml: string, headHtml = '') {
  const iframe = document.createElement('iframe')
  document.body.appendChild(iframe)
  const doc = iframe.contentDocument!
  doc.head.innerHTML = headHtml
  doc.body.innerHTML = bodyHtml
  iframe.contentWindow!.requestAnimationFrame = (cb: FrameRequestCallback) => {
    cb(0)
    return 0
  }
  // jsdom does not implement pseudo-element computed styles, which html-to-image requests for every node.
  const win = iframe.contentWindow!
  const getComputedStyle = win.getComputedStyle.bind(win)
  win.getComputedStyle = (el: Element) => getComputedStyle(el)
  return { current: iframe }
}

async function capturedFetchUrls(bodyHtml: string, restrict: boolean, headHtml = '') {
  const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 404 }))
  vi.stubGlobal('fetch', fetchMock)
  const ref = createIframeRef(bodyHtml, headHtml)
  stubImageSurface(ref.current.contentWindow!)
  await captureScrollableIframe(ref, restrict ? { restrictToLocalResources: true } : {})
  return { urls: fetchMock.mock.calls.map((call) => String(call[0])), ref }
}

// jsdom has no SVGImageElement and never loads images; give html-to-image the minimal surface it reads so the real
// clone/embed path runs. Patched on both the test window and the iframe window (clones live in the iframe realm).
function svgHrefAccessor(el: Element) {
  return {
    get baseVal() {
      return el.getAttribute('href') ?? el.getAttribute('xlink:href') ?? ''
    },
    set baseVal(value: string) {
      el.setAttribute('href', value)
      setTimeout(() => el.dispatchEvent(new Event('load')), 0)
    }
  }
}

function stubImageSurface(iframeWindow: Window) {
  class FakeSvgImageElement {
    static [Symbol.hasInstance](value: unknown) {
      try {
        const el = value as Element
        return el.localName === 'image' && el.namespaceURI === 'http://www.w3.org/2000/svg'
      } catch {
        return false // html-to-image also probes prototype objects
      }
    }
  }
  vi.stubGlobal('SVGImageElement', FakeSvgImageElement)
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0))
  for (const win of [window, iframeWindow] as unknown as Array<typeof globalThis>) {
    Object.defineProperty(win.SVGElement.prototype, 'href', {
      configurable: true,
      get(this: Element) {
        return svgHrefAccessor(this)
      }
    })
    Object.defineProperty(win.HTMLImageElement.prototype, 'decode', {
      configurable: true,
      writable: true,
      value: () => Promise.resolve()
    })
    Object.defineProperty(win.HTMLImageElement.prototype, 'src', {
      configurable: true,
      get(this: HTMLImageElement) {
        return this.getAttribute('src') ?? ''
      },
      set(this: HTMLImageElement, value: string) {
        this.setAttribute('src', value)
        setTimeout(() => this.dispatchEvent(new Event('load')), 0)
      }
    })
  }
}

function restoreImageSurface() {
  document.querySelectorAll('iframe').forEach((iframe) => {
    const win = iframe.contentWindow as unknown as typeof globalThis
    delete (win.SVGElement.prototype as { href?: unknown }).href
    delete (win.HTMLImageElement.prototype as { decode?: unknown }).decode
    delete (win.HTMLImageElement.prototype as { src?: unknown }).src
  })
  delete (SVGElement.prototype as { href?: unknown }).href
  delete (HTMLImageElement.prototype as { decode?: unknown }).decode
  delete (HTMLImageElement.prototype as { src?: unknown }).src
}

describe('captureScrollableIframe restricted capture with the real html-to-image library', () => {
  afterEach(() => {
    document.querySelectorAll('iframe').forEach((iframe) => iframe.remove())
    vi.unstubAllGlobals()
    restoreImageSurface()
  })

  const buildCases = (REMOTE: string): Record<string, string> => ({
    'svg image href': `<div><svg width="10" height="10"><image href="${REMOTE}"/></svg></div>`,
    'svg image xlink:href': `<div><svg width="10" height="10" xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="${REMOTE}"/></svg></div>`,
    'svg use': `<svg width="10" height="10"><use href="${REMOTE}#a"/></svg>`,
    'svg feImage': `<svg width="10" height="10"><filter id="f"><feImage href="${REMOTE}"/></filter><rect width="5" height="5" filter="url(#f)"/></svg>`,
    'svg pattern image': `<svg width="10" height="10"><pattern id="p" width="1" height="1"><image href="${REMOTE}"/></pattern><rect fill="url(#p)" width="5" height="5"/></svg>`,
    'svg foreignObject img': `<svg width="10" height="10"><foreignObject width="10" height="10"><img src="${REMOTE}"/></foreignObject></svg>`,
    'svg style url': `<svg width="10" height="10"><rect style="fill:url(${REMOTE})" width="5" height="5"/></svg>`,
    'svg style element': `<svg width="10" height="10"><style>rect{fill:url("${REMOTE}")}</style><rect width="5" height="5"/></svg>`,
    'html background': `<div style="background-image:url(${REMOTE})">x</div>`,
    'html mask': `<div style="-webkit-mask-image:url(${REMOTE});mask-image:url(${REMOTE})">x</div>`
  })

  for (const name of Object.keys(buildCases(''))) {
    it(`never fetches remote URLs from the parent: ${name}`, async () => {
      const remote = uniqueRemote()
      const { urls } = await capturedFetchUrls(buildCases(remote)[name], true)
      expect(urls.filter((url) => url.includes('example.com'))).toEqual([])
    })
  }

  it('restores the original SVG attributes after capture', async () => {
    const remote = uniqueRemote()
    const { ref } = await capturedFetchUrls(buildCases(remote)['svg image href'], true)
    expect(ref.current.contentDocument!.querySelector('image')!.getAttribute('href')).toBe(remote)
  })

  it('keeps data URL SVG images and in-document references', async () => {
    const dataUrl = 'data:image/png;base64,AAAA'
    const { ref } = await capturedFetchUrls(
      `<svg width="10" height="10"><image href="${dataUrl}"/><use href="#a"/></svg>`,
      true
    )
    const doc = ref.current.contentDocument!
    expect(doc.querySelector('image')!.getAttribute('href')).toBe(dataUrl)
    expect(doc.querySelector('use')!.getAttribute('href')).toBe('#a')
  })

  it('still fetches SVG images in the default (unrestricted) mode', async () => {
    const { urls } = await capturedFetchUrls(buildCases(uniqueRemote())['svg image href'], false)
    expect(urls.some((url) => url.includes('example.com'))).toBe(true)
  })
})
