import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import type { AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessionMessages'
import type { CherryMessagePart } from '@shared/data/types/message'
import { withCherryMeta } from '@shared/data/types/uiParts'

import { buildAgentUserContent } from '../agentUserContent'

function message(parts: CherryMessagePart[]): AgentSessionMessageEntity {
  return { data: { parts } } as unknown as AgentSessionMessageEntity
}

function filePart(url: string, filename?: string): CherryMessagePart {
  return { type: 'file', url, mediaType: 'image/jpeg', filename } as unknown as CherryMessagePart
}

describe('buildAgentUserContent', () => {
  it('passes a quote-only request to the agent with the source text intact', () => {
    const content = buildAgentUserContent(
      message([
        withCherryMeta(
          { type: 'text' as const, text: '' },
          {
            quotes: [
              { id: 'quote-1', sourceMessageId: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d001', text: 'First quoted point' }
            ]
          }
        )
      ])
    )
    expect(content).toContain('First quoted point')
    expect(content).toContain('#cherry-quote-N')
  })

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
