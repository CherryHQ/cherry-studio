import { describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/store', () => ({
  default: {
    getState: vi.fn(() => ({ mcp: { servers: [] } })),
    dispatch: vi.fn(),
    subscribe: vi.fn()
  }
}))

vi.mock('@renderer/store/mcp', () => ({
  hubMCPServer: { id: 'hub', name: 'MCP Hub', type: 'inMemory', isActive: true },
  addMCPServer: vi.fn()
}))

vi.mock('@renderer/i18n', () => ({
  default: { t: vi.fn((key: string) => key) }
}))

vi.mock('@renderer/services/SpanManagerService', () => ({
  currentSpan: vi.fn()
}))

vi.mock('@renderer/config/models', () => ({
  isFunctionCallingModel: vi.fn(),
  isVisionModel: vi.fn()
}))

import { mcpToolCallResponseToOpenAIResponsesOutput } from '../mcp-tools'

describe('mcpToolCallResponseToOpenAIResponsesOutput', () => {
  it('uses a safe text fallback when image data is missing', () => {
    const result = mcpToolCallResponseToOpenAIResponsesOutput(
      {
        isError: false,
        content: [{ type: 'image', mimeType: 'image/png' }]
      },
      true
    )

    expect(result).toEqual([
      {
        type: 'input_text',
        text: '[Image result omitted: missing image data]'
      }
    ])
  })

  it('preserves resource details as informative text instead of unsupported type', () => {
    const result = mcpToolCallResponseToOpenAIResponsesOutput(
      {
        isError: false,
        content: [
          {
            type: 'resource',
            resource: {
              uri: 'file://report.pdf',
              mimeType: 'application/pdf'
            }
          }
        ]
      },
      true
    )

    expect(result).toEqual([
      {
        type: 'input_text',
        text: '[Resource result: file://report.pdf (application/pdf)]'
      }
    ])
  })

  it('uses resource text directly when available', () => {
    const result = mcpToolCallResponseToOpenAIResponsesOutput(
      {
        isError: false,
        content: [
          {
            type: 'resource',
            resource: {
              uri: 'file://notes.txt',
              text: 'structured resource text'
            }
          }
        ]
      },
      true
    )

    expect(result).toEqual([
      {
        type: 'input_text',
        text: 'structured resource text'
      }
    ])
  })
})
