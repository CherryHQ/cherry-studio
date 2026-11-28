import fs from 'node:fs/promises'
import path from 'node:path'

import { loggerService } from '@logger'
import { isWin } from '@main/core/platform'

const logger = loggerService.withContext('LaunchOverlay')

const MANIFEST = 'manifest.json'
const HOME = 'home'

/** A file Cherry generates into the overlay, relative to the overlay home. */
export interface OverlayFile {
  relativePath: string
  content: string
}

type LinkMethod = 'symlink' | 'junction' | 'hardlink' | 'copy'

/** A real-home entry shared into the overlay, with the real entry's state when it was shared. */
interface SharedEntry {
  method: LinkMethod
  mtimeMs: number
  size: number
  /** Overlay copy state, for `copy` only: a copy is unchanged while it still matches this. */
  copy?: { mtimeMs: number; size: number }
}

interface Manifest {
  version: 1
  realHome?: string
  /** False until every link exists; an unready overlay never started a process and is only removed. */
  ready: boolean
  generated: string[]
  /** Directories split into real overlay directories ('' is the home), each with its shared entries. */
  levels: Record<string, Record<string, SharedEntry>>
}

const isMissing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT'

async function lstatOrUndefined(file: string) {
  return fs.lstat(file).catch((error: unknown) => {
    if (isMissing(error)) return undefined
    throw error
  })
}

async function readManifest(dir: string): Promise<Manifest | undefined> {
  const content = await fs.readFile(path.join(dir, MANIFEST), 'utf8').catch((error: unknown) => {
    if (isMissing(error)) return undefined
    throw error
  })
  return content ? (JSON.parse(content) as Manifest) : undefined
}

function writeManifest(dir: string, manifest: Manifest) {
  return fs.writeFile(path.join(dir, MANIFEST), JSON.stringify(manifest), { mode: 0o600 })
}

function splitDirectories(files: readonly OverlayFile[]): string[] {
  const levels = new Set([''])
  for (const { relativePath } of files) {
    for (let dir = path.dirname(relativePath); dir !== '.' && dir !== ''; dir = path.dirname(dir)) levels.add(dir)
  }
  return [...levels].sort((a, b) => a.length - b.length)
}

async function share(target: string, link: string, directory: boolean): Promise<LinkMethod> {
  if (directory) {
    await fs.symlink(target, link, isWin ? 'junction' : 'dir')
    return isWin ? 'junction' : 'symlink'
  }
  if (!isWin) {
    // SQLite resolves symlinks before naming its journal, so shared databases stay consistent.
    await fs.symlink(target, link, 'file')
    return 'symlink'
  }
  try {
    await fs.link(target, link)
    return 'hardlink'
  } catch {
    await fs.copyFile(target, link)
    return 'copy'
  }
}

/**
 * Builds a launch home under `dir`: generated files are real, every other entry of `realHome` is
 * shared by link so the CLI keeps the user's sessions, skills and sign-in state.
 */
export async function buildLaunchOverlay(
  dir: string,
  realHome: string | undefined,
  files: readonly OverlayFile[]
): Promise<string> {
  const home = path.join(dir, HOME)
  const generated = files.map((file) => path.normalize(file.relativePath))
  if (generated.some((file) => path.isAbsolute(file) || file.startsWith('..')))
    throw new Error('Overlay files must stay inside the overlay home')
  const levels = splitDirectories(files)
  const reserved = new Set([...levels, ...generated])
  const manifest: Manifest = { version: 1, realHome, ready: false, generated, levels: {} }
  const pending: { target: string; link: string; directory: boolean; level: string; name: string }[] = []
  for (const level of levels) {
    manifest.levels[level] = {}
    if (!realHome) continue
    const realDir = path.join(realHome, level)
    const names: string[] = await fs.readdir(realDir).catch((error: unknown) => {
      if (isMissing(error) || (error as NodeJS.ErrnoException).code === 'ENOTDIR') return []
      throw error
    })
    for (const name of names) {
      if (reserved.has(path.join(level, name))) continue
      const target = path.join(realDir, name)
      const stat = await fs.lstat(target)
      const directory = (await fs.stat(target).catch(() => stat)).isDirectory()
      manifest.levels[level][name] = { method: 'symlink', mtimeMs: stat.mtimeMs, size: stat.size }
      pending.push({ target, link: path.join(home, level, name), directory, level, name })
    }
  }
  await fs.mkdir(dir, { recursive: true })
  await writeManifest(dir, manifest)
  for (const level of levels) await fs.mkdir(path.join(home, level), { recursive: true })
  for (const { relativePath, content } of files)
    await fs.writeFile(path.join(home, relativePath), content, { mode: 0o600 })
  for (const entry of pending) {
    const shared = manifest.levels[entry.level][entry.name]
    shared.method = await share(entry.target, entry.link, entry.directory)
    if (shared.method === 'copy') {
      const copy = await fs.lstat(entry.link)
      shared.copy = { mtimeMs: copy.mtimeMs, size: copy.size }
    }
  }
  manifest.ready = true
  await writeManifest(dir, manifest)
  return home
}

async function stillShared(overlay: string, real: string, entry: SharedEntry): Promise<boolean> {
  const stat = await lstatOrUndefined(overlay)
  if (!stat) return false
  if (entry.method === 'symlink' || entry.method === 'junction') return stat.isSymbolicLink()
  if (entry.method === 'copy') return stat.mtimeMs === entry.copy?.mtimeMs && stat.size === entry.copy.size
  const realStat = await lstatOrUndefined(real)
  return !!realStat && realStat.ino === stat.ino && realStat.dev === stat.dev
}

async function realUnchanged(real: string, entry: SharedEntry): Promise<boolean> {
  const stat = await lstatOrUndefined(real)
  return !!stat && stat.mtimeMs === entry.mtimeMs && stat.size === entry.size
}

async function moveInto(source: string, destination: string) {
  await fs.mkdir(path.dirname(destination), { recursive: true })
  try {
    await fs.rename(source, destination)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
    await fs.cp(source, destination, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true })
  }
}

async function writeBack(overlay: string, real: string) {
  const temporary = `${real}.cherry-${process.pid}-${Date.now()}`
  await fs.copyFile(overlay, temporary)
  await fs.rename(temporary, real)
}

/** Unlinks every link before deleting, so removal never descends into the user's real home. */
async function removeTree(target: string) {
  const stat = await lstatOrUndefined(target)
  if (!stat) return
  if (stat.isSymbolicLink()) return fs.unlink(target)
  if (stat.isDirectory()) {
    for (const name of await fs.readdir(target)) await removeTree(path.join(target, name))
    return fs.rmdir(target)
  }
  return fs.unlink(target)
}

async function reconcileLevel(manifest: Manifest, home: string, level: string, generated: Set<string>) {
  const realHome = manifest.realHome!
  const shared = manifest.levels[level] ?? {}
  const overlayDir = path.join(home, level)
  const names: string[] = await fs.readdir(overlayDir).catch((error: unknown) => {
    if (isMissing(error)) return []
    throw error
  })
  for (const name of names) {
    const relative = path.join(level, name)
    if (generated.has(relative) || relative in manifest.levels) continue
    const overlay = path.join(overlayDir, name)
    const real = path.join(realHome, relative)
    const entry = shared[name]
    if (!entry) {
      // Created by the CLI during the launch: it belongs to the user's home.
      if (await lstatOrUndefined(real)) logger.warn('Kept the existing home entry over a launch-created one', { real })
      else await moveInto(overlay, real)
      continue
    }
    if (await stillShared(overlay, real, entry)) continue
    const stat = await fs.lstat(overlay)
    if (stat.isFile() && (await realUnchanged(real, entry))) await writeBack(overlay, real)
    else logger.warn('Discarded a launch edit because the home entry changed meanwhile', { real })
  }
  // A file the CLI deleted is deleted from the home too; a removed directory link never deletes the directory.
  for (const [name, entry] of Object.entries(shared)) {
    if (names.includes(name)) continue
    const real = path.join(realHome, level, name)
    if ((await realUnchanged(real, entry)) && (await fs.lstat(real)).isFile()) await fs.unlink(real)
  }
}

/**
 * Returns what the launch changed to the user's home and deletes the overlay: created entries
 * move back, replaced files are written back only over an unchanged original, generated files go.
 */
export async function reconcileLaunchOverlay(dir: string): Promise<void> {
  const manifest = await readManifest(dir)
  const home = path.join(dir, HOME)
  if (manifest?.ready && manifest.realHome) {
    const generated = new Set(manifest.generated)
    const levels = Object.keys(manifest.levels).sort((a, b) => b.length - a.length)
    for (const level of levels) await reconcileLevel(manifest, home, level, generated)
  }
  await removeTree(dir)
}

/** Reconciles overlays a previous run left behind, skipping the ones still in use. */
export async function reclaimLaunchOverlays(root: string, live: ReadonlySet<string>): Promise<void> {
  const names: string[] = await fs.readdir(root).catch((error: unknown) => {
    if (isMissing(error)) return []
    throw error
  })
  for (const name of names) {
    const dir = path.join(root, name)
    if (live.has(dir)) continue
    await reconcileLaunchOverlay(dir).catch((error: unknown) =>
      logger.warn('Failed to reclaim a launch overlay', { dir, error })
    )
  }
}
