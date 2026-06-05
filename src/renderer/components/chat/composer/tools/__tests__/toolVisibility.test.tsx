import { getToolsForScope, TopicType } from '@renderer/components/chat/composer/tools/types'
import { describe, expect, it, vi } from 'vitest'

const { mockIsGenerateImageModel, mockIsReasoningModel, mockIsSupportedToolUse } = vi.hoisted(() => ({
  mockIsGenerateImageModel: vi.fn(),
  mockIsReasoningModel: vi.fn(),
  mockIsSupportedToolUse: vi.fn()
}))

vi.mock('@renderer/config/models', () => ({
  isGenerateImageModel: (...args: unknown[]) => mockIsGenerateImageModel(...args),
  isReasoningModel: (...args: unknown[]) => mockIsReasoningModel(...args)
}))

vi.mock('@renderer/utils/assistant', () => ({
  isSupportedToolUse: (...args: unknown[]) => mockIsSupportedToolUse(...args)
}))

vi.mock('@renderer/components/chat/composer/tools/components/KnowledgeBaseButton', () => ({
  KnowledgeBaseToolRuntime: () => null
}))

vi.mock('@renderer/components/chat/composer/tools/components/ThinkingButton', () => ({
  ThinkingToolRuntime: () => null
}))

vi.mock('@renderer/components/chat/composer/tools/components/QuickPhrasesButton', () => ({
  QuickPhrasesToolRuntime: () => null
}))

vi.mock('@renderer/components/chat/composer/tools/components/WebSearchButton', () => ({
  WebSearchToolRuntime: () => null
}))

vi.mock('@renderer/hooks/agents/useAgent', () => ({
  useAgent: () => ({ agent: undefined })
}))

vi.mock('@renderer/hooks/useMcpRuntimeStatus', () => ({
  useMcpRuntimeStatusMap: () => ({})
}))

vi.mock('@renderer/hooks/useMcpServer', () => ({
  useMcpServers: () => ({ mcpServers: [] })
}))

describe('composer tool visibility', () => {
  it('keeps assistant core capabilities discoverable when the current model cannot enable them', async () => {
    mockIsGenerateImageModel.mockReturnValue(false)
    mockIsReasoningModel.mockReturnValue(false)
    mockIsSupportedToolUse.mockReturnValue(false)

    await import('../definitions/generateImageTool')
    await import('../definitions/knowledgeBaseTool')
    await import('../definitions/thinkingTool')

    const tools = getToolsForScope(TopicType.Chat, {
      assistant: {
        id: 'assistant-1',
        settings: {},
        mcpServerIds: [],
        knowledgeBaseIds: []
      } as any,
      model: {
        id: 'text-only',
        providerId: 'provider-1',
        name: 'Text only'
      } as any
    })

    expect(tools.map((tool) => tool.key)).toEqual(
      expect.arrayContaining(['generate_image', 'knowledge_base', 'thinking'])
    )
  })

  it('hides persisted-assistant tools for the runtime default assistant in chat scope', async () => {
    await import('../definitions/mcpStatusTool')
    await import('../definitions/webSearchTool')
    await import('../definitions/thinkingTool')
    await import('../definitions/knowledgeBaseTool')

    const model = {
      id: 'text-only',
      providerId: 'provider-1',
      name: 'Text only'
    } as any

    const chatDefaultTools = getToolsForScope(TopicType.Chat, {
      assistant: undefined,
      model
    }).map((tool) => tool.key)

    expect(chatDefaultTools).not.toContain('mcp_status')
    expect(chatDefaultTools).not.toContain('web_search')
    expect(chatDefaultTools).not.toContain('thinking')
    expect(chatDefaultTools).not.toContain('knowledge_base')
    expect(
      getToolsForScope(TopicType.Chat, { assistant: { id: 'assistant-1', settings: {} } as any, model }).map(
        (tool) => tool.key
      )
    ).toContain('mcp_status')
    expect(getToolsForScope(TopicType.Session, { model }).map((tool) => tool.key)).toContain('mcp_status')
    expect(getToolsForScope('quick-assistant', { model }).map((tool) => tool.key)).not.toContain('mcp_status')
  })
})
