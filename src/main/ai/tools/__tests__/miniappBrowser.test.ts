import { beforeEach, describe, expect, it, vi } from 'vitest'

// The guest page is a fake webContents: what matters here is the BINDING — which
// page a call may drive — not Chromium. executeJavaScript runs the scripted
// answers the test installs.
const { guests } = vi.hoisted(() => ({ guests: new Map<number, unknown>() }))
vi.mock('electron', () => ({
  webContents: { fromId: (id: number) => guests.get(id) }
}))

const { previewServiceStub, runtimeServiceStub } = vi.hoisted(() => ({
  previewServiceStub: { getPreview: vi.fn() },
  runtimeServiceStub: { guestsOf: vi.fn(() => [] as number[]) }
}))

import { mockMiniAppApplication } from '@main/features/miniApp/__tests__/applicationMock'

vi.mock('@application', () =>
  mockMiniAppApplication({ MiniAppPreviewService: previewServiceStub, MiniAppRuntimeService: runtimeServiceStub })
)

const { runMiniappBrowser } = await import('../miniappBrowser')

interface FakeGuest {
  id: number
  isDestroyed: () => boolean
  getURL: () => string
  getTitle: () => string
  executeJavaScript: ReturnType<typeof vi.fn>
  capturePage: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  once: ReturnType<typeof vi.fn>
}

function makeGuest(id: number, scriptAnswers: Array<unknown> = []): FakeGuest {
  const answers = [...scriptAnswers]
  return {
    id,
    isDestroyed: () => false,
    getURL: () => 'cherry-miniapp://preview-p1/index.html',
    getTitle: () => 'Preview',
    executeJavaScript: vi.fn(async () => answers.shift()),
    capturePage: vi.fn(async () => ({ toPNG: () => Buffer.from('png-bytes') })),
    on: vi.fn(),
    once: vi.fn()
  }
}

const PREVIEW = {
  previewId: 'p1',
  runtimeId: 'preview-p1',
  sessionId: 'topic-1',
  appId: 'com.example.toolfixture',
  version: '1.0.0',
  packageSha256: 'sha256:x',
  openedAt: 1
}

beforeEach(() => {
  guests.clear()
  vi.clearAllMocks()
  previewServiceStub.getPreview.mockReturnValue(PREVIEW)
  runtimeServiceStub.guestsOf.mockReturnValue([])
})

describe('miniapp-browser tool core', () => {
  it('refuses without a session', async () => {
    const out = await runMiniappBrowser({ action: 'snapshot', previewId: 'p1' }, {})
    expect(out).toMatchObject({ code: 'no-session' })
  })

  it('refuses a preview another session owns', async () => {
    previewServiceStub.getPreview.mockReturnValueOnce({ ...PREVIEW, sessionId: 'topic-2' })
    const out = await runMiniappBrowser({ action: 'snapshot', previewId: 'p1' }, { sessionId: 'topic-1' })
    expect(out).toMatchObject({ code: 'unknown-preview' })
  })

  it('refuses an unknown or closed preview', async () => {
    previewServiceStub.getPreview.mockReturnValueOnce(undefined)
    const out = await runMiniappBrowser({ action: 'snapshot', previewId: 'gone' }, { sessionId: 'topic-1' })
    expect(out).toMatchObject({ code: 'unknown-preview' })
  })

  it('refuses when the preview has no live page', async () => {
    const out = await runMiniappBrowser({ action: 'snapshot', previewId: 'p1' }, { sessionId: 'topic-1' })
    expect(out).toMatchObject({ code: 'no-page' })
  })

  it('snapshots the bound guest’s DOM', async () => {
    const guest = makeGuest(7, ['<html><body>hi</body></html>'])
    guests.set(7, guest)
    runtimeServiceStub.guestsOf.mockReturnValue([7])

    const out = await runMiniappBrowser({ action: 'snapshot', previewId: 'p1' }, { sessionId: 'topic-1' })

    expect(out).toMatchObject({ title: 'Preview' })
    expect((out as { dom: string }).dom).toContain('hi')
    expect(guest.executeJavaScript).toHaveBeenCalledOnce()
  })

  it('click reports a missing element distinctly', async () => {
    guests.set(7, makeGuest(7, [false]))
    runtimeServiceStub.guestsOf.mockReturnValue([7])

    const out = await runMiniappBrowser(
      { action: 'click', previewId: 'p1', selector: '#nope' },
      { sessionId: 'topic-1' }
    )
    expect(out).toMatchObject({ code: 'no-element' })
  })

  it('wait succeeds when the predicate turns truthy', async () => {
    guests.set(7, makeGuest(7, [true]))
    runtimeServiceStub.guestsOf.mockReturnValue([7])

    const out = await runMiniappBrowser(
      { action: 'wait', previewId: 'p1', predicate: 'document.readyState === "complete"' },
      { sessionId: 'topic-1' }
    )
    expect(out).toEqual({ ok: true })
  })

  it('wait reports a timeout distinctly', async () => {
    guests.set(7, makeGuest(7, [false]))
    runtimeServiceStub.guestsOf.mockReturnValue([7])

    const out = await runMiniappBrowser(
      { action: 'wait', previewId: 'p1', predicate: 'window.done' },
      { sessionId: 'topic-1' }
    )
    expect(out).toMatchObject({ code: 'wait-timeout' })
  })

  it('re-resolves the preview per call: a replaced preview kills the old target', async () => {
    guests.set(7, makeGuest(7, ['<html/>']))
    runtimeServiceStub.guestsOf.mockReturnValue([7])

    await runMiniappBrowser({ action: 'snapshot', previewId: 'p1' }, { sessionId: 'topic-1' })
    // The preview closed between calls: the very same previewId no longer binds.
    previewServiceStub.getPreview.mockReturnValueOnce(undefined)
    const out = await runMiniappBrowser({ action: 'snapshot', previewId: 'p1' }, { sessionId: 'topic-1' })
    expect(out).toMatchObject({ code: 'unknown-preview' })
  })

  it('screenshots the bound guest as PNG', async () => {
    const guest = makeGuest(7)
    guests.set(7, guest)
    runtimeServiceStub.guestsOf.mockReturnValue([7])

    const out = await runMiniappBrowser({ action: 'screenshot', previewId: 'p1' }, { sessionId: 'topic-1' })
    expect((out as { pngBase64: string }).pngBase64).toBe(Buffer.from('png-bytes').toString('base64'))
  })
})
