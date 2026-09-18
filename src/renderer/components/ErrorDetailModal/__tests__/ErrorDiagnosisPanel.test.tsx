import '@testing-library/jest-dom/vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type * as ReactI18next from 'react-i18next'
import { describe, expect, it, vi } from 'vitest'

import type { DoctorController } from '@renderer/hooks/doctor'
import { buildDoctorViewModel } from '@renderer/utils/doctor'
import type { DoctorCheckResult, DoctorPendingCheck, DoctorState, DoctorSubjectRef } from '@shared/types/doctor'

vi.unmock('@cherrystudio/ui')

const translations: Record<string, string> = {
  'error.diagnostics.diagnosing': 'Diagnosing',
  'error.diagnostics.result': 'Diagnostic result',
  'settings.doctor.actions.rerun': 'Run checks again',
  'settings.doctor.actions.confirm_check': 'Send test message',
  'settings.doctor.actions.open_provider': 'Open provider settings',
  'settings.doctor.actions.run_network': 'Full check',
  'settings.doctor.checks.provider-api-key-present.detail.missing': '{{provider}} has no enabled API key.',
  'settings.doctor.checks.provider-api-key-present.title': 'Provider API key',
  'settings.doctor.checks.provider-model-conversation.confirmation': 'Send one short test message?',
  'settings.doctor.checks.network-model-endpoint.title': 'Selected model endpoint',
  'settings.doctor.checks.provider-model-conversation.title': 'Model conversation',
  'settings.doctor.checks.provider-model-list.title': 'Remote model availability',
  'settings.doctor.empty.canceled_description': 'The diagnostic run was canceled before it finished.',
  'settings.doctor.empty.canceled_title': 'Diagnosis canceled',
  'settings.doctor.empty.failed_description': 'The diagnostic run could not be completed.',
  'settings.doctor.empty.failed_title': 'Diagnosis failed',
  'settings.doctor.status.pending': 'Pending',
  'settings.doctor.status.fail': 'Failed',
  'settings.doctor.status.pass': 'Passed',
  'settings.doctor.status.skip': 'Skipped',
  'provider.deepseek': 'DeepSeek'
}

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18next>()),
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      const translation = translations[key] ?? key
      return Object.entries(params ?? {}).reduce(
        (value, [name, replacement]) => value.replaceAll(`{{${name}}}`, String(replacement)),
        translation
      )
    }
  })
}))

vi.mock('@renderer/hooks/useMcpServer', () => ({ useMcpServers: () => ({ mcpServers: [] }) }))

import { ErrorDiagnosisPanel } from '../ErrorDiagnosisPanel'

function createController(state: DoctorState) {
  return {
    appUpdateState: {
      info: null,
      checking: false,
      downloading: false,
      downloaded: false,
      downloadProgress: 0,
      available: false,
      ignore: false,
      manualCheck: false
    },
    cancel: vi.fn<DoctorController['cancel']>(),
    canChangePanel: true,
    cancelConfirmation: vi.fn<DoctorController['cancelConfirmation']>(),
    confirmCheck: vi.fn<DoctorController['confirmCheck']>(),
    confirmEvidence: vi.fn<DoctorController['confirmEvidence']>(),
    executeAction: vi.fn<DoctorController['executeAction']>(),
    isAutoRunPending: false,
    isInteracting: false,
    isCloseBlocked: false,
    openLogsPath: vi.fn<DoctorController['openLogsPath']>(),
    openPath: vi.fn<DoctorController['openPath']>(),
    requestEvidence: vi.fn<DoctorController['requestEvidence']>(),
    run: vi.fn<DoctorController['run']>(),
    session: {
      activePanel: 'checks',
      descriptionDraft: '',
      fixedCheckIds: [],
      interaction: { kind: 'idle' },
      relaunchRequired: false
    },
    setDescription: vi.fn<DoctorController['setDescription']>(),
    setPanel: vi.fn<DoctorController['setPanel']>(),
    setPanelInteraction: vi.fn<DoctorController['setPanelInteraction']>(),
    toggleDevTools: vi.fn<DoctorController['toggleDevTools']>(),
    viewModel: buildDoctorViewModel(state)
  } satisfies DoctorController
}

function renderPanel(state: DoctorState, subject: DoctorSubjectRef = { kind: 'agent', agentId: 'no-model' }) {
  const controller = createController(state)
  render(<ErrorDiagnosisPanel doctorController={controller} subject={subject} />)
  return controller
}

const modelEndpointPass: DoctorCheckResult = {
  id: 'network-model-endpoint',
  status: 'pass',
  durationMs: 1
}

const modelListFail: DoctorCheckResult = {
  id: 'provider-model-list',
  status: 'fail',
  durationMs: 1,
  attribution: 'user-fixable',
  detail: { variant: 'request_failed', params: { category: 'auth' } },
  actions: [{ kind: 'navigate', target: '/settings/provider' }]
}

const missingApiKeyResult: DoctorCheckResult = {
  id: 'provider-api-key-present',
  status: 'fail',
  durationMs: 1,
  attribution: 'user-fixable',
  detail: { variant: 'missing' },
  evidence: [
    { key: 'providerId', value: 'deepseek', dataClass: 'local_only' },
    { key: 'status', value: 401, dataClass: 'public' },
    { key: 'request', value: 'private request', dataClass: 'consent_required' }
  ],
  actions: [{ kind: 'navigate', target: '/settings/provider' }]
}

const conversationFail: DoctorCheckResult = {
  id: 'provider-model-conversation',
  status: 'fail',
  durationMs: 1,
  attribution: 'user-fixable',
  detail: { variant: 'request_failed', params: { category: 'auth' } },
  actions: [{ kind: 'navigate', target: '/settings/provider' }]
}

const conversationPending: DoctorPendingCheck = {
  checkId: 'provider-model-conversation',
  requestId: 'confirm-conversation',
  confirmation: {
    messageKey: 'settings.doctor.checks.provider-model-conversation.confirmation',
    params: { model: 'DeepSeek V4 Flash', modelId: 'deepseek-v4-flash', endpoint: 'https://api.deepseek.com/' }
  }
}

function completedState(
  results: readonly DoctorCheckResult[],
  pendingChecks: readonly DoctorPendingCheck[] = []
): DoctorState {
  return {
    status: 'completed',
    report: {
      schemaVersion: 1,
      scope: 'chat:deepseek/deepseek-v4-flash',
      runId: 'completed-contextual',
      tier: 'live',
      selectedCheckIds: [...results.map((result) => result.id), ...pendingChecks.map((pending) => pending.checkId)],
      startedAt: '2026-09-17T00:00:00.000Z',
      finishedAt: '2026-09-17T00:00:01.000Z',
      expiresAt: '2099-09-17T00:10:00.000Z',
      basics: {
        version: '2.0.0',
        edition: 'global',
        channel: 'latest',
        platform: 'darwin',
        arch: 'arm64',
        osRelease: '25.0.0',
        runtime: {},
        isPackaged: true,
        isPortable: false
      },
      results,
      pendingChecks,
      summary: { pass: 0, warn: 0, fail: 0, skip: 0, error: 0 }
    }
  }
}

describe('ErrorDiagnosisPanel contextual diagnosis', () => {
  it('shows completed connectivity results and confirms a pending conversation check', async () => {
    const user = userEvent.setup()
    const controller = renderPanel(completedState([modelEndpointPass, modelListFail], [conversationPending]), {
      kind: 'chat',
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash'
    })

    const panel = screen.getByRole('region', { name: 'Diagnostic result' })
    expect(within(panel).getByRole('button', { name: /Selected model endpoint/ })).toHaveTextContent('Passed')
    expect(within(panel).getByRole('button', { name: /Remote model availability/ })).toHaveTextContent('Failed')
    const conversation = within(panel).getByRole('button', { name: /Model conversation/ })
    expect(conversation).toHaveTextContent('Pending')

    await user.click(conversation)
    await user.click(within(panel).getByRole('button', { name: 'Send test message' }))
    expect(controller.confirmCheck).toHaveBeenCalledWith(conversationPending)
  })

  it('keeps a shared provider action on the API-key finding instead of repeating it on connectivity steps', async () => {
    const user = userEvent.setup()
    const controller = renderPanel(completedState([missingApiKeyResult, modelEndpointPass, conversationFail]), {
      kind: 'chat',
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash'
    })
    const panel = screen.getByRole('region', { name: 'Diagnostic result' })

    await user.click(within(panel).getByRole('button', { name: /Model conversation/ }))
    expect(within(panel).queryByRole('button', { name: 'Open provider settings' })).not.toBeInTheDocument()

    await user.click(within(panel).getByRole('button', { name: /Provider API key/ }))
    expect(within(panel).getByText('DeepSeek has no enabled API key.')).toBeVisible()
    expect(within(panel).queryByRole('button', { name: 'Local details' })).not.toBeInTheDocument()
    expect(panel).not.toHaveTextContent('providerId')
    expect(panel).not.toHaveTextContent('401')
    expect(panel).not.toHaveTextContent('private request')
    await user.click(within(panel).getByRole('button', { name: 'Open provider settings' }))
    expect(controller.executeAction).toHaveBeenCalledWith(
      'provider-api-key-present',
      { kind: 'navigate', target: '/settings/provider' },
      'completed-contextual'
    )
  })

  it('marks connectivity steps as skipped while an Agent without a model runs only applicable checks', async () => {
    const user = userEvent.setup()
    renderPanel({
      status: 'running',
      runId: 'run-no-model',
      tier: 'live',
      selectedCheckIds: ['network-online'],
      startedAt: '2026-09-17T00:00:00.000Z',
      activeCheckIds: ['network-online'],
      results: []
    })

    const panel = screen.getByRole('region', { name: 'Diagnosing' })
    expect(within(panel).getAllByText('Skipped')).toHaveLength(3)
    expect(within(panel).queryByText('Pending')).not.toBeInTheDocument()

    const endpoint = within(panel).getByRole('button', { name: /Selected model endpoint/ })
    await user.click(endpoint)
    expect(
      within(endpoint.closest('[data-slot="accordion-item"]') as HTMLElement).getAllByText('Skipped')
    ).toHaveLength(2)
  })

  it.each([
    ['failed', 'Diagnosis failed', 'The diagnostic run could not be completed.'],
    ['canceled', 'Diagnosis canceled', 'The diagnostic run was canceled before it finished.']
  ] as const)('retries a %s contextual diagnosis with the contextual command', async (status, title, description) => {
    const user = userEvent.setup()
    const controller = renderPanel({
      status,
      runId: `run-${status}`,
      selectedCheckIds: ['network-model-endpoint', 'provider-model-list', 'provider-model-conversation']
    })

    expect(screen.getByText(title)).toBeVisible()
    expect(screen.getByText(description)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Run checks again' }))

    expect(controller.run).toHaveBeenCalledWith('contextual')
  })
})
