import { type BigIntStats } from 'node:fs'
import { chmod, lstat, mkdir, open, readdir, readlink, realpath, symlink } from 'node:fs/promises'
import path from 'node:path'

import type { WorkspaceCopyStatistics } from '@shared/data/api/schemas/agentWorkspaceCopies'

import { copyWorkspaceFile } from './copyWorkspaceFile'
import { WorkspaceCopyError } from './WorkspaceCopyError'
import { containsWorkspacePath } from './workspaceCopyPaths'

const exclusions = new Set(['.git', 'node_modules', '.cherry-workspaces'])

interface Entry {
  relative: string
  kind: 'file' | 'directory' | 'link'
  version: string
  size: number
  mode: number
  link?: string
}

function version(stat: BigIntStats): string {
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs, stat.mode].join(':')
}

async function* scan(
  root: string,
  signal: AbortSignal,
  excluded?: () => void,
  applyExclusions = true
): AsyncGenerator<Entry> {
  const rootStat = await lstat(root, { bigint: true })
  async function* walk(relative: string): AsyncGenerator<Entry> {
    signal.throwIfAborted()
    const absolute = path.join(root, relative)
    const stat = await lstat(absolute, { bigint: true })
    if (stat.dev !== rootStat.dev || stat.ino === 0n)
      throw new WorkspaceCopyError('unsupported_entry', 'scan', relative)
    const kind = stat.isSymbolicLink() ? 'link' : stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : undefined
    if (!kind) throw new WorkspaceCopyError('unsupported_entry', 'scan', relative)
    const entry: Entry = {
      relative,
      kind,
      version: version(stat),
      size: Number(stat.size),
      mode: Number(stat.mode & 0o777n)
    }
    if (kind === 'link') {
      // Node cannot reliably distinguish directory symlinks from other Windows reparse tags.
      if (process.platform === 'win32') throw new WorkspaceCopyError('unsupported_link', 'scan', relative)
      const target = await realpath(absolute).catch((cause: unknown) => {
        throw new WorkspaceCopyError('unsupported_link', 'scan', relative, { cause })
      })
      if (
        !containsWorkspacePath(root, target) ||
        path
          .relative(root, target)
          .split(path.sep)
          .some((part) => exclusions.has(part))
      ) {
        throw new WorkspaceCopyError('unsupported_link', 'scan', relative)
      }
      const raw = await readlink(absolute)
      const lexical = path.resolve(path.dirname(absolute), raw)
      if (
        !containsWorkspacePath(root, lexical) ||
        path
          .relative(root, lexical)
          .split(path.sep)
          .some((part) => exclusions.has(part))
      ) {
        throw new WorkspaceCopyError('unsupported_link', 'scan', relative)
      }
      entry.link = path.relative(path.dirname(absolute), target) || '.'
    } else if ((await realpath(absolute)) !== absolute) {
      throw new WorkspaceCopyError('unsupported_entry', 'scan', relative)
    }
    yield entry
    if (kind === 'directory') {
      for (const name of (await readdir(absolute)).sort()) {
        if (applyExclusions && exclusions.has(name)) {
          excluded?.()
          continue
        }
        yield* walk(path.join(relative, name))
      }
    }
    if (version(await lstat(absolute, { bigint: true })) !== entry.version)
      throw new WorkspaceCopyError('source_changed', 'scan', relative)
  }
  yield* walk('')
}

/** The caller owns the empty staging tree and index file, and must await this promise before cleanup. */
export async function copyWorkspaceTree(input: {
  source: string
  target: string
  index: string
  indexIdentity: string
  signal: AbortSignal
  progress?: (statistics: WorkspaceCopyStatistics) => void
}): Promise<WorkspaceCopyStatistics> {
  const { source, target, signal } = input
  const stats: WorkspaceCopyStatistics = {
    files: 0,
    directories: 0,
    links: 0,
    logicalBytes: 0,
    clonedFiles: 0,
    copiedFiles: 0,
    excludedEntries: 0,
    fallbackReasons: {}
  }
  const index = await open(input.index, 'r+')
  try {
    const indexStat = await index.stat({ bigint: true })
    if (!indexStat.isFile() || `${indexStat.dev}:${indexStat.ino}` !== input.indexIdentity || indexStat.size !== 0n) {
      throw new WorkspaceCopyError('ownership_mismatch', 'copy')
    }
    for await (const entry of scan(source, signal, () => stats.excludedEntries++)) {
      await index.write(`${JSON.stringify(entry)}\n`)
    }
    const reader = index.readLines({ start: 0, autoClose: false })
    try {
      for await (const line of reader) {
        signal.throwIfAborted()
        const entry: Entry = JSON.parse(line)
        const from = path.join(source, entry.relative)
        const to = path.join(target, entry.relative)
        if (version(await lstat(from, { bigint: true })) !== entry.version)
          throw new WorkspaceCopyError('source_changed', 'copy', entry.relative)
        if (entry.kind === 'directory') {
          if (entry.relative) await mkdir(to)
          stats.directories++
        } else if (entry.kind === 'link') {
          await symlink(entry.link!, to)
          stats.links++
        } else {
          signal.throwIfAborted()
          const result = await copyWorkspaceFile(from, to)
          stats[result.method === 'cloned' ? 'clonedFiles' : 'copiedFiles']++
          if (result.fallbackReason)
            stats.fallbackReasons[result.fallbackReason] = (stats.fallbackReasons[result.fallbackReason] ?? 0) + 1
          if (process.platform !== 'win32') await chmod(to, entry.mode)
          stats.files++
          stats.logicalBytes += entry.size
        }
        if (version(await lstat(from, { bigint: true })) !== entry.version)
          throw new WorkspaceCopyError('source_changed', 'copy', entry.relative)
        input.progress?.({ ...stats, fallbackReasons: { ...stats.fallbackReasons } })
      }
    } finally {
      reader.close()
    }
    const validation = index.readLines({ start: 0, autoClose: false })
    const iterator = validation[Symbol.asyncIterator]()
    try {
      for await (const actual of scan(source, signal)) {
        const expected = await iterator.next()
        if (expected.done || expected.value !== JSON.stringify(actual))
          throw new WorkspaceCopyError('source_changed', 'validate', actual.relative)
        const destination = await lstat(path.join(target, actual.relative), { bigint: true })
        if (actual.kind === 'file' && (!destination.isFile() || Number(destination.size) !== actual.size))
          throw new WorkspaceCopyError('copy_invalid', 'validate', actual.relative)
        if (actual.kind === 'directory' && !destination.isDirectory())
          throw new WorkspaceCopyError('copy_invalid', 'validate', actual.relative)
        if (
          actual.kind === 'link' &&
          (!destination.isSymbolicLink() || (await readlink(path.join(target, actual.relative))) !== actual.link)
        )
          throw new WorkspaceCopyError('copy_invalid', 'validate', actual.relative)
      }
      if (!(await iterator.next()).done) throw new WorkspaceCopyError('source_changed', 'validate')
    } finally {
      validation.close()
    }
    const targetIndex = index.readLines({ start: 0, autoClose: false })
    const expectedEntries = targetIndex[Symbol.asyncIterator]()
    const directories: Entry[] = []
    try {
      for await (const actual of scan(target, signal, undefined, false)) {
        const next = await expectedEntries.next()
        const expected: Entry | undefined = next.done ? undefined : JSON.parse(next.value)
        if (
          !expected ||
          actual.relative !== expected.relative ||
          actual.kind !== expected.kind ||
          (actual.kind === 'file' &&
            (actual.size !== expected.size || (process.platform !== 'win32' && actual.mode !== expected.mode))) ||
          (actual.kind === 'link' && actual.link !== expected.link)
        ) {
          throw new WorkspaceCopyError('copy_invalid', 'validate', actual.relative)
        }
      }
      if (!(await expectedEntries.next()).done) throw new WorkspaceCopyError('copy_invalid', 'validate')
    } finally {
      targetIndex.close()
    }
    if (process.platform !== 'win32') {
      const modes = index.readLines({ start: 0, autoClose: false })
      try {
        for await (const line of modes) {
          signal.throwIfAborted()
          const entry: Entry = JSON.parse(line)
          while (
            directories.length &&
            !containsWorkspacePath(path.join(target, directories.at(-1)!.relative), path.join(target, entry.relative))
          ) {
            const directory = directories.pop()!
            await chmod(path.join(target, directory.relative), directory.mode)
          }
          if (entry.kind === 'directory') directories.push(entry)
        }
        while (directories.length) {
          const directory = directories.pop()!
          await chmod(path.join(target, directory.relative), directory.mode)
        }
      } finally {
        modes.close()
      }
    }
    return stats
  } finally {
    await index.close()
  }
}
