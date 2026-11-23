import { createWriteStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ZipArchive } from 'archiver'
import { onTestFinished } from 'vitest'

import type { DeepseekConversation, DeepseekMessage } from '../deepseek'

export const message = (
  id: number,
  parent_id: number | null,
  role: 'USER' | 'ASSISTANT',
  text: string
): DeepseekMessage => ({
  id,
  parent_id,
  role,
  status: 'FINISHED',
  inserted_at: '2026-01-01T00:00:00Z',
  fragments: [{ type: role === 'USER' ? 'REQUEST' : 'RESPONSE', content: text }]
})
export const conversation = (): DeepseekConversation => ({
  id: 'sample',
  title: 'A synthetic branch',
  current_message_id: 2,
  inserted_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
  messages: [
    message(1, null, 'USER', 'Remember the word mango'),
    message(2, 1, 'ASSISTANT', 'Mango recorded'),
    message(3, 1, 'ASSISTANT', 'Sibling: banana')
  ]
})

export async function archiveFixture(extra: Array<[string, string]> = [], version = 3, source = conversation()) {
  const dir = await mkdtemp(join(tmpdir(), 'deepseek-import-'))
  onTestFinished(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, 'sample.zip')
  const entries: Array<[string, string]> = [
    ['manifest.json', JSON.stringify({ export_format_version: version })],
    ['chat_session_index.json', JSON.stringify([{ id: source.id, message_count: source.messages.length }])],
    [`chat_sessions/${source.id}.json`, JSON.stringify(source)],
    ...extra
  ]
  await new Promise<void>((resolve, reject) => {
    const zip = new ZipArchive({ zlib: { level: 1 } })
    const out = createWriteStream(file)
    out.on('close', resolve).on('error', reject)
    zip.on('error', reject).pipe(out)
    for (const [name, text] of entries) zip.append(text, { name })
    void zip.finalize()
  })
  return file
}
