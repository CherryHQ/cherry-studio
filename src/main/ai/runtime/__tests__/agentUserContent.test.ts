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

it('retains attachment positions and message-local numbers instead of collapsing different drafts', () => {
  const a = {
    ...filePart('file:///C:/managed/a.png', 'same.png'),
    providerMetadata: { cherry: { contentFormat: 'ordered-parts-v1' } }
  }
  const b = {
    ...filePart('file:///C:/managed/b.txt', 'same.png'),
    providerMetadata: { cherry: { contentFormat: 'ordered-parts-v1' } }
  }
  const before: CherryMessagePart = { type: 'text', text: 'Before😀  ' }
  const after: CherryMessagePart = { type: 'text', text: 'After\n    ' }
  const content = buildAgentUserContent(message([before, a, after, b]))
  expect(content).toBe(
    `Before😀  \n[Attachment 1: "same.png"]\nAttached files (read them with your tools using these absolute paths):\n- "same.png": ${fileURLToPath('file:///C:/managed/a.png')}\nAfter\n    \n[Attachment 2: "same.png"]\nAttached files (read them with your tools using these absolute paths):\n- "same.png": ${fileURLToPath('file:///C:/managed/b.txt')}\n`
  )
  expect(buildAgentUserContent(message([a, before, after, b]))).not.toBe(content)
  expect(buildAgentUserContent(message([b]))).toContain('[Attachment 1: "same.png"]')
})
