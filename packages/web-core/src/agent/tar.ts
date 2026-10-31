// Browser `tar` for the desktop workspace archives (`agentWorkspaceStorage.ts`): the `create`, `extract`
// and `list` calls it makes, as gzipped tarballs on ZenFS through modern-tar and `CompressionStream`.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { packTar, type ParsedTarEntryWithData, type TarEntry, unpackTar } from 'modern-tar'

interface ArchiveOptions {
  file: string
  cwd?: string
  gzip?: boolean
}

interface ReadEntry {
  path: string
  type: string
}

/** node-tar's names for the entry types, which `validateWorkspaceArchive` checks. */
const entryTypes: Record<string, string> = {
  file: 'File',
  directory: 'Directory',
  link: 'Link',
  symlink: 'SymbolicLink',
  'character-device': 'CharacterDevice',
  'block-device': 'BlockDevice',
  fifo: 'FIFO'
}

async function transform(data: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream) {
  return new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(stream)).arrayBuffer())
}

async function collect(cwd: string, name: string, entries: TarEntry[]): Promise<void> {
  const target = path.join(cwd, name)
  const children = await readdir(target, { withFileTypes: true }).catch(() => undefined)
  if (!children) {
    const body = await readFile(target)
    entries.push({ header: { name, type: 'file', size: body.byteLength, mode: 0o644 }, body })
    return
  }
  entries.push({ header: { name: name.endsWith('/') ? name : `${name}/`, type: 'directory', size: 0, mode: 0o755 } })
  for (const child of children) await collect(cwd, path.join(name, child.name), entries)
}

async function readArchive(file: string): Promise<ParsedTarEntryWithData[]> {
  const data = new Uint8Array(await readFile(file))
  // node-tar reads gzipped and plain archives alike, telling them apart by the gzip magic bytes.
  const gzipped = data[0] === 0x1f && data[1] === 0x8b
  return unpackTar(gzipped ? await transform(data, new DecompressionStream('gzip')) : data)
}

export async function create(options: ArchiveOptions, files: string[]): Promise<void> {
  const cwd = options.cwd ?? '/'
  const entries: TarEntry[] = []
  for (const file of files) await collect(cwd, file === '.' ? './' : file, entries)
  const archive = await packTar(entries)
  await writeFile(options.file, options.gzip ? await transform(archive, new CompressionStream('gzip')) : archive)
}

export async function list(options: ArchiveOptions & { onReadEntry: (entry: ReadEntry) => void }): Promise<void> {
  for (const { header } of await readArchive(options.file)) {
    options.onReadEntry({ path: header.name, type: entryTypes[header.type ?? 'file'] ?? header.type ?? 'File' })
  }
}

export async function extract(options: ArchiveOptions): Promise<void> {
  const cwd = options.cwd ?? '/'
  for (const { header, data } of await readArchive(options.file)) {
    const target = path.join(cwd, header.name)
    if (path.relative(cwd, target).startsWith('..')) throw new Error(`Unsafe archive entry: ${header.name}`)
    if (header.type === 'directory') {
      await mkdir(target, { recursive: true })
    } else if (header.type === 'file' || header.type === undefined) {
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, data ?? new Uint8Array())
    } else {
      throw new Error(`Unsupported archive entry type ${header.type}: ${header.name}`)
    }
  }
}
