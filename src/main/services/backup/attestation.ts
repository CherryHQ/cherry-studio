import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

import { application } from '@application'
import { loggerService } from '@logger'
import * as z from 'zod'

import { ATTESTATION_ENTRY } from './archiveLayout'

/**
 * Same-install attestation for a `.cherrybackup`
 * (docs/references/backup/README.md §3.1).
 *
 * The problem it solves: a restore cannot tell "the user's own backup, coming
 * home to the machine that wrote it" from "an archive someone handed them" by
 * looking at the archive alone, and the difference decides whether an absolute
 * path inside it may be honoured at all. A per-install secret makes the
 * difference provable: only this install can produce a MAC that verifies here,
 * so a verifying MAC means every absolute path in that archive was written by
 * this very install about its own filesystem.
 *
 * SCOPE. This proves ORIGIN, not integrity of anything the format already
 * proves: admission independently verifies the database and every payload
 * against the manifest's hashes, and the MAC covers the exact manifest bytes,
 * so it transitively covers `db.hash` and every payload hash. It is NOT a
 * signature — the secret is symmetric and local, and it is never exported.
 *
 * FAIL-SOFT BY CONSTRUCTION. Every failure — no secret yet, an unreadable
 * secret, a missing or malformed entry, a MAC that does not verify — means
 * "not attested", never an error. Export still produces a valid archive without
 * the entry, and restore still runs under the unattested path-safety policy
 * (§3.1 Layer 2/3). That is what keeps the archive from learning anything about
 * the secret: it cannot provoke a distinguishable outcome beyond the one bit it
 * is entitled to.
 */

const logger = loggerService.withContext('backupAttestation')

/** HMAC-SHA256 with a 32-byte key: the one algorithm this format admits. */
const ATTESTATION_ALGORITHM = 'hmac-sha256'
const SECRET_BYTES = 32

/**
 * Domain separator prefixed to the MAC input. The secret has exactly one
 * purpose today; the prefix keeps it that way if a second one is ever added, so
 * a MAC minted for another message can never be replayed as a manifest MAC.
 */
const MAC_DOMAIN = Buffer.from('cherry-backup-v2/manifest\0', 'utf8')

const AttestationSchema = z.strictObject({
  algorithm: z.literal(ATTESTATION_ALGORITHM),
  mac: z.string().regex(/^[0-9a-f]{64}$/)
})

function keyPath(): string {
  return application.getPath('feature.backup.attestation.key_file')
}

function macOf(secret: Buffer, manifestBytes: Buffer): Buffer {
  return createHmac('sha256', secret).update(MAC_DOMAIN).update(manifestBytes).digest()
}

/**
 * Read the install secret. Returns `undefined` when it does not exist yet or is
 * not exactly {@link SECRET_BYTES} long — and NEVER creates it: verification
 * must not have side effects, and an install that has never exported has
 * nothing to attest against.
 */
function readSecret(): Buffer | undefined {
  let bytes: Buffer
  try {
    bytes = readFileSync(keyPath())
  } catch {
    return undefined
  }
  return bytes.byteLength === SECRET_BYTES ? bytes : undefined
}

/**
 * Read the install secret, generating it on first use.
 *
 * `wx` makes creation atomic, so two concurrent exports cannot interleave a
 * half-written key: the loser reads the winner's bytes back instead of
 * overwriting them. Mode `0600` because the secret is what distinguishes this
 * install's archives from anyone else's.
 */
function readOrCreateSecret(): Buffer | undefined {
  const existing = readSecret()
  if (existing) return existing
  try {
    writeFileSync(keyPath(), randomBytes(SECRET_BYTES), { mode: 0o600, flag: 'wx' })
  } catch (error) {
    // EEXIST is the concurrent-export race (or a malformed file); anything else
    // is a real I/O problem. Either way the re-read below decides.
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      logger.warn('Could not create the backup attestation secret; this archive will not be self-attested', {
        code: (error as NodeJS.ErrnoException).code
      })
      return undefined
    }
  }
  return readSecret()
}

/** The archive entry that carries the MAC, serialized. */
export interface AttestationEntry {
  readonly name: string
  readonly bytes: Buffer
}

/**
 * Build the attestation entry for already-final manifest bytes, or `undefined`
 * when this install cannot attest. Called by the publisher, which is the only
 * place that knows the exact bytes the archive will carry.
 */
export function buildManifestAttestation(manifestBytes: Buffer): AttestationEntry | undefined {
  const secret = readOrCreateSecret()
  if (!secret) return undefined
  const payload = { algorithm: ATTESTATION_ALGORITHM, mac: macOf(secret, manifestBytes).toString('hex') }
  return { name: ATTESTATION_ENTRY, bytes: Buffer.from(JSON.stringify(payload), 'utf8') }
}

/**
 * Whether `entryBytes` is a valid attestation of `manifestBytes` by THIS
 * install. Constant-time comparison, and no throw on any input: a hostile entry
 * is just "not attested".
 */
export function verifyManifestAttestation(manifestBytes: Buffer, entryBytes: Buffer): boolean {
  const secret = readSecret()
  if (!secret) return false

  let parsed: z.infer<typeof AttestationSchema>
  try {
    const result = AttestationSchema.safeParse(JSON.parse(entryBytes.toString('utf8')))
    if (!result.success) return false
    parsed = result.data
  } catch {
    return false
  }

  const claimed = Buffer.from(parsed.mac, 'hex')
  const expected = macOf(secret, manifestBytes)
  return claimed.byteLength === expected.byteLength && timingSafeEqual(claimed, expected)
}
