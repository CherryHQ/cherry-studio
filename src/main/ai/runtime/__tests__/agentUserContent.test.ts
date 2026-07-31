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
        { type: 'text', text: 'Classify these images.' } as CherryMessagePart,
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
