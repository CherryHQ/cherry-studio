import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn() } }))
vi.mock('@renderer/i18n/resolver', () => ({ default: { t: (key: string) => key } }))

import { captureScrollableIframe, neutralizeCssText, parseCssUrlTokens } from '../image'

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
    'html mask': `<div style="-webkit-mask-image:url(${REMOTE});mask-image:url(${REMOTE})">x</div>`,
    // Regression for the quoted-paren miss: a valid quoted url() whose value contains ')' must still be neutralized.
    'svg style url quoted paren': `<svg width="10" height="10"><rect style="fill:url('${REMOTE})x.png')" width="5" height="5"/></svg>`,
    'svg style url escaped paren': `<svg width="10" height="10"><rect style="fill:url(${REMOTE}\\)x.png)" width="5" height="5"/></svg>`,
    'svg style url uppercase': `<svg width="10" height="10"><rect style="fill:URL(${REMOTE})" width="5" height="5"/></svg>`,
    'svg style element quoted paren': `<svg width="10" height="10"><style>rect{fill:url("${REMOTE})x.png")}</style><rect width="5" height="5"/></svg>`,
    'svg paint attribute quoted paren': `<svg width="10" height="10"><rect fill="url('${REMOTE})x.png')" width="5" height="5"/></svg>`,
    'html background quoted paren': `<div style="background-image:url('${REMOTE})x.png')">x</div>`
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

  it('restores the original style attribute after neutralizing a quoted url with a paren', async () => {
    const remote = uniqueRemote()
    const { ref } = await capturedFetchUrls(buildCases(remote)['svg style url quoted paren'], true)
    expect(ref.current.contentDocument!.querySelector('rect')!.getAttribute('style')).toBe(
      `fill:url('${remote})x.png')`
    )
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

describe('parseCssUrlTokens', () => {
  const urls = (text: string) => parseCssUrlTokens(text).map((token) => token.url)

  it('parses quoted values containing a closing paren', () => {
    expect(urls("url('https://example.com/a)b.png')")).toEqual(['https://example.com/a)b.png'])
    expect(urls('url("https://example.com/a)b.png")')).toEqual(['https://example.com/a)b.png'])
  })

  it('resolves CSS escapes, including an escaped paren in unquoted values', () => {
    expect(urls('url(https://example.com/a\\)b.png)')).toEqual(['https://example.com/a)b.png'])
    expect(urls('url(\\68 ttps://example.com/a.png)')).toEqual(['https://example.com/a.png'])
    expect(urls("url('it\\'s.png')")).toEqual(["it's.png"])
  })

  it('matches url case-insensitively and allows surrounding whitespace', () => {
    expect(urls('URL(https://example.com/a.png)')).toEqual(['https://example.com/a.png'])
    expect(urls('url(  https://example.com/a.png\t)')).toEqual(['https://example.com/a.png'])
    expect(urls("url( 'https://example.com/a.png' )")).toEqual(['https://example.com/a.png'])
  })

  it('finds every token in a multi-url value', () => {
    expect(urls("background:url('a.png'), URL(data:,) , url(#m)")).toEqual(['a.png', 'data:,', '#m'])
  })

  it('ignores url-like text in strings and comments, and ident prefixes', () => {
    expect(urls('content:"url(a.png)"')).toEqual([])
    expect(urls('/* url(a.png) */')).toEqual([])
    expect(urls('myurl(a.png)')).toEqual([])
  })

  it('skips malformed (bad-url) tokens the CSS parser would also drop', () => {
    expect(urls("url(a'b.png)")).toEqual([])
    expect(urls('url(a(.png)')).toEqual([])
    expect(urls("url('unterminated")).toEqual([])
  })

  it('keeps the exact source span for replacements', () => {
    const text = "fill:url('a)b.png')"
    const [token] = parseCssUrlTokens(text)
    expect(text.slice(token.start, token.end)).toBe("url('a)b.png')")
  })
})

describe('neutralizeCssText', () => {
  const base = 'https://app.local/index.html'
  const REMOTE = 'https://example.com/collect?secret=VALUE'

  it('replaces quoted urls containing a closing paren', () => {
    expect(neutralizeCssText(`fill:url('${REMOTE})b.png')`, base)).toBe('fill:url("data:,")')
    expect(neutralizeCssText(`fill:url("${REMOTE})b.png")`, base)).toBe('fill:url("data:,")')
  })

  it('replaces escaped and case-insensitive remote urls', () => {
    expect(neutralizeCssText(`fill:url(${REMOTE}\\)b.png)`, base)).toBe('fill:url("data:,")')
    expect(neutralizeCssText(`fill:URL(${REMOTE})`, base)).toBe('fill:url("data:,")')
  })

  it('replaces only the remote urls in a multi-url value', () => {
    expect(neutralizeCssText(`background:url('${REMOTE})a.png'), url(data:,)`, base)).toBe(
      'background:url("data:,"), url(data:,)'
    )
  })

  it('keeps local urls, in-document references and empty urls untouched', () => {
    expect(neutralizeCssText("fill:url('data:image/png;base64,AAAA')", base)).toBe(
      "fill:url('data:image/png;base64,AAAA')"
    )
    expect(neutralizeCssText('filter:url(#f1)', base)).toBe('filter:url(#f1)')
    expect(neutralizeCssText("fill:url('')", base)).toBe("fill:url('')")
  })

  it('leaves strings, comments and non-url idents untouched', () => {
    expect(neutralizeCssText(`content:"url(${REMOTE})"`, base)).toBe(`content:"url(${REMOTE})"`)
    expect(neutralizeCssText(`/* url(${REMOTE}) */`, base)).toBe(`/* url(${REMOTE}) */`)
    expect(neutralizeCssText(`myurl(${REMOTE})`, base)).toBe(`myurl(${REMOTE})`)
  })
})
