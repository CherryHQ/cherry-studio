import { getToolsForScope } from '@renderer/components/composer/tools/builtinTools'
import { TopicType } from '@renderer/components/composer/tools/types'
import { describe, expect, it, vi } from 'vitest'

const { mockIsGenerateImageModel, mockIsReasoningModel, mockIsSupportedToolUse } = vi.hoisted(() => ({
  mockIsGenerateImageModel: vi.fn(),
  mockIsReasoningModel: vi.fn(),
  mockIsSupportedToolUse: vi.fn()
}))

vi.mock('@renderer/utils/model', () => ({
  isGenerateImageModel: (...args: unknown[]) => mockIsGenerateImageModel(...args),
  isReasoningModel: (...args: unknown[]) => mockIsReasoningModel(...args)
}))

vi.mock('@renderer/utils/assistant', () => ({
  isSupportedToolUse: (...args: unknown[]) => mockIsSupportedToolUse(...args)
}))

vi.mock('@renderer/components/composer/tools/components/KnowledgeBaseButton', () => ({
  KnowledgeBaseToolRuntime: () => null
}))

vi.mock('@renderer/components/composer/tools/components/ThinkingButton', () => ({
  ThinkingToolRuntime: () => null
}))

vi.mock('@renderer/components/composer/tools/components/QuickPhrasesButton', () => ({
  QuickPhrasesToolRuntime: () => null
}))

vi.mock('@renderer/components/composer/tools/components/WebSearchButton', () => ({
  WebSearchToolRuntime: () => null
}))

vi.mock('@renderer/hooks/agent/useAgent', () => ({
  useAgent: () => ({ agent: undefined })
}))

vi.mock('@renderer/hooks/useMcpRuntimeStatus', () => ({
  useMcpRuntimeStatusMap: () => ({})
}))

vi.mock('@renderer/hooks/useMcpServer', () => ({
  useMcpServers: () => ({ mcpServers: [] })
}))

describe('composer tool visibility', () => {
  it('keeps assistant core capabilities discoverable when the current model cannot enable them', () => {
    mockIsGenerateImageModel.mockReturnValue(false)
    mockIsReasoningModel.mockReturnValue(false)
    mockIsSupportedToolUse.mockReturnValue(false)

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

  it('shows MCP status in chat and agent session scopes only', () => {
    const model = {
      id: 'text-only',
      providerId: 'provider-1',
      name: 'Text only'
    } as any

    expect(getToolsForScope(TopicType.Chat, { model }).map((tool) => tool.key)).toContain('mcp_status')
    expect(getToolsForScope(TopicType.Session, { model }).map((tool) => tool.key)).toContain('mcp_status')
    expect(getToolsForScope('quick-assistant', { model }).map((tool) => tool.key)).not.toContain('mcp_status')
  })

  it('replaces the thinking slash-board item with the Work speed control for Codex and Claude Code', () => {
    for (const providerId of ['openai-codex', 'claude-code']) {
      const tools = getToolsForScope(TopicType.Session, {
        model: { id: 'model', providerId, name: 'Model' } as any
      })

      expect(tools.map((tool) => tool.key)).not.toContain('thinking')
    }
  })
})
