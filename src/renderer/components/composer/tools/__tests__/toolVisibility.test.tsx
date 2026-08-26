import { getToolsForScope } from '@renderer/components/composer/tools/builtinTools'
import { getComposerToolbarManifestsForScope } from '@renderer/components/composer/tools/toolbarManifests'
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

    expect(tools.map((tool) => tool.key)).toEqual(expect.arrayContaining(['generate_image', 'knowledge_base']))
  })

  it('inherits chat tools and toolbar manifests in the quick assistant scope', () => {
    const model = {
      id: 'text-only',
      providerId: 'provider-1',
      name: 'Text only'
    } as any
    const quickAssistantToolKeys = getToolsForScope('quick-assistant', { model }).map((tool) => tool.key)
    const quickAssistantToolbarIds = getComposerToolbarManifestsForScope(
      'quick-assistant',
      ((key: string) => key) as any
    ).map((manifest) => manifest.id)

    expect(quickAssistantToolKeys).toEqual(expect.arrayContaining(['web_search', 'knowledge_base', 'mcp_status']))
    expect(quickAssistantToolbarIds).toEqual(expect.arrayContaining(['web-search', 'knowledge-base', 'screenshot']))
    expect(quickAssistantToolbarIds).not.toContain('permission-mode')
  })

  it('makes knowledge selection discoverable in Agent Session scope', () => {
    const tools = getToolsForScope(TopicType.Session, {
      model: { id: 'agent-model', providerId: 'provider-1', name: 'Agent model' } as any,
      session: { agentId: 'agent-1', knowledgeBaseIds: [] }
    })

    expect(tools.map((tool) => tool.key)).toContain('knowledge_base')
  })
})
