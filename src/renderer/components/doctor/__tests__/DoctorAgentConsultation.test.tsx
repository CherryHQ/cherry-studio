import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Model } from '@shared/data/types/model'
import { aiErrorCodes } from '@shared/ipc/errors/ai'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { DoctorAgentState } from '@shared/types/doctorAgent'

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  cancel: vi.fn(),
  actionError: null as string | null,
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
    actionError: mocks.actionError,
    start: mocks.start,
    cancel: mocks.cancel,
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
  mocks.actionError = null
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

  it('discloses an operation error context instead of a conversation, and keeps the model picker', async () => {
    const user = userEvent.setup()
    const { unmount } = render(
      <DoctorAgentConsultation
        subject={{ kind: 'operation', operationId: 'voice-1' }}
        incident={{
          kind: 'operation',
          context: {
            id: 'voice-1',
            occurredAt: '2026-10-19T00:00:00.000Z',
            source: 'voice',
            operation: 'voice.speech.preview',
            message: 'Preview preparation failed'
          }
        }}
        open
        onOpenChange={vi.fn()}
      />
    )

    expect(screen.getByText('settings.doctor.agent.operation_incident_disclosure')).toBeInTheDocument()
    expect(screen.queryByText('settings.doctor.agent.incident_disclosure')).not.toBeInTheDocument()
    const model = screen.getByRole('combobox', { name: 'model' })
    expect(model).toHaveValue('openai::gpt-5')
    await user.selectOptions(model, 'deepseek::v3')
    expect(model).toHaveValue('deepseek::v3')
    expect(screen.getByRole('button', { name: 'settings.doctor.agent.actions.start' })).toBeEnabled()
    unmount()

    const conversation = render(
      <DoctorAgentConsultation
        subject={{ kind: 'global' }}
        incident={{ topicId: 'topic-1', messageId: 'msg-1' }}
        open
        onOpenChange={vi.fn()}
      />
    )
    expect(screen.getByText('settings.doctor.agent.incident_disclosure')).toBeInTheDocument()
    expect(screen.queryByText('settings.doctor.agent.operation_incident_disclosure')).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'model' })).toHaveValue('openai::gpt-5')
    expect(screen.getByRole('button', { name: 'settings.doctor.agent.actions.start' })).toBeEnabled()

    conversation.rerender(<DoctorAgentConsultation subject={{ kind: 'global' }} open onOpenChange={vi.fn()} />)
    expect(screen.queryByText('settings.doctor.agent.incident_disclosure')).not.toBeInTheDocument()
    expect(screen.queryByText('settings.doctor.agent.operation_incident_disclosure')).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'model' })).toHaveValue('openai::gpt-5')
    expect(screen.getByRole('button', { name: 'settings.doctor.agent.actions.start' })).toBeEnabled()
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

  it('explains a failed analysis without replacing the model text or opening details', () => {
    mocks.agentState = {
      status: 'failed',
      error: 'unknown error',
      runId: 'run-1',
      scope: 'global',
      reportRunId: 'report-1',
      sessionId: 's',
      modelId: 'deepseek::v3',
      startedAt: '',
      text: 'Proxy is misconfigured.',
      toolCalls: ['read_logs'],
      proposals: [
        {
          id: 'p1',
          status: 'rejected',
          error: 'report superseded',
          summary: 'Enable the proxy.',
          write: { kind: 'preference_set', key: 'proxy.enabled', value: true }
        },
        {
          id: 'p2',
          status: 'failed',
          error: 'disk full',
          summary: 'Clear the cache.',
          write: { kind: 'preference_set', key: 'cache.enabled', value: false }
        }
      ],
      changes: []
    }
    render(<DoctorAgentConsultation subject={{ kind: 'global' }} open onOpenChange={vi.fn()} />)

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('settings.doctor.agent.messages.run_failed')
    expect(alert).not.toHaveTextContent('unknown error')
    expect(screen.getByTestId('markdown')).toHaveTextContent('Proxy is misconfigured.')
    expect(screen.queryByText('read_logs')).not.toBeInTheDocument()
    expect(screen.getByText('Enable the proxy.')).toBeInTheDocument()
    expect(screen.getByText('settings.doctor.agent.messages.report_superseded')).toBeInTheDocument()
    expect(screen.queryByText('report superseded')).not.toBeInTheDocument()
    expect(screen.getByText('Clear the cache.')).toBeInTheDocument()
    expect(screen.getByText('settings.doctor.agent.messages.proposal_failed')).toBeInTheDocument()
    expect(screen.getByText('disk full')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'error.details' })).not.toBeInTheDocument()
  })

  it('keeps a real analysis failure as technical detail under the translated explanation', () => {
    mocks.agentState = {
      status: 'failed',
      error: 'database locked',
      runId: 'run-1',
      scope: 'global',
      reportRunId: 'report-1',
      sessionId: 's',
      modelId: 'deepseek::v3',
      startedAt: '',
      text: '',
      toolCalls: [],
      proposals: [],
      changes: []
    }
    render(<DoctorAgentConsultation subject={{ kind: 'global' }} open onOpenChange={vi.fn()} />)

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('settings.doctor.agent.messages.run_failed')
    expect(alert).toHaveTextContent('database locked')
  })

  it('localizes each service-owned analysis failure and still shows an external cause', () => {
    const base = {
      runId: 'run-1',
      scope: 'global' as const,
      reportRunId: 'report-1',
      sessionId: 's',
      modelId: 'deepseek::v3',
      startedAt: '',
      text: '',
      toolCalls: [],
      proposals: [],
      changes: []
    }
    const { rerender } = render(<DoctorAgentConsultation subject={{ kind: 'global' }} open onOpenChange={vi.fn()} />)
    const show = (state: DoctorAgentState) => {
      mocks.agentState = state
      rerender(<DoctorAgentConsultation subject={{ kind: 'global' }} open onOpenChange={vi.fn()} />)
    }

    show({
      status: 'failed',
      error: 'not started: busy',
      errorSource: 'service',
      ownedFailure: { kind: 'not_started', reason: 'busy' },
      ...base
    })
    expect(screen.getByText('settings.doctor.agent.messages.not_started_busy')).toBeInTheDocument()
    expect(screen.queryByText('not started: busy')).not.toBeInTheDocument()

    show({
      status: 'failed',
      error: 'not started: session-invalid',
      errorSource: 'service',
      ownedFailure: { kind: 'not_started', reason: 'session-invalid' },
      ...base
    })
    expect(screen.getByText('settings.doctor.agent.messages.not_started_session_invalid')).toBeInTheDocument()
    expect(screen.queryByText('not started: session-invalid')).not.toBeInTheDocument()

    show({
      status: 'failed',
      error: 'Execution failed',
      errorSource: 'service',
      ownedFailure: { kind: 'execution_failed' },
      ...base
    })
    expect(screen.getByText('settings.doctor.agent.messages.execution_failed')).toBeInTheDocument()
    expect(screen.queryByText('Execution failed')).not.toBeInTheDocument()

    show({ status: 'failed', error: 'Execution failed', errorSource: 'external', ...base })
    expect(screen.getByText('Execution failed')).toBeInTheDocument()
    expect(screen.queryByText('settings.doctor.agent.messages.execution_failed')).not.toBeInTheDocument()

    show({ status: 'failed', error: 'not started: busy', errorSource: 'external', ...base })
    expect(screen.getByText('not started: busy')).toBeInTheDocument()
    expect(screen.queryByText('settings.doctor.agent.messages.not_started_busy')).not.toBeInTheDocument()

    show({
      status: 'failed',
      error: 'not started: session-invalid',
      ...base,
      proposals: [
        {
          id: 'p1',
          status: 'failed',
          error: 'unknown error',
          errorSource: 'external',
          summary: 'Clear the cache.',
          write: { kind: 'preference_set', key: 'cache.enabled', value: false }
        }
      ]
    })
    expect(screen.getByText('settings.doctor.agent.messages.not_started_session_invalid')).toBeInTheDocument()
    expect(screen.queryByText('not started: session-invalid')).not.toBeInTheDocument()
    expect(screen.getByText('unknown error')).toBeInTheDocument()
  })

  it('shows a start failure in the model picker and keeps start usable', () => {
    mocks.actionError = 'settings.doctor.agent.messages.start_failed'
    render(<DoctorAgentConsultation subject={{ kind: 'global' }} open onOpenChange={vi.fn()} />)

    expect(screen.getByRole('alert')).toHaveTextContent('settings.doctor.agent.messages.start_failed')
    expect(screen.getByRole('button', { name: 'settings.doctor.agent.actions.start' })).toBeEnabled()
  })

  it('shows an apply failure on the completed analysis and keeps restart usable', () => {
    mocks.actionError = 'settings.doctor.agent.messages.apply_failed'
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

    expect(screen.getByRole('alert')).toHaveTextContent('settings.doctor.agent.messages.apply_failed')
    expect(screen.getByRole('button', { name: 'settings.doctor.agent.actions.restart' })).toBeEnabled()
  })

  it('shows a cancel failure while the analysis is running and keeps cancel usable', async () => {
    const user = userEvent.setup()
    mocks.actionError = 'settings.doctor.messages.cancel_failed'
    mocks.agentState = {
      status: 'running',
      runId: 'run-1',
      scope: 'global',
      reportRunId: 'report-1',
      sessionId: 's',
      modelId: 'deepseek::v3',
      startedAt: '',
      text: '',
      toolCalls: [],
      proposals: [],
      changes: []
    }
    render(<DoctorAgentConsultation subject={{ kind: 'global' }} open onOpenChange={vi.fn()} />)

    expect(screen.getByRole('alert')).toHaveTextContent('settings.doctor.messages.cancel_failed')
    const cancel = screen.getByRole('button', { name: 'settings.doctor.agent.actions.cancel' })
    expect(cancel).toBeEnabled()
    await user.click(cancel)
    expect(mocks.cancel).toHaveBeenCalledOnce()
  })
})
