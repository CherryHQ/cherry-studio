import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { readClaudeTranscriptEvidence } from '../transcriptEvidence'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-projects-'))
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

const SESSION = '05e5911a-b5b1-4350-89be-12f48a0162cf'

const entries = [
  { type: 'user', timestamp: 't1', message: { role: 'user', content: 'please refactor my private repo' } },
  {
    type: 'assistant',
    timestamp: 't2',
    message: {
      model: 'glm-4.6',
      stop_reason: 'tool_use',
      content: [
        { type: 'text', text: 'I will read the file' },
        { type: 'tool_use', name: 'Read', input: { file_path: '/secret/path' } }
      ]
    }
  },
  {
    type: 'user',
    timestamp: 't3',
    message: { role: 'user', content: [{ type: 'tool_result', content: 'File does not exist.', is_error: true }] }
  },
  {
    type: 'system',
    subtype: 'api_error',
    timestamp: 't4',
    level: 'error',
    error: { message: 'Connection error.', connection: { code: 'ECONNRESET' } },
    retryAttempt: 3,
    maxRetries: 10
  },
  {
    type: 'assistant',
    timestamp: 't5',
    isApiErrorMessage: true,
    isSidechain: true,
    message: { model: '<synthetic>', content: [{ type: 'text', text: 'API Error: 400 thinking is not supported' }] }
  }
]

function writeTranscript(project: string, sessionId: string, lines: string[]): void {
  fs.mkdirSync(path.join(root, project), { recursive: true })
  fs.writeFileSync(path.join(root, project, `${sessionId}.jsonl`), lines.join('\n'))
}

describe('readClaudeTranscriptEvidence', () => {
  it('turns the transcript into diagnostic events without the conversation text', async () => {
    writeTranscript('-Users-me-workspace', SESSION, [...entries.map((entry) => JSON.stringify(entry)), '{broken'])
    const events = await readClaudeTranscriptEvidence(root, SESSION, 50)
    expect(events).toEqual([
      { kind: 'assistant', at: 't2', model: 'glm-4.6', stopReason: 'tool_use', tools: ['Read'] },
      { kind: 'tool_error', at: 't3', content: 'File does not exist.' },
      expect.objectContaining({ kind: 'system', subtype: 'api_error', at: 't4', retryAttempt: 3, maxRetries: 10 }),
      expect.objectContaining({
        kind: 'api_error_message',
        subagent: true,
        text: 'API Error: 400 thinking is not supported'
      })
    ])
    const serialized = JSON.stringify(events)
    expect(serialized).not.toContain('private repo')
    expect(serialized).not.toContain('I will read the file')
    expect(serialized).not.toContain('/secret/path')
  })

  it('keeps only the newest events', async () => {
    writeTranscript(
      '-Users-me-workspace',
      SESSION,
      entries.map((entry) => JSON.stringify(entry))
    )
    const events = await readClaudeTranscriptEvidence(root, SESSION, 1)
    expect(events).toEqual([expect.objectContaining({ kind: 'api_error_message' })])
  })

  it('returns undefined for a missing transcript or a token that is not a session id', async () => {
    expect(await readClaudeTranscriptEvidence(root, '11111111-2222-3333-4444-555555555555', 10)).toBeUndefined()
    expect(await readClaudeTranscriptEvidence(root, '../../etc/passwd', 10)).toBeUndefined()
    expect(await readClaudeTranscriptEvidence(path.join(root, 'missing'), SESSION, 10)).toBeUndefined()
  })
})
