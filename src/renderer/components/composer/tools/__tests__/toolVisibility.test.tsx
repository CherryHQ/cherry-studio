import { describe, expect, it, vi } from 'vitest'

import { getToolsForScope } from '@renderer/components/composer/tools/builtinTools'
import { TopicType } from '@renderer/components/composer/tools/types'

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
  it('offers local attachments, native commands, and Cherry composer operations for local sessions', () => {
    const tools = getToolsForScope(TopicType.Session, { session: { agentId: 'local', agentType: 'local' } }).map(
      (tool) => tool.key
    )
    expect(tools).toContain('attachment')
    expect(tools).toContain('dictation')
    expect(tools).toContain('knowledge_base')
    expect(tools).toContain('mcp_status')
    expect(tools).toContain('mcp_prompts')
    expect(tools).toContain('mcp_resources')
    expect(tools).toContain('note-reference')
    expect(tools).not.toContain('permission_mode')
    expect(tools).toContain('slash_commands')
  })

  it.each(['pi', 'claude-code'])('keeps Cherry permission controls available to the %s runtime', (agentType) => {
    const tools = getToolsForScope(TopicType.Session, { session: { agentId: 'agent', agentType } })
    expect(tools.map((tool) => tool.key)).toContain('permission_mode')
  })
})
