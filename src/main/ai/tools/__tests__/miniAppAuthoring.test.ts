import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import JSZip from 'jszip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The preview service is the collaborator: these tests cover the TOOL core —
// authorization, tokens in and out, error shapes — not preview opening. The
// service's own suite covers what opening does.
const { previewServiceStub } = vi.hoisted(() => ({
  previewServiceStub: {
    openPreview: vi.fn(),
    getPreview: vi.fn(),
    listSessionPreviews: vi.fn(() => []),
    closePreview: vi.fn(async () => undefined),
    closeSessionPreviews: vi.fn(async () => ({ closed: 0, tokensRevoked: 0 }))
  }
}))

import { mockMiniAppApplication } from '@main/features/miniApp/__tests__/applicationMock'

vi.mock('@application', () => mockMiniAppApplication({ MiniAppPreviewService: previewServiceStub }))

const {
  closeMiniAppPreviews,
  miniAppPreviewStatus,
  previewValidatedMiniApp,
  runMiniAppAuthoring,
  validateMiniAppPackage
} = await import('../miniAppAuthoring')
const { issueArtifactToken, expectArtifactToken, ArtifactTokenError } =
  await import('@main/features/miniApp/preview/artifactTokens')

const MANIFEST = {
  id: 'com.example.toolfixture',
  name: 'Tool Fixture',
  description: 'Fixture for the mini_app tool.',
  version: '2.0.0',
  entry: 'index.html'
}

let work: string
let workspace: string

beforeEach(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'miniapp-tool-'))
  workspace = path.join(work, 'workspace')
  fs.mkdirSync(workspace, { recursive: true })
  vi.clearAllMocks()
  previewServiceStub.listSessionPreviews.mockReturnValue([])
  previewServiceStub.closeSessionPreviews.mockResolvedValue({ closed: 0, tokensRevoked: 0 })
})

afterEach(() => fs.rmSync(work, { recursive: true, force: true }))

async function writePackage(dir: string): Promise<string> {
  const zip = new JSZip()
  zip.file('manifest.json', JSON.stringify(MANIFEST))
  zip.file('index.html', '<h1>tool</h1>')
  const p = path.join(dir, `pkg-${Math.random().toString(36).slice(2)}.miniapp`)
  fs.writeFileSync(p, await zip.generateAsync({ type: 'nodebuffer', platform: 'UNIX' }))
  return p
}

function ctxFor(dir: string, sessionId = 'topic-1') {
  return { sessionId, roots: [{ uri: `file://${dir}` }] }
}

describe('mini_app tool core', () => {
  it('validates a package under the session workspace and returns a bound token', async () => {
    const pkg = await writePackage(workspace)

    const out = await validateMiniAppPackage(pkg, ctxFor(workspace))

    expect(out).toMatchObject({ appId: 'com.example.toolfixture', version: '2.0.0' })
    const token = (out as { artifactToken: string }).artifactToken
    // The token really is bound to this session and these bytes.
    const record = expectArtifactToken(token, 'topic-1')
    expect(record.packagePath).toBe(fs.realpathSync(pkg))
    expect(record.sha256).toBe((out as { sha256: string }).sha256)
    expect(() => expectArtifactToken(token, 'topic-2')).toThrowError(ArtifactTokenError)
  })

  it('refuses a package outside every workspace root', async () => {
    const outside = path.join(work, 'outside')
    fs.mkdirSync(outside)
    const pkg = await writePackage(outside)

    const out = await validateMiniAppPackage(pkg, ctxFor(workspace))

    expect(out).toMatchObject({ code: 'path-not-authorized' })
  })

  it('refuses a relative package path', async () => {
    const out = await validateMiniAppPackage('relative/pkg.miniapp', ctxFor(workspace))
    expect(out).toMatchObject({ code: 'path-not-authorized' })
  })

  it('follows a symlinked root to the session’s real workspace', async () => {
    const realWorkspace = path.join(work, 'real-workspace')
    fs.mkdirSync(realWorkspace)
    const link = path.join(work, 'link-workspace')
    fs.symlinkSync(realWorkspace, link)
    const pkg = await writePackage(realWorkspace)

    const out = await validateMiniAppPackage(pkg, { sessionId: 'topic-1', roots: [{ uri: `file://${link}` }] })

    expect(out).toMatchObject({ appId: 'com.example.toolfixture' })
  })

  it('rejects a malformed package without issuing a token', async () => {
    const bad = path.join(workspace, 'bad.miniapp')
    fs.writeFileSync(bad, 'not a zip')

    const out = await validateMiniAppPackage(bad, ctxFor(workspace))

    expect(out).toMatchObject({ code: 'invalid-package' })
  })

  it('requires a session for every action', async () => {
    for (const input of [
      { action: 'validate', packagePath: '/x.miniapp' },
      { action: 'preview', artifactToken: 'art_x' },
      { action: 'status' },
      { action: 'close' }
    ] as const) {
      const out = await runMiniAppAuthoring(input, { roots: [] })
      expect(out).toMatchObject({ code: 'no-session' })
    }
  })

  it('passes preview to the service and maps its refusals', async () => {
    const summary = {
      previewId: 'p1',
      runtimeId: 'preview-p1',
      sessionId: 'topic-1',
      appId: 'com.example.toolfixture',
      version: '2.0.0',
      packageSha256: 'sha256:x',
      openedAt: 1
    }
    previewServiceStub.openPreview.mockResolvedValueOnce(summary)

    const ok = await previewValidatedMiniApp('art_good', ctxFor(workspace))
    expect(ok).toEqual(summary)
    expect(previewServiceStub.openPreview).toHaveBeenCalledWith({ sessionId: 'topic-1', artifactToken: 'art_good' })

    const { MiniAppPreviewError } = await import('@main/features/miniApp/preview/MiniAppPreviewService')
    previewServiceStub.openPreview.mockRejectedValueOnce(new MiniAppPreviewError('package-changed', 'changed'))
    const refused = await previewValidatedMiniApp('art_stale', ctxFor(workspace))
    expect(refused).toMatchObject({ code: 'package-changed' })
  })

  it('keeps another session’s previews out of status', async () => {
    previewServiceStub.getPreview.mockReturnValueOnce({
      previewId: 'p1',
      runtimeId: 'preview-p1',
      sessionId: 'topic-2',
      appId: 'x',
      version: '1',
      packageSha256: 'sha256:x',
      openedAt: 1
    })

    const out = await miniAppPreviewStatus('p1', ctxFor(workspace))
    expect(out).toMatchObject({ code: 'unknown-preview' })
  })

  it('close without an id tears the whole session down', async () => {
    previewServiceStub.closeSessionPreviews.mockResolvedValueOnce({ closed: 2, tokensRevoked: 3 })

    const out = await closeMiniAppPreviews(undefined, ctxFor(workspace))

    expect(out).toEqual({ closed: 2, tokensRevoked: 3 })
    expect(previewServiceStub.closeSessionPreviews).toHaveBeenCalledWith('topic-1')
  })

  it('tokens issued through validate are revocable through the token store', async () => {
    const pkg = await writePackage(workspace)
    const out = await validateMiniAppPackage(pkg, ctxFor(workspace, 'topic-revoke'))
    const token = (out as { artifactToken: string }).artifactToken

    expect(
      issueArtifactToken({ sessionId: 'topic-revoke', packagePath: pkg, sha256: 'sha256:y', size: 1 }).token
    ).not.toBe(token)
    expect(() => expectArtifactToken(token, 'topic-revoke')).not.toThrow()
  })
})
