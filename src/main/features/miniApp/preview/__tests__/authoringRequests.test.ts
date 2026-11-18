import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import JSZip from 'jszip'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const {
  AuthoringRequestError,
  expectSessionArtifact,
  isLaunchpadAnswered,
  isMiniAppPackageName,
  resolveArtifactHandle,
  withLaunchpadDismissal
} = await import('../authoringRequests')
const { issueArtifactToken } = await import('../artifactTokens')
const { noteValidationFailure, resetAllRepairRounds } = await import('../repairRounds')

const MANIFEST = {
  id: 'com.example.cardfixture',
  name: 'Card Fixture',
  description: 'Fixture for the authoring request core.',
  version: '1.0.0',
  entry: 'index.html'
}

let work: string

beforeEach(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'miniapp-authoring-req-'))
  resetAllRepairRounds()
})

afterEach(() => fs.rmSync(work, { recursive: true, force: true }))

async function writePackage(name: string): Promise<string> {
  const zip = new JSZip()
  zip.file('manifest.json', JSON.stringify(MANIFEST))
  zip.file('index.html', '<h1>card</h1>')
  const p = path.join(work, name)
  fs.writeFileSync(p, await zip.generateAsync({ type: 'nodebuffer', platform: 'UNIX' }))
  return p
}

describe('resolveArtifactHandle', () => {
  it('resolves a path handle to the real package path', async () => {
    const pkg = await writePackage('real.miniapp')
    const resolved = await resolveArtifactHandle({ kind: 'path', path: pkg })
    expect(resolved).toBe(fs.realpathSync(pkg))
  })

  it('refuses a non-package file', async () => {
    const txt = path.join(work, 'notes.txt')
    fs.writeFileSync(txt, 'hello')
    await expect(resolveArtifactHandle({ kind: 'path', path: txt })).rejects.toMatchObject({
      code: 'not-a-package'
    })
  })
})

describe('expectSessionArtifact', () => {
  it('returns the session token for a validated, unchanged package', async () => {
    const pkg = await writePackage('ok.miniapp')
    const real = fs.realpathSync(pkg)
    const issued = issueArtifactToken({ sessionId: 's1', packagePath: real, sha256: 'sha256:will-not-match', size: 1 })
    // Re-issue with the TRUE digest so the re-hash check passes.
    const { sha256File } = await import('../../install/archive')
    const sha256 = await sha256File(real)
    issueArtifactToken({ sessionId: 's1', packagePath: real, sha256, size: 1 })

    const record = await expectSessionArtifact('s1', real)
    expect(record.token).not.toBe(issued.token)
    expect(record.sha256).toBe(sha256)
  })

  it('refuses a package the session never validated', async () => {
    const pkg = await writePackage('stranger.miniapp')
    await expect(expectSessionArtifact('s1', fs.realpathSync(pkg))).rejects.toMatchObject({ code: 'no-artifact' })
  })

  it('refuses a package whose bytes changed since validation (AC5)', async () => {
    const pkg = await writePackage('swapped.miniapp')
    const real = fs.realpathSync(pkg)
    const { sha256File } = await import('../../install/archive')
    const sha256 = await sha256File(real)
    issueArtifactToken({ sessionId: 's1', packagePath: real, sha256, size: 1 })

    fs.writeFileSync(pkg, 'replaced bytes')
    await expect(expectSessionArtifact('s1', real)).rejects.toMatchObject({ code: 'package-changed' })
  })

  it('refuses a repair-capped package before any digest work (AC9)', async () => {
    const pkg = await writePackage('capped.miniapp')
    const real = fs.realpathSync(pkg)
    for (let i = 0; i < 3; i++) noteValidationFailure('s1', real, `round ${i + 1}`)

    await expect(expectSessionArtifact('s1', real)).rejects.toMatchObject({ code: 'repair-blocked' })
  })
})

describe('launchpad answers (AC8)', () => {
  it('dismissal persists once and dedupes', () => {
    const once = withLaunchpadDismissal([], 'app.a')
    expect(once).toEqual(['app.a'])
    expect(withLaunchpadDismissal(once, 'app.a')).toEqual(['app.a'])
    expect(withLaunchpadDismissal(once, 'app.b')).toEqual(['app.a', 'app.b'])
  })

  it('reads back: pinned or dismissed both count as answered', () => {
    expect(isLaunchpadAnswered('pinned', [], 'app.a')).toBe(true)
    expect(isLaunchpadAnswered('enabled', ['app.a'], 'app.a')).toBe(true)
    expect(isLaunchpadAnswered('enabled', [], 'app.a')).toBe(false)
    expect(isLaunchpadAnswered('disabled', ['app.b'], 'app.a')).toBe(false)
  })

  it('recognizes package names case-insensitively', () => {
    expect(isMiniAppPackageName('My App.MINIAPP')).toBe(true)
    expect(isMiniAppPackageName('archive.zip')).toBe(false)
    expect(isMiniAppPackageName('no-extension')).toBe(false)
  })
})
