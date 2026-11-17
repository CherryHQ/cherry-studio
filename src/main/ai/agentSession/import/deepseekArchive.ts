import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'

import StreamZip from 'node-stream-zip'
import * as z from 'zod'

import { assertNoFoldedPathCollisions } from '@main/utils/zipSafety'

import { deepseekFiles, deepseekIndexSchema, parseDeepseekConversation } from './deepseek'

const MAX_ENTRY_BYTES = 32 * 1024 * 1024
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024
const MAX_TOTAL_BYTES = 1024 * 1024 * 1024

export async function deepseekArchiveDigest(file: string): Promise<string> {
  if ((await stat(file)).size > MAX_ARCHIVE_BYTES) throw new Error('DeepSeek archive is too large')
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

export async function openDeepseekArchive(file: string) {
  if ((await stat(file)).size > MAX_ARCHIVE_BYTES) throw new Error('DeepSeek archive is too large')
  const zip = new StreamZip.async({ file })
  try {
    const entries = await zip.entries()
    const names = Object.keys(entries)
    if (names.length !== (await zip.entriesCount) || names.length > 20_000)
      throw new Error('Duplicate or excessive ZIP entries')
    assertNoFoldedPathCollisions(names)
    let total = 0
    for (const entry of Object.values(entries)) {
      const mode = (entry.attr >>> 16) & 0xf000
      if ((mode !== 0 && mode !== 0x8000 && mode !== 0x4000) || entry.encrypted)
        throw new Error('Unsupported ZIP entry')
      if (
        entry.name.includes('\\') ||
        entry.name.startsWith('/') ||
        /^[A-Za-z]:/.test(entry.name) ||
        entry.name.split('/').some((part) => part === '..' || part === '.')
      )
        throw new Error('Unsafe ZIP path')
      total += entry.size
      if (entry.size > MAX_ENTRY_BYTES || total > MAX_TOTAL_BYTES)
        throw new Error('DeepSeek archive exceeds extraction limits')
    }
    const read = async (name: string): Promise<Buffer> => {
      const entry = entries[name]
      if (!entry?.isFile) throw new Error(`Missing DeepSeek archive entry: ${name}`)
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of await zip.stream(name)) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        size += bytes.length
        if (size > MAX_ENTRY_BYTES || size > entry.size) throw new Error('DeepSeek entry exceeds declared size')
        chunks.push(bytes)
      }
      if (size !== entry.size) throw new Error('Incomplete DeepSeek archive entry')
      return Buffer.concat(chunks)
    }
    const json = async (name: string): Promise<unknown> => JSON.parse((await read(name)).toString('utf8'))
    z.object({ export_format_version: z.literal(3) }).parse(await json('manifest.json'))
    const index = deepseekIndexSchema.parse(await json('chat_session_index.json'))
    if (new Set(index.map((item) => item.id)).size !== index.length)
      throw new Error('Duplicate DeepSeek conversation ID')
    const sessionNames = new Set(names.filter((name) => /^chat_sessions\/[^/]+\.json$/.test(name)))
    if (sessionNames.size !== index.length) throw new Error('DeepSeek index does not match sessions')
    const load = async (id: string) => {
      const name = `chat_sessions/${id}.json`
      if (!sessionNames.has(name)) throw new Error('Missing DeepSeek conversation')
      const raw = await json(name)
      let value: ReturnType<typeof parseDeepseekConversation>
      try {
        value = parseDeepseekConversation(raw)
      } catch (error) {
        throw new Error(`Invalid DeepSeek conversation ${id}`, { cause: error })
      }
      if (value.id !== id || value.messages.length !== index.find((item) => item.id === id)?.message_count)
        throw new Error('DeepSeek index does not match conversation')
      const attachments = deepseekFiles(value)
      if (
        attachments.reduce((total, file) => total + (file.export_path === null ? 0 : file.file_size), 0) >
        64 * 1024 * 1024
      )
        throw new Error('DeepSeek conversation attachments exceed memory limits')
      for (const attachment of attachments) {
        if (
          attachment.export_path !== null &&
          (!entries[attachment.export_path]?.isFile || entries[attachment.export_path].size !== attachment.file_size)
        )
          throw new Error('Missing or invalid DeepSeek attachment')
      }
      return value
    }
    return { index, load, read, close: () => zip.close() }
  } catch (error) {
    await zip.close()
    throw error
  }
}
