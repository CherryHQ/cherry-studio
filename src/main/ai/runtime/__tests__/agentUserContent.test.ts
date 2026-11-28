import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import type { AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessionMessages'
import type { CherryMessagePart } from '@shared/data/types/message'

import { buildAgentUserContent } from '../agentUserContent'

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

    expect(content).toContain(JSON.stringify('20260406_184133 Alex Diaz.jpg'))
    expect(content).toContain(fileURLToPath(firstUrl))
    expect(content).toContain(JSON.stringify('scan "final".jpg'))
    expect(content).toContain(fileURLToPath(secondUrl))
  })

  it('keeps path-only output for legacy file parts without a filename', () => {
    const url = 'file:///C:/managed/uuid-legacy'
    const content = buildAgentUserContent(message([filePart(url)]))

    expect(content).toContain(fileURLToPath(url))
  })

  it('forwards every attached image in the user order (#20030)', () => {
    const content = buildAgentUserContent(
      message([
        { type: 'text', text: 'Compare these screenshots.' },
        filePart('file:///C:/managed/first', 'first.png'),
        filePart('file:///C:/managed/second', 'second.jpg'),
        filePart('file:///C:/managed/third', 'third.webp')
      ])
    )

    const first = content.indexOf(fileURLToPath('file:///C:/managed/first'))
    const second = content.indexOf(fileURLToPath('file:///C:/managed/second'))
    const third = content.indexOf(fileURLToPath('file:///C:/managed/third'))
    expect(first).toBeGreaterThanOrEqual(0)
    expect(second).toBeGreaterThan(first)
    expect(third).toBeGreaterThan(second)
    expect(content).toContain(JSON.stringify('first.png'))
    expect(content).toContain(JSON.stringify('second.jpg'))
    expect(content).toContain(JSON.stringify('third.webp'))
  })

  it('keeps non-image attachments alongside multiple images without dropping any', () => {
    const content = buildAgentUserContent(
      message([
        { type: 'text', text: 'Review.' },
        { type: 'file', url: 'file:///C:/managed/a', mediaType: 'image/png', filename: 'a.png' },
        { type: 'file', url: 'file:///C:/managed/doc', mediaType: 'application/pdf', filename: 'doc.pdf' },
        { type: 'file', url: 'file:///C:/managed/b', mediaType: 'image/jpeg', filename: 'b.jpg' }
      ] as unknown as CherryMessagePart[])
    )

    expect(content).toContain(fileURLToPath('file:///C:/managed/a'))
    expect(content).toContain(fileURLToPath('file:///C:/managed/doc'))
    expect(content).toContain(fileURLToPath('file:///C:/managed/b'))
    expect(content.indexOf(fileURLToPath('file:///C:/managed/a'))).toBeLessThan(
      content.indexOf(fileURLToPath('file:///C:/managed/b'))
    )
  })
})
