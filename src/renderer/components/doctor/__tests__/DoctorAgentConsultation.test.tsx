import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Model } from '@shared/data/types/model'
import { aiErrorCodes } from '@shared/ipc/errors/ai'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { DoctorAgentState } from '@shared/types/doctorAgent'

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  checkDoctorAgentModel: vi.fn(),
  openSettings: vi.fn(),
  defaultModelId: 'openai::gpt-5',
  agentState: { status: 'idle' } as DoctorAgentState,
  doctorState: { status: 'completed', report: { runId: 'report-1' } } as unknown,
  modelsLoading: false,
  providersLoading: false,
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
vi.mock('@renderer/hooks/useProvider', () => ({
  useProviders: () => ({ providers: mocks.providers, isLoading: mocks.providersLoading })
}))
vi.mock('@renderer/hooks/useModel', () => ({
  useModels: () => ({ models: mocks.models, isLoading: mocks.modelsLoading })
}))
vi.mock('@renderer/services/mainWindowNavigation', () => ({ openSettingsTab: mocks.openSettings }))
vi.mock('@renderer/services/modelHealthCheck', () => ({
  checkDoctorAgentModel: mocks.checkDoctorAgentModel,
  healthCheckErrorToDisplayString: (error: { message?: string | null; name?: string | null } | string) =>
    typeof error === 'string' ? error : (error.message ?? error.name ?? '')
}))
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
  mocks.checkDoctorAgentModel.mockReset()
  mocks.agentState = { status: 'idle' }
  mocks.defaultModelId = 'openai::gpt-5'
  mocks.modelsLoading = false
  mocks.providersLoading = false
  mocks.checkDoctorAgentModel.mockResolvedValue({ latency: 42 })
})

describe('DoctorAgentConsultation', () => {
  it('checks and starts only after the user clicks start', async () => {
    const user = userEvent.setup()
    render(<DoctorAgentConsultation subject={{ kind: 'global' }} open onOpenChange={vi.fn()} />)

    const select = screen.getByRole('combobox', { name: 'model' })
    expect(Array.from((select as HTMLSelectElement).options).map((option) => option.value)).toEqual([
      '',
      'deepseek::v3',
      'openai::gpt-5'
    ])
    expect(select).toHaveValue('openai::gpt-5')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(mocks.checkDoctorAgentModel).not.toHaveBeenCalled()
    expect(mocks.start).not.toHaveBeenCalled()

    const start = screen.getByRole('button', { name: 'settings.doctor.agent.actions.start' })
    expect(start).toBeEnabled()
    await user.click(start)

    expect(mocks.checkDoctorAgentModel).toHaveBeenCalledOnce()
    expect(mocks.checkDoctorAgentModel).toHaveBeenCalledWith('openai::gpt-5')
    await waitFor(() => expect(mocks.start).toHaveBeenCalledWith('openai::gpt-5'))
  })

  it('keeps start disabled while the requested model check is pending', async () => {
    const user = userEvent.setup()
    let resolveCheck!: (value: { latency: number }) => void
    mocks.checkDoctorAgentModel.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCheck = resolve
      })
    )
    render(<DoctorAgentConsultation subject={{ kind: 'global' }} open onOpenChange={vi.fn()} />)

    const start = screen.getByRole('button', { name: 'settings.doctor.agent.actions.start' })
    expect(start).toBeEnabled()
    await user.click(start)
    expect(mocks.checkDoctorAgentModel).toHaveBeenCalledWith('openai::gpt-5')
    expect(start).toBeDisabled()
    expect(mocks.start).not.toHaveBeenCalled()

    await act(async () => resolveCheck({ latency: 17 }))
    await waitFor(() => expect(mocks.start).toHaveBeenCalledWith('openai::gpt-5'))
  })

  it('shows an actionable inline error for an empty IpcError and allows retry', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const error = new Error('')
    error.name = 'IpcError'
    mocks.checkDoctorAgentModel.mockRejectedValueOnce(error)
    render(<DoctorAgentConsultation subject={{ kind: 'global' }} open onOpenChange={onOpenChange} />)

    const start = screen.getByRole('button', { name: 'settings.doctor.agent.actions.start' })
    expect(mocks.checkDoctorAgentModel).not.toHaveBeenCalled()
    await user.click(start)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('settings.doctor.agent.model_picker.check_failed')
    expect(alert).not.toHaveTextContent('IpcError')
    const configure = screen.getByRole('button', { name: 'common.go_to_settings' })
    expect(start).toBeEnabled()
    expect(mocks.start).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()

    await user.click(configure)
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(mocks.openSettings).toHaveBeenCalledWith('/settings/provider?id=openai')
  })

  it('shows an authentication message for a 401 provider failure', async () => {
    const user = userEvent.setup()
    mocks.checkDoctorAgentModel.mockRejectedValueOnce(
      new IpcError(aiErrorCodes.AI_REQUEST_FAILED, '', {
        name: 'AI_APICallError',
        message: null,
        stack: null,
        providerErrorCategory: 'auth',
        statusCode: 401
      })
    )

    render(<DoctorAgentConsultation subject={{ kind: 'global' }} open onOpenChange={vi.fn()} />)

    expect(mocks.checkDoctorAgentModel).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'settings.doctor.agent.actions.start' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('error.diagnosis.auth')
    expect(alert).not.toHaveTextContent('IpcError')
    expect(alert).not.toHaveTextContent('AI_APICallError')
    const configure = screen.getByRole('button', { name: 'common.go_to_settings' })
    await user.click(configure)
    expect(mocks.openSettings).toHaveBeenCalledWith('/settings/provider?id=openai')
  })

  it('retries a failed check and starts immediately after it passes', async () => {
    const user = userEvent.setup()
    mocks.checkDoctorAgentModel
      .mockRejectedValueOnce(new Error('Model unavailable'))
      .mockResolvedValueOnce({ latency: 42 })
    render(<DoctorAgentConsultation subject={{ kind: 'global' }} open onOpenChange={vi.fn()} />)

    const start = screen.getByRole('button', { name: 'settings.doctor.agent.actions.start' })
    await user.click(start)
    expect(await screen.findByRole('alert')).toHaveTextContent('error.diagnosis.model')
    expect(start).toBeEnabled()
    expect(mocks.start).not.toHaveBeenCalled()

    await user.click(start)
    expect(mocks.checkDoctorAgentModel).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    await waitFor(() => expect(mocks.start).toHaveBeenCalledWith('openai::gpt-5'))
  })

  it('clears a failed check when the selected model changes without checking the new model', async () => {
    const user = userEvent.setup()
    mocks.checkDoctorAgentModel.mockRejectedValueOnce(new Error('Invalid API key'))
    render(<DoctorAgentConsultation subject={{ kind: 'global' }} open onOpenChange={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'settings.doctor.agent.actions.start' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('error.diagnosis.auth')
    await user.selectOptions(screen.getByRole('combobox', { name: 'model' }), 'deepseek::v3')

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(mocks.checkDoctorAgentModel).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'settings.doctor.agent.actions.start' })).toBeEnabled()
  })

  it('does not check while model or provider data is loading', () => {
    mocks.modelsLoading = true
    const { rerender } = render(<DoctorAgentConsultation subject={{ kind: 'global' }} open onOpenChange={vi.fn()} />)

    expect(mocks.checkDoctorAgentModel).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'settings.doctor.agent.actions.start' })).toBeDisabled()

    mocks.modelsLoading = false
    mocks.providersLoading = true
    rerender(<DoctorAgentConsultation subject={{ kind: 'global' }} open onOpenChange={vi.fn()} />)

    expect(mocks.checkDoctorAgentModel).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'settings.doctor.agent.actions.start' })).toBeDisabled()
  })

  it('does not check or show check UI without a usable model', () => {
    mocks.defaultModelId = 'disabled-provider::x'
    render(<DoctorAgentConsultation subject={{ kind: 'global' }} open onOpenChange={vi.fn()} />)
    expect(screen.getByRole('combobox', { name: 'model' })).toHaveValue('')
    expect(mocks.checkDoctorAgentModel).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'settings.doctor.agent.actions.start' })).toBeDisabled()
  })

  it('tells the user the conversation is sent to the model only when the analysis reads one', () => {
    const { rerender } = render(
      <DoctorAgentConsultation
        subject={{ kind: 'global' }}
        incident={{ topicId: 'topic-1', messageId: 'msg-1' }}
        open
        onOpenChange={vi.fn()}
      />
    )
    expect(screen.getByText('settings.doctor.agent.incident_disclosure')).toBeInTheDocument()
    rerender(<DoctorAgentConsultation subject={{ kind: 'global' }} open onOpenChange={vi.fn()} />)
    expect(screen.queryByText('settings.doctor.agent.incident_disclosure')).not.toBeInTheDocument()
  })

  it('shows the last analysis instead of the picker when one exists for this report', () => {
    mocks.agentState = {
      status: 'completed',
      runId: 'run-1',
      scope: 'global',
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
