import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildMiniAppCsp, createMiniAppProtocolHandler } from '../protocol'

const APP_ID = 'com.example.mygame'

let work: string
let root: string
let handler: (request: Request) => Promise<Response>

beforeEach(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'miniapp-proto-'))
  root = path.join(work, 'pkg')
  fs.mkdirSync(path.join(work, 'outside'), { recursive: true })
  fs.mkdirSync(root, { recursive: true })
  fs.writeFileSync(path.join(root, 'index.html'), '<h1>hi</h1>')
  fs.writeFileSync(path.join(work, 'outside', 'secret.txt'), 'SECRET')
  // The handler reads `/__cherry/theme.css` from an assets dir; point it at a fixture.
  const assets = path.join(work, 'assets')
  fs.mkdirSync(assets, { recursive: true })
  fs.writeFileSync(path.join(assets, 'miniAppTheme.css'), ':root { --cs-bg: #fff; }')
  handler = createMiniAppProtocolHandler(APP_ID, (id) => (id === APP_ID ? root : undefined), assets)
})
afterEach(() => {
  // This file spies on `fs.promises` and there is no global `restoreMocks`: a case that
  // fails before its own `mockRestore` would hand the next one a queued rejection.
  vi.restoreAllMocks()
  fs.rmSync(work, { recursive: true, force: true })
})

const get = (url: string) => handler(new Request(url))

describe('mini app protocol handler', () => {
  it('releases the read slot when the guest cancels mid-stream', async () => {
    // The bug this guards: releasing only in `flush`. A cancelled fetch never calls it
    // (measured on Node 24), so eight requests wedge the guest's own protocol.
    fs.writeFileSync(path.join(root, 'big.bin'), Buffer.alloc(4 * 1024 * 1024))

    for (let i = 0; i < 12; i++) {
      const res = await get(`cherry-miniapp://${APP_ID}/big.bin`)
      await res.body!.cancel()
    }

    // Still serving: if slots leaked, this would never resolve.
    await expect(get(`cherry-miniapp://${APP_ID}/index.html`)).resolves.toMatchObject({ status: 200 })
  })

  it("lets an app saturate only its own read slots, never a neighbour's", async () => {
    // The slots bound main-process memory per guest; shared across guests they were also
    // a way for one app to keep every other app from loading its own index.html.
    const HOG = 'com.example.hog'
    const hogRoot = path.join(work, 'hog-pkg')
    fs.mkdirSync(hogRoot, { recursive: true })
    fs.writeFileSync(path.join(hogRoot, 'big.bin'), Buffer.alloc(4 * 1024 * 1024))
    const hog = createMiniAppProtocolHandler(HOG, (id) => (id === HOG ? hogRoot : undefined), path.join(work, 'assets'))

    // Every active slot held and none consumed: the hog's own next read would queue.
    const held: Response[] = []
    for (let i = 0; i < 8; i++) held.push(await hog(new Request(`cherry-miniapp://${HOG}/big.bin`)))

    await expect(get(`cherry-miniapp://${APP_ID}/index.html`)).resolves.toMatchObject({ status: 200 })

    for (const res of held) await res.body!.cancel()
  })

  it('releases the read slot when the file cannot be opened', async () => {
    const open = vi.spyOn(fs.promises, 'open').mockRejectedValueOnce(new Error('EMFILE'))

    await expect(get(`cherry-miniapp://${APP_ID}/index.html`)).rejects.toThrow('EMFILE')
    open.mockRestore()

    await expect(get(`cherry-miniapp://${APP_ID}/index.html`)).resolves.toMatchObject({ status: 200 })
  })

  it('streams a large file instead of buffering it', async () => {
    // The bug this guards: `readFile` per request lets a sandboxed guest allocate main
    // memory at will — containment says WHAT it may read, not how much is resident.
    const readFile = vi.spyOn(fs.promises, 'readFile')
    fs.writeFileSync(path.join(root, 'big.bin'), Buffer.alloc(1024 * 1024))

    const res = await get(`cherry-miniapp://${APP_ID}/big.bin`)

    expect(res.headers.get('content-length')).toBe(String(1024 * 1024))
    expect(readFile).not.toHaveBeenCalled()
    await res.arrayBuffer()
    readFile.mockRestore()
  })

  it('serves a package file', async () => {
    const res = await get(`cherry-miniapp://${APP_ID}/index.html`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(await res.text()).toBe('<h1>hi</h1>')
  })

  it('serves index.html for a bare root request', async () => {
    expect(await (await get(`cherry-miniapp://${APP_ID}/`)).text()).toBe('<h1>hi</h1>')
  })

  it('sends the sandboxing CSP on the HTML document itself', async () => {
    // The storage/WebRTC probes proved the sandbox on THIS header, not on
    // `webRequest.onHeadersReceived`; without it the guest keeps a real origin and
    // native localStorage/IndexedDB bypass cherry.storage entirely.
    const res = await get(`cherry-miniapp://${APP_ID}/index.html`)
    const csp = res.headers.get('content-security-policy')
    expect(csp).toContain('sandbox allow-scripts')
    expect(csp).toBe(buildMiniAppCsp())
  })

  it('sends the CSP on every package file, since any of them can be navigated to', async () => {
    // Same-origin navigation is allowed, so `location = 'x.svg'` makes a scripted SVG
    // the top-level document — an unsandboxed one, if only `.html` carried the header.
    fs.writeFileSync(path.join(root, 'x.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>')
    expect((await get(`cherry-miniapp://${APP_ID}/x.svg`)).headers.get('content-security-policy')).toBe(
      buildMiniAppCsp()
    )
    expect((await get(`cherry-miniapp://${APP_ID}/missing`)).headers.get('content-security-policy')).toBe(
      buildMiniAppCsp()
    )
  })

  it('404s an unknown app', async () => {
    expect((await get('cherry-miniapp://com.example.nope/index.html')).status).toBe(404)
  })

  it('keeps the CORS header on error responses so the guest can observe the status', async () => {
    // Without it the sandboxed (opaque-origin) guest sees a TypeError instead of a 404.
    const res = await get(`cherry-miniapp://${APP_ID}/missing.json`)
    expect(res.status).toBe(404)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('blocks a symlink escaping the package root', async () => {
    fs.symlinkSync(path.join(work, 'outside', 'secret.txt'), path.join(root, 'escape.txt'))
    const res = await get(`cherry-miniapp://${APP_ID}/escape.txt`)
    expect(res.status).toBe(403)
    expect(await res.text()).not.toContain('SECRET')
  })

  it.each([
    ['encoded separators', `cherry-miniapp://${APP_ID}/x%2f..%2f..%2foutside/secret.txt`],
    ['double-encoded separators', `cherry-miniapp://${APP_ID}/x%252f..%252f..%252foutside/secret.txt`],
    ['a doubled leading slash', `cherry-miniapp://${APP_ID}//../outside/secret.txt`],
    ['backslashes', `cherry-miniapp://${APP_ID}/x%5c..%5c..%5coutside/secret.txt`]
  ])('blocks dot-dot traversal hidden behind %s', async (_label, url) => {
    // The URL parser folds a plain `/../`; these survive it and only `decodeURIComponent`
    // + realpath containment stand between them and a file outside the package.
    const res = await get(url)

    expect([403, 404]).toContain(res.status)
    expect(await res.text()).not.toContain('SECRET')
  })

  it('blocks a sibling directory that merely shares the root prefix', async () => {
    // The bug this guards: `real.startsWith(root)` without the separator. `pkg-evil`
    // starts with `pkg`, so the naive check reads it as inside and serves the file.
    const sibling = `${root}-evil`
    fs.mkdirSync(sibling, { recursive: true })
    fs.writeFileSync(path.join(sibling, 'secret.txt'), 'SECRET')
    fs.symlinkSync(path.join(sibling, 'secret.txt'), path.join(root, 'near.txt'))

    const res = await get(`cherry-miniapp://${APP_ID}/near.txt`)

    expect(res.status).toBe(403)
    expect(await res.text()).not.toContain('SECRET')
  })

  it('serves the host theme from the reserved path', async () => {
    const res = await get(`cherry-miniapp://${APP_ID}/__cherry/theme.css`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/css')
  })

  it('404s an unknown reserved path without falling through to disk', async () => {
    fs.mkdirSync(path.join(root, '__cherry'), { recursive: true })
    fs.writeFileSync(path.join(root, '__cherry', 'sneaky.txt'), 'SNEAKY')
    const res = await get(`cherry-miniapp://${APP_ID}/__cherry/sneaky.txt`)
    expect(res.status).toBe(404)
    expect(await res.text()).not.toContain('SNEAKY')
  })
})

describe('buildMiniAppCsp', () => {
  it('denies connect entirely', () => {
    // Not `'self'`: nothing the document itself may reach over the network.
    expect(buildMiniAppCsp()).toContain("connect-src 'none'")
  })

  it('denies frames and workers', () => {
    expect(buildMiniAppCsp()).toContain("frame-src 'none'")
    expect(buildMiniAppCsp()).toContain("worker-src 'none'")
  })

  it('always sandboxes the document so native web storage is denied', () => {
    // Without this the app can use IndexedDB directly, bypassing cherry.storage's
    // grant, quota and clear-data entirely — and survive uninstall.
    expect(buildMiniAppCsp()).toContain('sandbox allow-scripts')
  })

  it('names no remote host anywhere', () => {
    // The control for the four above: a CSP that still interpolated a host list would
    // pass every one of them while leaving the old surface open.
    expect(buildMiniAppCsp()).not.toMatch(/https?:\/\//)
  })
})
