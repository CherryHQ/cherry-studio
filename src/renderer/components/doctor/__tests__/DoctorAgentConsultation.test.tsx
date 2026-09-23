import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Model } from '@shared/data/types/model'
import type { DoctorAgentState } from '@shared/types/doctorAgent'

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  defaultModelId: 'openai::gpt-5',
  agentState: { status: 'idle' } as DoctorAgentState,
  doctorState: { status: 'completed', report: { runId: 'report-1' } } as unknown,
  providers: [
    { id: 'openai', name: 'OpenAI', isEnabled: true },
    { id: 'deepseek', name: 'DeepSeek', isEnabled: true },
    { id: 'disabled-provider', name: 'Disabled', isEnabled: false }
  ],
  models: [
    { id: 'deepseek::v3', providerId: 'deepseek', name: 'DeepSeek V3', capabilities: [] },
    { id: 'openai::gpt-5', providerId: 'openai', name: 'GPT-5', capabilities: [] },
    { id: 'openai::tts-1', providerId: 'openai', name: 'TTS', capabilities: ['audio-generation'] },
    { id: 'disabled-provider::x', providerId: 'disabled-provider', name: 'Hidden', capabilities: [] }
  ] as unknown as Model[]
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
vi.mock('@renderer/data/hooks/usePreference', () => ({ usePreference: () => [mocks.defaultModelId, vi.fn()] }))
vi.mock('@renderer/hooks/useProvider', () => ({ useProviders: () => ({ providers: mocks.providers }) }))
vi.mock('@renderer/hooks/useModel', () => ({ useModels: () => ({ models: mocks.models }) }))
// The real selector is a popover with its own tests; here it is a select so the filter and the choice can be checked.
vi.mock('@renderer/components/DefaultModelSelector', () => ({
  DefaultModelSelector: ({
    model,
    filter,
    onSelect
  }: {
    model?: Model
    filter: (model: Model, provider?: { id: string; name: string; isEnabled: boolean }) => boolean
    onSelect: (model: Model | undefined) => void
  }) => {
    const providers = mocks.providers
    const options = mocks.models.filter((candidate) =>
      filter(
        candidate,
        providers.find((provider) => provider.id === candidate.providerId)
      )
    )
    return (
      <select
        aria-label="model"
        value={model?.id ?? ''}
        onChange={(event) => onSelect(options.find((candidate) => candidate.id === event.target.value))}>
        <option value="" />
        {options.map((candidate) => (
          <option key={candidate.id} value={candidate.id}>
            {candidate.name}
          </option>
        ))}
      </select>
    )
  }
}))
vi.mock('@renderer/components/markdown', () => ({
  StaticMarkdown: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

import { DoctorAgentConsultation } from '../DoctorAgentConsultation'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.agentState = { status: 'idle' }
  mocks.defaultModelId = 'openai::gpt-5'
})

describe('DoctorAgentConsultation', () => {
  it('offers only chat models of enabled providers, preselects the default, and starts on the chosen one', async () => {
    const user = userEvent.setup()
    render(<DoctorAgentConsultation subject={{ kind: 'global' }} open onOpenChange={vi.fn()} />)

    const select = screen.getByRole('combobox', { name: 'model' })
    expect(Array.from((select as HTMLSelectElement).options).map((option) => option.value)).toEqual([
      '',
      'deepseek::v3',
      'openai::gpt-5'
    ])
    expect(select).toHaveValue('openai::gpt-5')

    await user.selectOptions(select, 'deepseek::v3')
    await user.click(screen.getByRole('button', { name: 'settings.doctor.agent.actions.start' }))
    expect(mocks.start).toHaveBeenCalledWith('deepseek::v3')
  })

  it('does not preselect a default model the availability filter rejects', () => {
    mocks.defaultModelId = 'disabled-provider::x'
    render(<DoctorAgentConsultation subject={{ kind: 'global' }} open onOpenChange={vi.fn()} />)
    expect(screen.getByRole('combobox', { name: 'model' })).toHaveValue('')
    expect(screen.getByRole('button', { name: 'settings.doctor.agent.actions.start' })).toBeDisabled()
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
    render(<DoctorAgentConsultation subject={{ kind: 'global' }} open onOpenChange={vi.fn()} />)
    expect(screen.getByTestId('markdown')).toHaveTextContent('Proxy is misconfigured.')
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'settings.doctor.agent.actions.restart' })).toBeInTheDocument()
  })
})
