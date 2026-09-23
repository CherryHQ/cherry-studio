import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DoctorAgentState } from '@shared/types/doctorAgent'

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  agentState: { status: 'idle' } as DoctorAgentState,
  doctorState: { status: 'completed', report: { runId: 'report-1' } } as unknown,
  openSettingsTab: vi.fn()
}))

vi.mock('@data/hooks/useCache', () => ({
  useSharedCacheValue: (key: string) => (key.startsWith('doctor.state.') ? mocks.doctorState : mocks.agentState)
}))
vi.mock('@renderer/hooks/doctor', () => ({
  useDoctorAgent: () => ({
    state: mocks.agentState,
    isStale: false,
    busy: null,
    start: mocks.start,
    cancel: vi.fn(),
    apply: vi.fn(),
    undo: vi.fn()
  })
}))
vi.mock('@renderer/data/hooks/usePreference', () => ({ usePreference: () => ['openai::gpt-5', vi.fn()] }))
vi.mock('@renderer/hooks/useProvider', () => ({
  useProviders: () => ({
    providers: [
      { id: 'openai', name: 'OpenAI', isEnabled: true },
      { id: 'deepseek', name: 'DeepSeek', isEnabled: true },
      { id: 'disabled-provider', name: 'Disabled', isEnabled: false }
    ]
  })
}))
vi.mock('@renderer/hooks/useModel', () => ({
  useModels: () => ({
    models: [
      { id: 'deepseek::v3', providerId: 'deepseek', name: 'DeepSeek V3', capabilities: [] },
      { id: 'openai::gpt-5', providerId: 'openai', name: 'GPT-5', capabilities: [] },
      { id: 'openai::tts-1', providerId: 'openai', name: 'TTS', capabilities: ['audio-generation'] },
      { id: 'disabled-provider::x', providerId: 'disabled-provider', name: 'Hidden', capabilities: [] }
    ]
  })
}))
vi.mock('@renderer/services/mainWindowNavigation', () => ({ openSettingsTab: mocks.openSettingsTab }))
// jsdom has no layout, so the virtualizer would render nothing; render every row instead.
vi.mock('@renderer/components/VirtualList', () => ({
  DynamicVirtualList: <T,>({ list, children }: { list: T[]; children: (item: T, index: number) => ReactNode }) => (
    <>{list.map((item, index) => children(item, index))}</>
  )
}))
vi.mock('@renderer/components/markdown', () => ({
  StaticMarkdown: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

import { DoctorAgentDialog } from '../DoctorAgentDialog'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.agentState = { status: 'idle' }
})

describe('DoctorAgentDialog', () => {
  it('offers only chat models of enabled providers, default first, and starts on the chosen one', async () => {
    const user = userEvent.setup()
    render(<DoctorAgentDialog subject={{ kind: 'global' }} open onOpenChange={vi.fn()} />)

    const options = screen.getAllByRole('radio')
    expect(options.map((option) => option.getAttribute('value'))).toEqual(['openai::gpt-5', 'deepseek::v3'])
    expect(screen.queryByText('TTS')).not.toBeInTheDocument()
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument()

    await user.click(screen.getByLabelText(/DeepSeek V3/))
    await user.click(screen.getByRole('button', { name: 'settings.doctor.agent.actions.start' }))
    expect(mocks.start).toHaveBeenCalledWith('deepseek::v3')
  })

  it('shows the last analysis instead of the picker when one exists for this report', () => {
    mocks.agentState = {
      status: 'completed',
      runId: 'run-1',
      reportRunId: 'report-1',
      sessionId: 's',
      modelId: 'deepseek::v3',
      startedAt: '',
      text: 'Proxy is misconfigured.',
      toolCalls: [],
      proposals: [],
      changes: []
    }
    render(<DoctorAgentDialog subject={{ kind: 'global' }} open onOpenChange={vi.fn()} />)
    expect(screen.getByTestId('markdown')).toHaveTextContent('Proxy is misconfigured.')
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'settings.doctor.agent.actions.restart' })).toBeInTheDocument()
  })
})
