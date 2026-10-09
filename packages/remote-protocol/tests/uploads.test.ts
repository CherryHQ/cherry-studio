import { describe, expect, it } from 'vitest'

import { agentMethods, agentUploadLimits, encodeAgentCommand } from '../src/agent'
import { remoteLimits } from '../src/connection'

describe('Agent attachments', () => {
  const send = { commandId: 'command', sessionId: 'session', expectedIdleRevision: '0', text: '' }
  it('allows files without text, rejects empty messages, duplicate references and arbitrary file paths', () => {
    const schema = agentMethods['agent.messages.send'].params
    expect(schema.safeParse(send).success).toBe(false)
    expect(schema.parse({ ...send, attachments: [{ uploadId: 'upload' }] }).attachments).toHaveLength(1)
    for (const attachments of [
      [],
      [{ path: '/etc/passwd' }],
      [{ uploadId: 'a' }, { uploadId: 'a' }],
      Array.from({ length: 9 }, (_, i) => ({ uploadId: String(i) }))
    ])
      expect(schema.safeParse({ ...send, attachments }).success).toBe(false)
    expect(encodeAgentCommand('agent.messages.send', { ...send, attachments: [{ uploadId: 'a' }] })).not.toEqual(
      encodeAgentCommand('agent.messages.send', { ...send, attachments: [{ uploadId: 'b' }] })
    )
  })
  it('bounds staging metadata, names and encoded chunks below a secure record', () => {
    const metadata = {
      uploadId: 'u',
      filename: '报告.pdf',
      mediaType: 'application/pdf',
      byteLength: 0,
      sha256: 'a'.repeat(64)
    }
    expect(agentMethods['agent.uploads.prepare'].params.safeParse(metadata).success).toBe(true)
    for (const filename of ['../test', '..', 'a\\b', 'a\u0000b', '图'.repeat(100)])
      expect(agentMethods['agent.uploads.prepare'].params.safeParse({ ...metadata, filename }).success).toBe(false)
    expect(
      agentMethods['agent.uploads.prepare'].params.safeParse({
        ...metadata,
        byteLength: agentUploadLimits.fileBytes + 1
      }).success
    ).toBe(false)
    const params = agentMethods['agent.uploads.write'].params.parse({
      uploadId: 'u'.repeat(256),
      offset: '0',
      writerEpoch: '0',
      chunkSha256: 'a'.repeat(64),
      dataBase64: Buffer.alloc(agentUploadLimits.chunkBytes).toString('base64')
    })
    expect(
      Buffer.byteLength(JSON.stringify({ jsonrpc: '2.0', id: 'i'.repeat(256), method: 'agent.uploads.write', params }))
    ).toBeLessThan(remoteLimits.recordBytes)
    expect(
      agentMethods['agent.uploads.write'].params.safeParse({ ...params, dataBase64: params.dataBase64 + 'AAAA' })
        .success
    ).toBe(false)
  })
})
