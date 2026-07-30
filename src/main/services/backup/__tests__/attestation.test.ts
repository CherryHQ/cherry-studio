import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { application } from '@application'
import { buildPathRegistry, type PathKey } from '@main/core/paths/pathRegistry'
import { app } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildManifestAttestation, verifyManifestAttestation } from '../attestation'
import { isPathContainedIn } from '../portability/managedPathRebase'
import { resolveResourceRoots } from '../resources/collectRequirements'

/**
 * Same-install attestation (docs/references/backup/README.md §3.1 Layer 1).
 *
 * Two things are proved here: the MAC is a real origin proof (it verifies for the
 * exact bytes, and for nothing else), and the secret behind it lives somewhere no
 * export can reach. The second one is the load-bearing security property — a
 * secret swept into an archive would let anyone forge attestation for anyone.
 */

const MANIFEST = Buffer.from('{"backupFormatVersion":2,"db":{"hash":"a"}}', 'utf8')

describe('backup attestation', () => {
  let userData = ''

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'cs-attest-'))
    vi.spyOn(application, 'getPath').mockImplementation((key: string, filename?: string) => {
      if (key !== 'feature.backup.attestation.key_file') throw new Error(`unexpected path key: ${key}`)
      const base = join(userData, 'backup-attestation.key')
      return filename ? join(base, filename) : base
    })
  })

  afterEach(() => {
    rmSync(userData, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  function keyPath(): string {
    return join(userData, 'backup-attestation.key')
  }

  it('verifies an archive this install produced', () => {
    const entry = buildManifestAttestation(MANIFEST)
    if (!entry) throw new Error('expected an attestation')

    expect(entry.name).toBe('attestation.json')
    expect(JSON.parse(entry.bytes.toString('utf8'))).toEqual({
      algorithm: 'hmac-sha256',
      mac: expect.stringMatching(/^[0-9a-f]{64}$/)
    })
    expect(verifyManifestAttestation(MANIFEST, entry.bytes)).toBe(true)
  })

  it('creates the secret once, owner-only, and reuses it across exports', () => {
    const first = buildManifestAttestation(MANIFEST)
    const secret = readFileSync(keyPath())
    const second = buildManifestAttestation(Buffer.from('other bytes'))

    expect(secret.byteLength).toBe(32)
    // 0600: the secret is what distinguishes this install's archives from anyone else's.
    expect(statSync(keyPath()).mode & 0o777).toBe(0o600)
    expect(readFileSync(keyPath()).equals(secret)).toBe(true)
    // Both archives are attested by the same install, so both verify here.
    expect(verifyManifestAttestation(MANIFEST, first!.bytes)).toBe(true)
    expect(verifyManifestAttestation(Buffer.from('other bytes'), second!.bytes)).toBe(true)
  })

  it('rejects a manifest changed by a single byte', () => {
    const entry = buildManifestAttestation(MANIFEST)!
    const tampered = Buffer.from(MANIFEST)
    tampered[tampered.length - 1] = tampered[tampered.length - 1] ^ 0x01

    expect(verifyManifestAttestation(tampered, entry.bytes)).toBe(false)
  })

  it('covers the database and every payload transitively', () => {
    // The manifest carries `db.hash` and each payload's hash, so a MAC over the
    // manifest bytes is a MAC over everything admission verifies against them.
    // Changing the declared db hash must invalidate the attestation.
    const manifest = Buffer.from(JSON.stringify({ db: { hash: 'a'.repeat(64) } }), 'utf8')
    const entry = buildManifestAttestation(manifest)!
    const swapped = Buffer.from(JSON.stringify({ db: { hash: 'b'.repeat(64) } }), 'utf8')

    expect(verifyManifestAttestation(manifest, entry.bytes)).toBe(true)
    expect(verifyManifestAttestation(swapped, entry.bytes)).toBe(false)
  })

  it('is not attested when this install has no secret yet — and does not create one', () => {
    const entry = { bytes: Buffer.from(JSON.stringify({ algorithm: 'hmac-sha256', mac: '0'.repeat(64) }), 'utf8') }

    expect(verifyManifestAttestation(MANIFEST, entry.bytes)).toBe(false)
    // Verification must have no side effects: a restore may not mint the very
    // secret it is checking against.
    expect(existsSync(keyPath())).toBe(false)
  })

  it('is not attested when a foreign install signed it', () => {
    const foreign = buildManifestAttestation(MANIFEST)!
    // Another install: same code, different secret.
    rmSync(keyPath())
    buildManifestAttestation(MANIFEST)

    expect(verifyManifestAttestation(MANIFEST, foreign.bytes)).toBe(false)
  })

  it('never throws on a hostile entry, whatever it contains', () => {
    buildManifestAttestation(MANIFEST)
    const hostile = [
      Buffer.alloc(0),
      Buffer.from('not json'),
      Buffer.from('{}'),
      Buffer.from(JSON.stringify({ algorithm: 'none', mac: '0'.repeat(64) })),
      Buffer.from(JSON.stringify({ algorithm: 'hmac-sha256', mac: 'zz' })),
      Buffer.from(JSON.stringify({ algorithm: 'hmac-sha256', mac: '0'.repeat(64), extra: 1 })),
      Buffer.from(JSON.stringify({ algorithm: 'hmac-sha256' }))
    ]

    for (const bytes of hostile) {
      expect(verifyManifestAttestation(MANIFEST, bytes)).toBe(false)
    }
  })

  it('is not attested when the key file is the wrong size', () => {
    writeFileSync(keyPath(), Buffer.alloc(16))

    expect(verifyManifestAttestation(MANIFEST, Buffer.from('{}'))).toBe(false)
  })

  it('degrades to unattested instead of failing an export when the secret cannot be written', () => {
    // A read-only userData: export must still publish, just without the entry.
    rmSync(userData, { recursive: true, force: true })

    expect(buildManifestAttestation(MANIFEST)).toBeUndefined()
  })
})

describe('the attestation secret’s location', () => {
  beforeEach(() => {
    // The shared electron mock does not model `getAppPath`, which the registry
    // needs for its read-only bundled-resource keys.
    Object.assign(app, { getAppPath: () => join(tmpdir(), 'cs-app') })
  })

  it('is outside every managed root an export sweeps', () => {
    // Against the PRODUCTION registry, not a fixture: this is the invariant that
    // keeps the secret out of archives, so it has to hold for the real key values.
    const registry = buildPathRegistry() as Readonly<Record<PathKey, string>>
    vi.spyOn(application, 'getPath').mockImplementation((key: string) => registry[key as PathKey])
    const keyFile = registry['feature.backup.attestation.key_file']

    // `resolveResourceRoots()` IS the closed set of roots the resource adapters
    // (and therefore staging) can ever walk, so iterating it cannot go stale.
    const roots = Object.values(resolveResourceRoots())
    expect(roots.length).toBeGreaterThan(0)
    for (const root of roots) {
      expect(root).not.toBe(keyFile)
      expect(isPathContainedIn(root, keyFile, process.platform === 'win32' ? 'win32' : 'linux')).toBe(false)
    }
    vi.restoreAllMocks()
  })

  it('is registered under a file key, so auto-ensure creates its parent and not itself', () => {
    // A directory key would have the registry `mkdir` the secret's own path, and
    // every read of it would then fail with EISDIR.
    const key = 'feature.backup.attestation.key_file'
    expect(Object.keys(buildPathRegistry())).toContain(key)
    expect(key.endsWith('file')).toBe(true)
  })
})
