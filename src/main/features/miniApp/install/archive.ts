/**
 * `.miniapp` archive scanning and extraction.
 *
 * Every check runs against the entry table BEFORE anything touches `destDir`,
 * so a rejected package never leaves a partial tree behind — and one more runs
 * AFTER, over what actually landed (`assertTreeContained`).
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { loggerService } from '@logger'
import { transcodeToEntityWebp } from '@main/utils/image'
import {
  MINI_APP_MAX_EXTRACTED_BYTES,
  MINI_APP_MAX_ICON_BYTES,
  MINI_APP_MAX_MANIFEST_BYTES,
  MINI_APP_MAX_PACKAGE_BYTES,
  MINI_APP_RESERVED_DIR,
  type MiniAppManifest,
  MiniAppManifestSchema
} from '@shared/types/miniAppManifest'
import StreamZip from 'node-stream-zip'

import { bestEffortCleanup } from './cleanup'
import { assertSupportedIconBytes } from './icon'

const logger = loggerService.withContext('miniAppArchive')

const MAX_ENTRIES = 2000
const MANIFEST_NAME = 'manifest.json'
const S_IFMT = 0xf000
const S_IFLNK = 0xa000
const S_IFREG = 0x8000
const S_IFDIR = 0x4000

/**
 * Tolerate the common "zipped the folder" mistake: exactly one top-level
 * directory and no root manifest means descend once. More than one candidate is
 * an error — guessing would install a different app than the one shown.
 */
function resolvePrefix(names: string[]): string {
  if (names.includes(MANIFEST_NAME)) return ''
  const tops = new Set(names.map((n) => n.split('/')[0]).filter(Boolean))
  if (tops.size === 1) {
    const [only] = [...tops]
    if (names.includes(`${only}/${MANIFEST_NAME}`)) return `${only}/`
  }
  throw new Error(`Package is missing ${MANIFEST_NAME} at its root`)
}

/**
 * Every path under `root` must still resolve inside `root` once symlinks are
 * followed. `path.relative(...).startsWith('..')` is the check Electron's own
 * protocol example uses and it does NOT catch this: a symlink's textual path is
 * perfectly well-behaved (measured, design §13.1 — `naiveSafe: true`,
 * `realSafe: false`).
 */
async function assertTreeContained(root: string): Promise<void> {
  const realRoot = await fs.promises.realpath(root)
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await fs.promises.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isSymbolicLink()) {
        throw new Error(`Package contains a symbolic link: ${path.relative(realRoot, full)}`)
      }
      const real = await fs.promises.realpath(full)
      if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
        throw new Error(`Package entry resolves outside the package root: ${entry.name}`)
      }
      if (entry.isDirectory()) await walk(full)
    }
  }
  await walk(realRoot)
}

/**
 * The post-extraction half of validation, shared by EVERY source of an unpacked tree.
 * The archive path additionally pre-checks the zip's entry table (what the package
 * CLAIMS, before unpacking); this checks the tree that actually landed — the one the
 * protocol handler will serve, and the only gate `copyTreeToStaging` (builtin install
 * and builtin update) ever passes through, since it never sees a zip.
 */
export async function assertExtractedTree(root: string, manifest: MiniAppManifest): Promise<void> {
  await assertTreeContained(root)
  if (fs.existsSync(path.join(root, MINI_APP_RESERVED_DIR))) {
    throw new Error(`Package must not contain the reserved '${MINI_APP_RESERVED_DIR}' directory`)
  }
  // `isFile`, not existence: a DIRECTORY named `index.html` satisfies `existsSync`,
  // installs cleanly, and 404s at first open. Symlinks were rejected above, so `stat`.
  const isFile = (rel: string) => fs.statSync(path.join(root, rel), { throwIfNoEntry: false })?.isFile() ?? false
  if (!isFile(manifest.entry)) {
    throw new Error(`Manifest entry file is missing or not a regular file: ${manifest.entry}`)
  }
  if (manifest.icon && !isFile(manifest.icon.path)) {
    throw new Error(`Manifest icon file is missing or not a regular file: ${manifest.icon.path}`)
  }
}

/**
 * `zip.entryData` with a real ceiling.
 *
 * The entry table's `size` is what the archive CLAIMS, and node-stream-zip reconciles it
 * against what inflates only for entries WITHOUT a data descriptor — the same gap
 * `extractEntries` counts around, one step earlier. `entryData` buffers whatever comes
 * out, so a manifest declaring one byte over a 200 KB deflate stream lands 200 MB in the
 * main process — and preview reaches here before the user has seen the consent card.
 */
async function readEntryBounded(
  zip: StreamZip.StreamZipAsync,
  name: string,
  limit: number,
  label: string
): Promise<Buffer> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of await zip.stream(name)) {
    total += (chunk as Buffer).length
    // Throwing destroys the stream, so the inflate stops AT the limit instead of running
    // to completion and being judged once the memory is already gone.
    if (total > limit) throw new Error(`Package ${label} is over the ${limit} byte limit`)
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks)
}

/**
 * Every entry-table check, shared by preview and extraction: what the archive CLAIMS
 * is validated identically whether or not anything is unpacked afterwards.
 */
async function scanArchive(zip: StreamZip.StreamZipAsync): Promise<{ prefix: string; manifest: MiniAppManifest }> {
  const entries = Object.values(await zip.entries())
  if (entries.length > MAX_ENTRIES) {
    throw new Error(`Package has too many entries: ${entries.length} exceeds ${MAX_ENTRIES}`)
  }

  let total = 0
  for (const e of entries) {
    total += e.size
    if (total > MINI_APP_MAX_EXTRACTED_BYTES) {
      throw new Error(`Package unpacks to ${total} bytes, over the ${MINI_APP_MAX_EXTRACTED_BYTES} limit`)
    }
    const mode = (e.attr >>> 16) & 0xffff & S_IFMT
    if (mode === S_IFLNK) throw new Error(`Package contains a symlink entry: ${e.name}`)
    // Mode 0 means the archive carries no unix metadata; anything else that is
    // neither a regular file nor a directory is a device/fifo/socket.
    if (mode !== 0 && mode !== S_IFREG && mode !== S_IFDIR) {
      throw new Error(`Package contains an unsupported entry type: ${e.name}`)
    }
  }

  const names = entries.map((e) => e.name)
  const prefix = resolvePrefix(names)
  for (const name of names) {
    const rel = prefix && name.startsWith(prefix) ? name.slice(prefix.length) : name
    if (rel.split('/')[0] === MINI_APP_RESERVED_DIR) {
      throw new Error(`Package must not contain the reserved '${MINI_APP_RESERVED_DIR}' directory`)
    }
  }

  // The FAST refusal, on what the table claims — the total-size cap above still admits a
  // single 100 MB entry. `readEntryBounded` is what holds when the claim is a lie.
  const sizeOf = (rel: string) => entries.find((e) => e.name === `${prefix}${rel}`)?.size ?? 0
  if (sizeOf(MANIFEST_NAME) > MINI_APP_MAX_MANIFEST_BYTES) {
    throw new Error(`Package manifest is over the ${MINI_APP_MAX_MANIFEST_BYTES} byte limit`)
  }

  const manifest = MiniAppManifestSchema.parse(
    JSON.parse(
      (await readEntryBounded(zip, `${prefix}${MANIFEST_NAME}`, MINI_APP_MAX_MANIFEST_BYTES, 'manifest')).toString(
        'utf8'
      )
    )
  )

  const has = (rel: string) => names.includes(`${prefix}${rel}`)
  if (!has(manifest.entry)) {
    throw new Error(`Manifest entry file is missing from the package: ${manifest.entry}`)
  }
  if (manifest.icon && !has(manifest.icon.path)) {
    throw new Error(`Manifest icon file is missing from the package: ${manifest.icon.path}`)
  }
  if (manifest.icon && sizeOf(manifest.icon.path) > MINI_APP_MAX_ICON_BYTES) {
    throw new Error(`Package icon is over the ${MINI_APP_MAX_ICON_BYTES} byte limit`)
  }

  return { prefix, manifest }
}

/**
 * Streams every entry itself instead of `zip.extract`: node-stream-zip verifies sizes
 * only for entries WITHOUT a data descriptor, so the entry-table cap in `scanArchive`
 * is what the package claims. This counts what actually inflates.
 */
async function extractEntries(zip: StreamZip.StreamZipAsync, prefix: string, destDir: string): Promise<void> {
  const entries = Object.values(await zip.entries()).filter((e) => e.name.startsWith(prefix) && e.name !== prefix)
  const root = path.resolve(destDir)
  // node-stream-zip refuses `..`, absolute and drive names while reading the table; the
  // invariant is asserted here too, where the write happens, so it never depends on that.
  const target = (name: string) => {
    const out = path.resolve(root, name.slice(prefix.length))
    if (out !== root && !out.startsWith(root + path.sep)) {
      throw new Error(`Package entry escapes the package root: ${name}`)
    }
    return out
  }
  const dirs = new Set(entries.map((e) => (e.isDirectory ? e.name : path.posix.dirname(e.name))))
  for (const dir of dirs) await fs.promises.mkdir(target(dir), { recursive: true })

  let total = 0
  for (const entry of entries) {
    if (!entry.isFile) continue
    const budget = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        total += chunk.length
        if (total > MINI_APP_MAX_EXTRACTED_BYTES) {
          callback(new Error(`Package unpacks to more than ${MINI_APP_MAX_EXTRACTED_BYTES} bytes`))
          return
        }
        callback(null, chunk)
      }
    })
    await pipeline(await zip.stream(entry), budget, fs.createWriteStream(target(entry.name)))
  }
}

function assertPackageSize(size: number): void {
  if (size > MINI_APP_MAX_PACKAGE_BYTES) {
    throw new Error(`Package archive is ${size} bytes, over the ${MINI_APP_MAX_PACKAGE_BYTES} limit`)
  }
}

/** Streamed, never buffered: the file is allowed to be 50 MB. */
export async function sha256File(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256')
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk as Buffer)
  return `sha256:${hash.digest('hex')}`
}

export interface MiniAppArchivePreview {
  manifest: MiniAppManifest
  /** The consent card's icon, straight from the entry table — nothing is unpacked. */
  iconDataUrl: string | null
  /** Pins the exact file the user previewed; confirm re-computes and compares. */
  sha256: string
}

/**
 * Everything the consent card needs, WITHOUT extracting: the entry-table checks, the
 * manifest, the icon bytes, and a hash pinning the file. Disk is touched only by the
 * read stream — preview holds no staging tree (design §10.2).
 */
export async function previewMiniAppArchive(zipPath: string): Promise<MiniAppArchivePreview> {
  const { size } = await fs.promises.stat(zipPath)
  assertPackageSize(size)

  const zip = new StreamZip.async({ file: zipPath })
  try {
    const { prefix, manifest } = await scanArchive(zip)
    // The SAME pipeline the install uses (`transcodeToEntityWebp`, 128x128, bomb-guarded):
    // the `image/webp` label is then true, and the data URL is bounded whatever came in.
    const iconDataUrl = manifest.icon
      ? `data:image/webp;base64,${(
          await transcodeToEntityWebp(
            await assertSupportedIconBytes(
              await readEntryBounded(zip, `${prefix}${manifest.icon.path}`, MINI_APP_MAX_ICON_BYTES, 'icon')
            )
          )
        ).toString('base64')}`
      : null
    return { manifest, iconDataUrl, sha256: await sha256File(zipPath) }
  } finally {
    await zip.close()
  }
}

export async function extractMiniAppArchive(zipPath: string, destDir: string): Promise<MiniAppManifest> {
  // `scanArchive` bounds what a package UNPACKS to; nothing bounded the file the user
  // picked, so a multi-gigabyte one still reached the zip reader.
  const { size } = await fs.promises.stat(zipPath)
  assertPackageSize(size)

  const zip = new StreamZip.async({ file: zipPath })
  try {
    const { prefix, manifest } = await scanArchive(zip)

    await extractEntries(zip, prefix, destDir)
    // Second gate, AFTER extraction: the entry-table checks describe what the archive
    // CLAIMS. The protocol handler trusts that this root really contains everything.
    await assertExtractedTree(destDir, manifest)
    logger.info('Extracted mini app package', { id: manifest.id, version: manifest.version })
    return manifest
  } catch (error) {
    // Reset is best-effort: the ARCHIVE error is the result the caller acts on — an
    // EPERM from the wipe must not replace a symlink refusal.
    await bestEffortCleanup('failed extraction reset', async () => {
      await fs.promises.rm(destDir, { recursive: true, force: true })
      await fs.promises.mkdir(destDir, { recursive: true })
    })
    throw error
  } finally {
    await zip.close()
  }
}
