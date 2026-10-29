import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComposerSurfaceProps } from '@renderer/components/composer/ComposerSurface'
import type { ComposerSerializedDraft } from '@renderer/components/composer/tokens'
import { useComposerToolProviderLaunchers } from '@renderer/components/composer/tools/ComposerToolProvider'
import type { AgentWorkspaceEntity } from '@shared/data/api/schemas/agentWorkspaces'

const mocks = vi.hoisted(() => ({
  surface: null as ComposerSurfaceProps | null,
  openSettingsTab: vi.fn(),
  agents: [] as Array<{
    id: string
    name: string
    type: string
    model: string | null
    modelName: string | null
    configuration: object
  }>
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) => (options?.app ? `${key}:${options.app}` : key)
  })
}))
vi.mock('@data/hooks/usePreference', () => ({ usePreference: () => [undefined] }))
vi.mock('@renderer/utils/platform', async (importOriginal) => ({ ...(await importOriginal<object>()), isMac: true }))
// The real surface throws outside a tool provider, so the stand-in requires one too.
vi.mock('@renderer/components/composer/ComposerSurface', () => ({
  default: function ComposerSurfaceStandIn(props: ComposerSurfaceProps) {
    useComposerToolProviderLaunchers()
    mocks.surface = props
    return <div>{props.renderLeftControls?.()}</div>
  }
}))
vi.mock('@renderer/hooks/agent/useAgent', () => ({ useAgents: () => ({ agents: mocks.agents, isLoading: false }) }))
vi.mock('@renderer/pages/agents/useClaudeCodeBinary', () => ({
  useClaudeCodeBinary: () => ({ status: { phase: 'ready' }, blocked: false, retry: () => undefined })
}))
vi.mock('@renderer/services/mainWindowNavigation', () => ({ openSettingsTab: mocks.openSettingsTab }))

const { SelectionAgentComposeBar } = await import('../SelectionAgentComposeBar')

const CHERRY = {
  id: 'cherry',
  name: 'Cherry Assistant',
  type: 'claude-code',
  model: 'openai::gpt-5',
  modelName: 'GPT-5',
  configuration: { builtin_role: 'assistant' }
}
const DOCS: AgentWorkspaceEntity = {
  id: 'ws-1',
  name: 'Docs',
  path: '/work/docs',
  type: 'user',
  orderKey: 'a0',
  createdAt: '2026-10-28T00:00:00.000Z',
  updatedAt: '2026-10-28T00:00:00.000Z'
}

function renderBar(props: Partial<Parameters<typeof SelectionAgentComposeBar>[0]> = {}) {
  const onSend = vi.fn()
  render(
    <SelectionAgentComposeBar
      selectedText="ubiquity"
      programName="Chrome"
      target={{ agentId: null, workspace: { type: 'system' } }}
      sending={false}
      error={null}
      onSend={onSend}
      {...props}
    />
  )
  return { onSend }
}

describe('SelectionAgentComposeBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockUseDataApiUtils.resetMocks()
    MockUseDataApiUtils.mockQueryData('/agent-workspaces', [])
    mocks.agents = [CHERRY]
    mocks.surface = null
  })

  it('sends the selection as a leading quote naming its source app, ahead of the instruction', () => {
    const { onSend } = renderBar()
    const link = { id: 'l', kind: 'link' as const, label: 'docs', promptText: 'https://x.dev', index: 0, textOffset: 4 }

    act(() => void mocks.surface?.onSendDraft({ text: 'See https://x.dev', tokens: [link] }))

    const [draft] = onSend.mock.calls[0] as [ComposerSerializedDraft]
    const [quote, shifted] = draft.tokens
    expect(quote).toMatchObject({ kind: 'quote', description: 'ubiquity', index: 0, textOffset: 0 })
    expect(quote.promptText).toContain('ubiquity')
    expect(quote.promptText?.endsWith('\nselection.agent.source:Chrome')).toBe(true)
    expect(draft.text).toBe(`${quote.promptText}\nSee https://x.dev`)
    expect(draft.text.slice(shifted.textOffset).startsWith('https://x.dev')).toBe(true)
    expect(shifted.index).toBe(1)
  })

  it('sends only the instruction once the quote is removed', () => {
    const { onSend } = renderBar()
    const draft = { text: 'Explain', tokens: [] }

    fireEvent.click(screen.getByRole('button', { name: 'common.delete' }))
    act(() => void mocks.surface?.onSendDraft(draft))

    expect(onSend).toHaveBeenCalledWith(draft)
    expect(screen.queryByText('ubiquity')).not.toBeInTheDocument()
  })

  it.each([
    ['ubiquity', 'Chrome · selection.agent.char_count'],
    ['line one\nline two\nline three', 'Chrome · selection.agent.line_count']
  ])('sizes the selection %j by lines when it spans several, by characters otherwise', (selectedText, meta) => {
    renderBar({ selectedText })

    expect(screen.getByText(meta)).toBeInTheDocument()
  })

  it('names the bound agent and work directory, and opens the selection settings to change them', () => {
    MockUseDataApiUtils.mockQueryData('/agent-workspaces', [DOCS])
    renderBar({ target: { agentId: 'cherry', workspace: { type: 'user', workspaceId: 'ws-1' } } })

    fireEvent.click(screen.getByRole('button', { name: /Cherry Assistant/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Docs' }))

    expect(mocks.openSettingsTab.mock.calls).toEqual([
      ['/settings/selection-assistant'],
      ['/settings/selection-assistant']
    ])
  })

  it('blocks sending and names the cause when the bound agent has no usable model', () => {
    mocks.agents = [CHERRY, { ...CHERRY, id: 'dev', name: 'Dev', modelName: null, configuration: {} }]
    renderBar({ target: { agentId: 'dev', workspace: { type: 'system' } } })

    expect(mocks.surface?.sendDisabled).toBe(true)
    expect(screen.getByText('selection.settings.agent_issue.no_model')).toBeInTheDocument()
  })

  it('keeps sending available while Cherry Assistant is missing, since sending recreates it', () => {
    mocks.agents = []
    renderBar()

    expect(mocks.surface?.sendDisabled).toBe(false)
  })

  it('blocks sending when the chosen work directory no longer exists', () => {
    renderBar({ target: { agentId: null, workspace: { type: 'user', workspaceId: 'gone' } } })

    expect(mocks.surface?.sendDisabled).toBe(true)
    expect(screen.getByText('selection.agent.workspace_unavailable')).toBeInTheDocument()
    expect(screen.getByText('selection.agent.workspace_unavailable_hint')).toBeInTheDocument()
  })
})
