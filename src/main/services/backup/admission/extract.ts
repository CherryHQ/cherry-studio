import { createWriteStream } from 'node:fs'
import { chmod, mkdir, mkdtemp } from 'node:fs/promises'
import path from 'node:path'
import type { Readable } from 'node:stream'

import type StreamZip from 'node-stream-zip'

import { ATTESTATION_ENTRY, DB_ENTRY, MANIFEST_ENTRY } from '../archiveLayout'
import { MAX_ATTESTATION_ENTRY_BYTES } from '../ceilings'
import { ArchiveAdmissionError, BackupCancelledError, DiskFullError, renderUntrustedName } from '../errors'
import type { ArchiveShape, NormalizedEntry } from './catalog'

/**
 * Bounded, owner-only extraction for archive admission (Phase 1b-ii,
 * docs/references/backup/README.md §5.2). Every byte lands ONLY inside a freshly
 * `mkdtemp`'d, operation-owned staging directory under a caller-provided existing
 * parent — there is deliberately no broad `zip.extract()` (which would trust the
 * archive's own paths). Each file is created EXCLUSIVELY (`wx`) at a pre-validated
 * destination and streamed through THREE simultaneous byte bounds:
 *
 * - actual bytes ≤ the entry's DECLARED central size (a forged small/large size
 *   is caught mid-stream, not trusted);
 * - actual bytes ≤ the absolute per-entry ceiling;
 * - cumulative actual bytes across manifest + DB + every resource ≤ the total
 *   ceiling, via one shared {@link ExtractionBudget}.
 *
 * At end-of-stream the actual byte count must EQUAL the declared size, so a
 * truncated (forged-small) entry is rejected too. The catalog's advisory
 * central-directory checks bound nothing on their own; this is where the real
 * write budget is proven.
 *
 * Extraction NEVER creates a symlink or special file: only `mkdir` (directories)
 * and `createWriteStream` (regular files) are used.
 */

const STAGING_PREFIX = 'cs-admit-'

/** Create the exclusively-owned staging directory under an already-resolved existing parent. */
export async function createStagingDir(stagingParent: string): Promise<string> {
  const stagingDir = await mkdtemp(path.join(stagingParent, STAGING_PREFIX))
  await chmod(stagingDir, 0o700)
  return stagingDir
}

/** Absolute on-disk destination of a validated POSIX relative archive path, under the staging root. */
export function stagedPathOf(stagingDir: string, relPath: string): string {
  return path.join(stagingDir, ...relPath.split('/'))
}

/** One cumulative actual-byte budget shared by every extracted entry in an operation. */
export class ExtractionBudget {
  private remaining: number
  constructor(maxTotalBytes: number) {
    this.remaining = maxTotalBytes
  }
  /** Consume actual streamed bytes; returns the rejection when the total ceiling is breached. */
  consume(chunkLen: number): ArchiveAdmissionError | null {
    this.remaining -= chunkLen
    return this.remaining < 0
      ? new ArchiveAdmissionError('ceiling-total-bytes', 'cumulative extracted bytes exceeded the total ceiling')
      : null
  }
}

/**
 * Test seam invoked per streamed extraction chunk with the running byte count and
 * the entry label (no-op in production) — lets a test deterministically cancel
 * mid-extraction of a specific entry to exercise the abort-listener/chunk path.
 */
export const extractStreamHooks = {
  onChunk(_bytesSoFar: number, _entryLabel: string): void {
    void _bytesSoFar
    void _entryLabel
  }
}

/** Map a raw extraction error into the safe taxonomy without leaking content. */
function mapExtractionError(err: unknown): Error {
  if (err instanceof BackupCancelledError || err instanceof ArchiveAdmissionError || err instanceof DiskFullError) {
    return err
  }
  if ((err as NodeJS.ErrnoException)?.code === 'ENOSPC') return new DiskFullError()
  return new ArchiveAdmissionError('extraction-io', 'failed to write extracted entry')
}

interface PumpOptions {
  readonly declaredBytes: number
  readonly executable: boolean
  readonly absoluteCap: number
  readonly budget: ExtractionBudget
  /** Reason used when the ABSOLUTE cap (not the declared size) is the binding breach. */
  readonly overflowReason: 'ceiling-entry-bytes' | 'ceiling-manifest-bytes'
  readonly entryLabel: string
  readonly signal: AbortSignal | undefined
}

async function pumpBounded(stream: Readable, destPath: string, opts: PumpOptions): Promise<number> {
  const { declaredBytes, absoluteCap, budget, overflowReason, entryLabel, signal } = opts
  const perEntryCap = Math.min(declaredBytes, absoluteCap)
  await mkdir(path.dirname(destPath), { recursive: true, mode: 0o700 })
  const out = createWriteStream(destPath, { flags: 'wx', mode: opts.executable ? 0o700 : 0o600 })
  let bytes = 0
  let settled = false

  await new Promise<void>((resolve, reject) => {
    const detach = (): void => signal?.removeEventListener('abort', onAbort)
    const fail = (err: unknown): void => {
      if (settled) return
      settled = true
      detach()
      stream.destroy()
      out.destroy()
      reject(mapExtractionError(err))
    }
    const finish = (): void => {
      if (settled) return
      settled = true
      detach()
      resolve()
    }
    // An abort listener fires even while paused/waiting for drain — data-event
    // polling alone would miss a cancellation that arrives between chunks.
    function onAbort(): void {
      fail(new BackupCancelledError())
    }
    if (signal?.aborted) {
      fail(new BackupCancelledError())
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    stream.on('data', (chunk: Buffer) => {
      if (settled) return
      bytes += chunk.length
      extractStreamHooks.onChunk(bytes, entryLabel)
      if (settled) return // a hook may have aborted synchronously via the signal
      if (bytes > perEntryCap) {
        fail(
          perEntryCap === absoluteCap && absoluteCap < declaredBytes
            ? new ArchiveAdmissionError(overflowReason, `${entryLabel}: streamed > ${absoluteCap}`)
            : new ArchiveAdmissionError(
                'entry-size-mismatch',
                `${entryLabel}: actual bytes exceed declared ${declaredBytes}`
              )
        )
        return
      }
      const budgetErr = budget.consume(chunk.length)
      if (budgetErr) {
        fail(budgetErr)
        return
      }
      if (!out.write(chunk)) {
        stream.pause()
        out.once('drain', () => {
          if (!settled) stream.resume()
        })
      }
    })
    stream.on('error', fail)
    out.on('error', fail)
    stream.on('end', () => out.end(finish))
  })

  // Forged-small: fewer actual bytes than the central directory declared.
  if (bytes !== declaredBytes) {
    throw new ArchiveAdmissionError(
      'entry-size-mismatch',
      `${entryLabel}: streamed ${bytes} != declared ${declaredBytes}`
    )
  }
  return bytes
}

function streamEntry(zip: InstanceType<typeof StreamZip>, entry: NormalizedEntry): Promise<Readable> {
  return new Promise((resolve, reject) => {
    zip.stream(entry.zipEntry, (err, stream) => {
      if (err || !stream) {
        reject(new ArchiveAdmissionError('extraction-io', `cannot open entry ${renderUntrustedName(entry.path)}`))
        return
      }
      resolve(stream as Readable)
    })
  })
}

interface ExtractOptions {
  readonly absoluteCap: number
  readonly budget: ExtractionBudget
  readonly overflowReason: 'ceiling-entry-bytes' | 'ceiling-manifest-bytes'
  readonly signal: AbortSignal | undefined
}

/**
 * Stream one entry to a file under the staging root within its declared size, the
 * absolute cap, and the shared cumulative budget; cancellable per chunk and while
 * paused. Returns the streamed byte count.
 */
export async function extractEntryToFile(
  zip: InstanceType<typeof StreamZip>,
  entry: NormalizedEntry,
  stagingDir: string,
  opts: ExtractOptions
): Promise<number> {
  if (opts.signal?.aborted) throw new BackupCancelledError()
  const stream = await streamEntry(zip, entry)
  return pumpBounded(stream, stagedPathOf(stagingDir, entry.path), {
    declaredBytes: entry.uncompressedSize,
    executable: entry.executable,
    absoluteCap: opts.absoluteCap,
    budget: opts.budget,
    overflowReason: opts.overflowReason,
    entryLabel: renderUntrustedName(entry.path),
    signal: opts.signal
  })
}

/**
 * Extract the DB payload plus every resource file, and materialize every
 * (structural) resource directory — including empty declared directory units.
 * The manifest is extracted separately by the orchestrator (it is read before
 * this stage to classify the layout) and shares the SAME budget.
 */
export async function extractPayload(
  zip: InstanceType<typeof StreamZip>,
  shape: ArchiveShape,
  stagingDir: string,
  maxEntryBytes: number,
  budget: ExtractionBudget,
  signal: AbortSignal | undefined
): Promise<void> {
  const opts: ExtractOptions = { absoluteCap: maxEntryBytes, budget, overflowReason: 'ceiling-entry-bytes', signal }
  await extractEntryToFile(zip, shape.db, stagingDir, opts)

  // Materialize directory entries first so an empty directory unit exists even
  // when it carries no files.
  for (const dir of shape.resourceDirs) {
    if (signal?.aborted) throw new BackupCancelledError()
    await mkdir(stagedPathOf(stagingDir, dir.path), { recursive: true, mode: 0o700 })
  }

  for (const file of shape.resourceFiles) {
    if (signal?.aborted) throw new BackupCancelledError()
    await extractEntryToFile(zip, file, stagingDir, opts)
  }
}

/** Extract `manifest.json` under the manifest cap, sharing the operation budget. */
export function extractManifest(
  zip: InstanceType<typeof StreamZip>,
  shape: ArchiveShape,
  stagingDir: string,
  maxManifestBytes: number,
  budget: ExtractionBudget,
  signal: AbortSignal | undefined
): Promise<number> {
  return extractEntryToFile(zip, shape.manifest, stagingDir, {
    absoluteCap: maxManifestBytes,
    budget,
    overflowReason: 'ceiling-manifest-bytes',
    signal
  })
}

/**
 * Extract the optional `attestation.json` under its own small cap, sharing the
 * operation budget. Returns `false` when the archive carries none — the common
 * case for a foreign archive, and never an error.
 */
export async function extractAttestation(
  zip: InstanceType<typeof StreamZip>,
  shape: ArchiveShape,
  stagingDir: string,
  budget: ExtractionBudget,
  signal: AbortSignal | undefined
): Promise<boolean> {
  if (!shape.attestation) return false
  await extractEntryToFile(zip, shape.attestation, stagingDir, {
    absoluteCap: MAX_ATTESTATION_ENTRY_BYTES,
    budget,
    overflowReason: 'ceiling-entry-bytes',
    signal
  })
  return true
}

/** Fixed staged paths, for the orchestrator and post-extraction verification. */
export const stagedManifestName = MANIFEST_ENTRY
export const stagedDbName = DB_ENTRY
export const stagedAttestationName = ATTESTATION_ENTRY
