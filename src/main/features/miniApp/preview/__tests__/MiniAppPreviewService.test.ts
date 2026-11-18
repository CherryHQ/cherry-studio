import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import JSZip from 'jszip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Hoisted: `BaseService` imports `electron`, so the mock factory runs during the static
// imports below — before any top-level `const` of this file would be initialised.
const { fromPartition, sessions } = vi.hoisted(() => {
  const sessions = new Map<
    string,
    {
      clearStorageData: ReturnType<typeof vi.fn>
      clearCache: ReturnType<typeof vi.fn>
      clearCodeCaches: ReturnType<typeof vi.fn>
    }
  >()
  const fromPartition = vi.fn((partition: string) => {
    const existing = sessions.get(partition)
    if (existing) return existing
    const fresh = {
      clearStorageData: vi.fn().mockResolvedValue(undefined),
      clearCache: vi.fn().mockResolvedValue(undefined),
      clearCodeCaches: vi.fn().mockResolvedValue(undefined)
    }
    sessions.set(partition, fresh)
    return fresh
  })
  return { fromPartition, sessions }
})
vi.mock('electron', () => ({ session: { fromPartition }, webContents: { fromId: () => undefined } }))

// The runtime is the one collaborator the preview service cannot do its job without:
// evicting guests and clearing the partition. Its own suites cover that machinery;
// here it only has to record what it was asked to do.
const { runtimeStub } = vi.hoisted(() => ({
  runtimeStub: {
    isPartitionReady: vi.fn(() => false),
    withAppQuiesced: vi.fn(async (_id: string, mutate: () => Promise<unknown>) => mutate())
  }
}))

import { mockMiniAppApplication } from '../../__tests__/applicationMock'

vi.mock('@application', () => mockMiniAppApplication({ MiniAppRuntimeService: runtimeStub }))

// `BaseService` throws on the second `new` of the same class, so without this reset the
// suite would get exactly one service across every test.
const { BaseService } = await import('@main/core/lifecycle')

const { application } = await import('@application')
const { sha256File } = await import('../../install/archive')
const { ArtifactTokenError, expectArtifactToken, issueArtifactToken } = await import('../artifactTokens')
const { MiniAppPreviewService, previewRuntimeId, sweepAbandonedPreviews } = await import('../MiniAppPreviewService')

const MANIFEST = {
  id: 'com.example.previewme',
  name: 'Preview Me',
  description: 'A preview fixture.',
  version: '1.0.0',
  entry: 'index.html'
}

let work: string
let previewsRoot: string

beforeEach(() => {
  BaseService.resetInstances()
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'miniapp-preview-'))
  previewsRoot = path.join(work, 'previews')
  fs.mkdirSync(previewsRoot, { recursive: true })
  vi.mocked(application.getPath).mockImplementation((key: string, filename?: string) =>
    key === 'feature.mini_app.previews' ? path.join(previewsRoot, filename ?? '') : path.join('/mock', key)
  )
  runtimeStub.isPartitionReady.mockClear().mockReturnValue(false)
  runtimeStub.withAppQuiesced.mockClear()
})

afterEach(() => fs.rmSync(work, { recursive: true, force: true }))

async function writePackage(build?: (zip: JSZip) => void): Promise<string> {
  const zip = new JSZip()
  zip.file('manifest.json', JSON.stringify(MANIFEST))
  zip.file('index.html', '<h1>preview</h1>')
  build?.(zip)
  const p = path.join(work, `pkg-${Math.random().toString(36).slice(2)}.miniapp`)
  fs.writeFileSync(p, await zip.generateAsync({ type: 'nodebuffer', platform: 'UNIX' }))
  return p
}

async function validatePackage(packagePath: string, sessionId: string) {
  const { size } = fs.statSync(packagePath)
  return issueArtifactToken({ sessionId, packagePath, sha256: await sha256File(packagePath), size })
}

describe('MiniAppPreviewService', () => {
  it('opens a validated package through a preview runtime identity', async () => {
    const svc = new MiniAppPreviewService()
    const pkg = await writePackage()
    const token = await validatePackage(pkg, 'session-a')

    const summary = await svc.openPreview({ sessionId: 'session-a', artifactToken: token.token })

    expect(summary.runtimeId).toBe(previewRuntimeId(summary.previewId))
    expect(summary.runtimeId).toMatch(/^preview-/)
    expect(summary.appId).toBe('com.example.previewme')
    expect(summary.packageSha256).toBe(token.sha256)
    // The tree is unpacked under the previews root, and the registry resolves it for
    // the protocol handler.
    expect(fs.existsSync(path.join(previewsRoot, summary.previewId, 'index.html'))).toBe(true)
    expect(svc.resolvePreviewPath(summary.runtimeId)).toBe(path.join(previewsRoot, summary.previewId))
    expect(svc.isPreviewActive(summary.previewId)).toBe(true)
  })

  it('rejects a token whose package bytes changed after validation', async () => {
    const svc = new MiniAppPreviewService()
    const pkg = await writePackage()
    const token = await validatePackage(pkg, 'session-a')
    // A swap after validate: same path, different bytes.
    fs.appendFileSync(pkg, 'tampered')

    await expect(svc.openPreview({ sessionId: 'session-a', artifactToken: token.token })).rejects.toThrowError(
      expect.objectContaining({ code: 'package-changed' })
    )
    expect(svc.listSessionPreviews('session-a')).toEqual([])
  })

  it('rejects a token owned by another session, and an unknown token', async () => {
    const svc = new MiniAppPreviewService()
    const pkg = await writePackage()
    const token = await validatePackage(pkg, 'session-a')

    await expect(svc.openPreview({ sessionId: 'session-b', artifactToken: token.token })).rejects.toThrowError(
      ArtifactTokenError
    )
    await expect(
      svc.openPreview({ sessionId: 'session-b', artifactToken: 'art_0'.padEnd(36, '0') })
    ).rejects.toThrowError(expect.objectContaining({ code: 'unknown-token' }))
  })

  it('closing stops the tree from resolving and clears the partition', async () => {
    runtimeStub.isPartitionReady.mockReturnValue(true)
    const svc = new MiniAppPreviewService()
    const pkg = await writePackage()
    const token = await validatePackage(pkg, 'session-a')
    const summary = await svc.openPreview({ sessionId: 'session-a', artifactToken: token.token })

    await svc.closePreview(summary.previewId)

    expect(svc.isPreviewActive(summary.previewId)).toBe(false)
    expect(svc.resolvePreviewPath(summary.runtimeId)).toBeUndefined()
    expect(fs.existsSync(path.join(previewsRoot, summary.previewId))).toBe(false)
    // Guests evicted first, storage cleared inside the quiesce, tree removed last.
    expect(runtimeStub.withAppQuiesced).toHaveBeenCalledWith(summary.runtimeId, expect.any(Function))
    const partitionSession = sessions.get(`persist:miniapp:${summary.runtimeId}`)
    expect(partitionSession?.clearStorageData).toHaveBeenCalled()
    expect(partitionSession?.clearCache).toHaveBeenCalled()
  })

  it('opening a second preview replaces the session\u2019s first, invalidating its targets', async () => {
    const svc = new MiniAppPreviewService()
    const first = await svc.openPreview({
      sessionId: 'session-a',
      artifactToken: (await validatePackage(await writePackage(), 'session-a')).token
    })
    const second = await svc.openPreview({
      sessionId: 'session-a',
      artifactToken: (await validatePackage(await writePackage(), 'session-a')).token
    })

    expect(second.previewId).not.toBe(first.previewId)
    // The replaced run is gone: no registry entry, no resolving tree, no directory.
    expect(svc.isPreviewActive(first.previewId)).toBe(false)
    expect(svc.resolvePreviewPath(first.runtimeId)).toBeUndefined()
    expect(fs.existsSync(path.join(previewsRoot, first.previewId))).toBe(false)
    expect(svc.listSessionPreviews('session-a').map((p) => p.previewId)).toEqual([second.previewId])
  })

  it('lets a session close its own preview but not another session\u2019s', async () => {
    const svc = new MiniAppPreviewService()
    const pkg = await writePackage()
    const token = await validatePackage(pkg, 'session-a')
    const summary = await svc.openPreview({ sessionId: 'session-a', artifactToken: token.token })

    await expect(svc.closePreview(summary.previewId, 'session-b')).rejects.toThrowError(
      expect.objectContaining({ code: 'session-mismatch' })
    )
    expect(svc.isPreviewActive(summary.previewId)).toBe(true)

    await svc.closePreview(summary.previewId, 'session-a')
    expect(svc.isPreviewActive(summary.previewId)).toBe(false)
    // Idempotent: teardown and the renderer's unmount can race legitimately.
    await svc.closePreview(summary.previewId, 'session-a')
  })

  it('session teardown closes its previews and revokes its artifact tokens', async () => {
    // Unique session id: the token store is module scope, so tokens from earlier
    // tests in this file still live there under `session-a`.
    const svc = new MiniAppPreviewService()
    const pkg = await writePackage()
    const token = await validatePackage(pkg, 'session-teardown')
    const summary = await svc.openPreview({ sessionId: 'session-teardown', artifactToken: token.token })
    const unused = await validatePackage(await writePackage(), 'session-teardown')
    const neighbor = await validatePackage(await writePackage(), 'session-b')

    const result = await svc.closeSessionPreviews('session-teardown')

    expect(result).toEqual({ closed: 1, tokensRevoked: 2 })
    expect(svc.isPreviewActive(summary.previewId)).toBe(false)
    expect(() => expectArtifactToken(token.token, 'session-teardown')).toThrowError(ArtifactTokenError)
    expect(() => expectArtifactToken(unused.token, 'session-teardown')).toThrowError(ArtifactTokenError)
    expect(() => expectArtifactToken(neighbor.token, 'session-b')).not.toThrow()
  })

  it('sweeps abandoned preview trees at startup', async () => {
    // A crash left two trees behind; one has the shape of a live preview id.
    fs.mkdirSync(path.join(previewsRoot, 'dead-preview-1'))
    fs.mkdirSync(path.join(previewsRoot, 'dead-preview-2'))

    const removed = await sweepAbandonedPreviews()

    expect(removed).toBe(2)
    expect(fs.readdirSync(previewsRoot)).toEqual([])
  })

  it('removes the tree when extraction fails', async () => {
    const svc = new MiniAppPreviewService()
    // A package whose entry point is missing fails the post-extraction tree check.
    const bad = await writePackage((zip) => {
      zip.remove('index.html')
    })
    const token = await validatePackage(bad, 'session-a')

    await expect(svc.openPreview({ sessionId: 'session-a', artifactToken: token.token })).rejects.toThrow()
    expect(fs.readdirSync(previewsRoot)).toEqual([])
    expect(svc.listSessionPreviews('session-a')).toEqual([])
  })

  it('sweeps on ready before any preview can open', async () => {
    fs.mkdirSync(path.join(previewsRoot, 'leftover'))
    const svc = new MiniAppPreviewService()

    await (svc as unknown as { onReady(): Promise<void> }).onReady()

    expect(fs.readdirSync(previewsRoot)).toEqual([])
  })
})
