import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import type { AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessionMessages'
import type { CherryMessagePart } from '@shared/data/types/message'

import { buildAgentUserContent, isManualCompactCommand } from '../agentUserContent'

function message(parts: CherryMessagePart[]): AgentSessionMessageEntity {
  return { data: { parts } } as unknown as AgentSessionMessageEntity
}

function filePart(url: string, filename?: string): CherryMessagePart {
  return { type: 'file', url, mediaType: 'image/jpeg', filename } as unknown as CherryMessagePart
}

describe('buildAgentUserContent', () => {
  it('delivers original filenames alongside local attachment paths', () => {
    const firstUrl = 'file:///C:/managed/uuid-a'
    const secondUrl = 'file:///C:/managed/uuid-b'
    const content = buildAgentUserContent(
      message([
        { type: 'text', text: 'Classify these images.' },
        filePart(firstUrl, '20260406_184133 Alex Diaz.jpg'),
        filePart(secondUrl, 'scan "final".jpg')
      ])
    )

    expect(content).toContain('Attached files (read them with your tools using these absolute paths):')
    expect(content).toContain(`- ${JSON.stringify('20260406_184133 Alex Diaz.jpg')}: ${fileURLToPath(firstUrl)}`)
    expect(content).toContain(`- ${JSON.stringify('scan "final".jpg')}: ${fileURLToPath(secondUrl)}`)
  })

  it('keeps path-only output for legacy file parts without a filename', () => {
    const url = 'file:///C:/managed/uuid-legacy'
    const content = buildAgentUserContent(message([filePart(url)]))

    expect(content).toContain(`- ${fileURLToPath(url)}`)
    expect(content).not.toContain(`- ${JSON.stringify(fileURLToPath(url))}:`)
  })
})

/**
 * The compaction exemption is declared from what the user typed, so this matcher must
 * agree with the runtimes' command admission (dsh's `parseCommand` shape): the command
 * name ends at end-of-string or ASCII whitespace. A looser delimiter turns an ordinary
 * prompt into an exempted compaction and hides its lost reply.
 */
describe('isManualCompactCommand', () => {
  it.each([
    ['bare', '/compact'],
    ['ASCII space', '/compact focus on changes'],
    ['tab', '/compact\tfocus on changes'],
    ['newline', '/compact\nfocus on changes'],
    ['carriage return', '/compact\rfocus on changes']
  ])('recognizes a command name ended by %s', (_label, content) => {
    expect(isManualCompactCommand(content)).toBe(true)
  })

  it.each([
    ['nonbreaking space', '/compact\u00a0focus on changes'],
    ['ideographic space', '/compact\u3000focus on changes'],
    ['zero-width no-break space', '/compact\ufefffocus on changes']
  ])('does not claim %s as a command delimiter', (_label, content) => {
    expect(isManualCompactCommand(content)).toBe(false)
  })

  it('ignores names that only share the /compact prefix', () => {
    expect(isManualCompactCommand('/compaction plan')).toBe(false)
    expect(isManualCompactCommand('/compactify')).toBe(false)
  })
})
