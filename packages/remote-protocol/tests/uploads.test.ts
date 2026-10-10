import { describe, expect, it } from 'vitest'

import { agentMethods, agentUploadLimits, encodeAgentCommand } from '../src/agent'

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
  it('validates draft manifests with the same hash-free metadata as prepare', () => {
    const item = {
      attachmentId: 'a',
      uploadId: 'u',
      filename: 'report.pdf',
      mediaType: 'application/pdf',
      byteLength: 1048576
    }
    const schema = agentMethods['agent.attachments.present'].params
    expect(schema.parse({ selectionId: 'draft', sessionId: 'session', sequence: '1', items: [item] }).items).toEqual([
      item
    ])
    expect(
      schema.safeParse({
        selectionId: 'draft',
        sessionId: 'session',
        sequence: '1',
        items: [{ ...item, uploadId: undefined }]
      }).success
    ).toBe(false)
  })
  it('bounds staging metadata without requiring client digests', () => {
    const metadata = {
      uploadId: 'u',
      filename: '报告.pdf',
      mediaType: 'application/pdf',
      byteLength: 0
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
    expect(
      agentMethods['agent.uploads.prepare'].params.safeParse({ ...metadata, sha256: 'a'.repeat(64) }).success
    ).toBe(false)
  })
})
