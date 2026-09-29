import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream } from 'node:stream/web'

import StreamZip from 'node-stream-zip'
import * as tar from 'tar'
import unbzip2 from 'unbzip2-stream'

import { application } from '@application'
import { isPathWithin } from '@main/utils/binaryEnv'
import { assertZipEntriesWithin } from '@main/utils/zipSafety'

import type { LocalAgentBinaryRecipe } from './installRecipe'
import { systemAgentEntry } from './launch'

const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024

function inside(root: string, name: string): string {
  if (name.includes('\\') || path.posix.isAbsolute(name) || /^[a-z]:/i.test(name))
    throw new Error('Invalid archive path')
  const target = path.resolve(root, name)
  if (!isPathWithin(root, target)) throw new Error('Archive path escapes installation directory')
  return target
}

export async function installBinaryAgent(
  executable: string,
  recipe: LocalAgentBinaryRecipe,
  signal: AbortSignal
): Promise<string> {
  const root = application.getPath('external.acp.agents')
  const bin = application.getPath('external.acp.bin')
  await fs.mkdir(root, { recursive: true })
  const staging = await fs.mkdtemp(path.join(root, `${executable}-${recipe.version}-`))
  const archive = path.join(staging, 'download')
  const content = path.join(staging, 'files')
  let published = false
  try {
    const response = await fetch(recipe.archive, { signal })
    if (!response.ok || !response.body) throw new Error(`Agent download failed: HTTP ${response.status}`)
    const hash = createHash('sha256')
    let bytes = 0
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length
        if (bytes > MAX_ARCHIVE_BYTES) return callback(new Error('Agent archive is too large'))
        hash.update(chunk)
        callback(null, chunk)
      }
    })
    await pipeline(
      Readable.fromWeb(response.body as ReadableStream<Uint8Array>),
      meter,
      createWriteStream(archive, { flags: 'wx' }),
      { signal }
    )
    const checksum = hash.digest('hex')
    if (recipe.sha256 && checksum !== recipe.sha256.toLowerCase()) throw new Error('Agent archive SHA-256 mismatch')
    await fs.mkdir(content)
    const name = new URL(recipe.archive).pathname.toLowerCase()
    if (name.endsWith('.zip')) {
      const zip = new StreamZip.async({ file: archive })
      try {
        const entries = Object.values(await zip.entries())
        assertZipEntriesWithin(
          entries.map((entry) => entry.name),
          content
        )
        if (entries.reduce((size, entry) => size + entry.size, 0) > MAX_ARCHIVE_BYTES * 2)
          throw new Error('Agent archive expands beyond limit')
        for (const entry of entries) {
          inside(content, entry.name)
          if (((entry.attr >>> 16) & 0o170000) === 0o120000) throw new Error('Archive contains a symbolic link')
        }
        await zip.extract(null, content)
        if (process.platform !== 'win32') {
          for (const entry of entries) {
            if (!entry.isDirectory && (entry.attr >>> 16) & 0o111) await fs.chmod(inside(content, entry.name), 0o755)
          }
        }
      } finally {
        await zip.close()
      }
    } else if (/\.(tar\.gz|tgz|tar\.bz2|tbz2|tar)$/.test(name)) {
      let unpacked = 0
      let invalidEntry: Error | undefined
      const extract = tar.x({
        cwd: content,
        strict: true,
        preservePaths: false,
        filter: (entryPath, entry) => {
          if (invalidEntry) return false
          try {
            inside(content, entryPath)
            if (!('type' in entry) || (entry.type !== 'File' && entry.type !== 'Directory'))
              throw new Error('Unsupported archive entry type')
            unpacked += entry.size
            if (unpacked > MAX_ARCHIVE_BYTES * 2) throw new Error('Agent archive expands beyond limit')
            return true
          } catch (error) {
            invalidEntry = error instanceof Error ? error : new Error(String(error))
            return false
          }
        }
      })
      if (/\.(tar\.bz2|tbz2)$/.test(name)) await pipeline(createReadStream(archive), unbzip2(), extract, { signal })
      else await pipeline(createReadStream(archive), extract, { signal })
      if (invalidEntry) throw invalidEntry
    } else {
      const target = inside(content, recipe.cmd)
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.copyFile(archive, target)
    }
    signal.throwIfAborted()
    const command = inside(content, recipe.cmd)
    if (!(await fs.stat(command)).isFile()) throw new Error('Agent executable is missing from archive')
    await fs.chmod(command, 0o755)
    await fs.rm(archive)
    await fs.mkdir(bin, { recursive: true })
    const entry = systemAgentEntry(executable)
    const wrapper =
      process.platform === 'win32'
        ? `@echo off\r\n"${command.replace(/%/g, '%%')}" %*\r\n`
        : `#!/bin/sh\nexec '${command.replace(/'/g, "'\\''")}' "$@"\n`
    await fs.writeFile(entry, wrapper, { flag: 'wx', mode: 0o755 })
    published = true
    return entry
  } finally {
    if (!published) await fs.rm(staging, { recursive: true, force: true })
  }
}
