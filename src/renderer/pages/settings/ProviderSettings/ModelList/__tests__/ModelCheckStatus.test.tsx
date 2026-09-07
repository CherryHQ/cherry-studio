import type * as CherryStudioUi from '@cherrystudio/ui'
import type { ApiKeyWithStatus, ModelWithStatus } from '@renderer/pages/settings/ProviderSettings/types/healthCheck'
import { HealthStatus } from '@renderer/pages/settings/ProviderSettings/types/healthCheck'
import type { SerializedError } from '@renderer/types/error'
import type { Model } from '@shared/data/types/model'
import type { ApiKeyEntry } from '@shared/data/types/provider'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import ModelCheckStatus from '../ModelCheckStatus'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())

const translations: Record<string, string> = {
  'settings.models.check.failed': 'Failed',
  'settings.models.check.generation_output_image': 'an image',
  'settings.models.check.keys_failed_count': '{{failed}}/{{total}} keys failed',
  'settings.models.check.latency': 'Latency {{latency}} milliseconds',
  'settings.models.check.passed': 'Passed',
  'settings.models.check.skip_reason_generation_cost':
    'Checking this model would generate {{output}} and consume quota, so it is skipped by default.',
  'settings.models.check.status_checking': 'Checking…',
  'settings.models.check.status_skipped': 'Skipped'
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string | number>) => {
      const template = translations[key] ?? key
      return Object.entries(values ?? {}).reduce(
        (text, [name, value]) => text.replace(`{{${name}}}`, String(value)),
        template
      )
    }
  })
}))

const model: Model = {
  id: 'openai::chat',
  providerId: 'openai',
  name: 'Chat',
  capabilities: [],
  supportsStreaming: true,
  isEnabled: true,
  isHidden: false
}

const apiKeyEntries: ApiKeyEntry[] = [
  { id: 'key-1', key: 'sk-primary', label: 'Primary', isEnabled: true },
  { id: 'key-2', key: 'sk-secondary', label: 'Secondary', isEnabled: true },
  { id: 'key-3', key: 'sk-tertiary', label: 'Tertiary', isEnabled: true }
]

function error(message: string, name = 'Error'): SerializedError {
  return { name, message, stack: null }
}

function keyResult(
  entry: ApiKeyEntry,
  result: { kind: 'ok'; latency: number } | { kind: 'failed'; error: SerializedError }
): ApiKeyWithStatus {
  const credential = { kind: 'api-key' as const, entry }
  if (result.kind === 'ok') {
    return {
      kind: 'ok',
      credential,
      status: HealthStatus.SUCCESS,
      checking: false,
      latency: result.latency
    }
  }
  return {
    kind: 'failed',
    credential,
    status: HealthStatus.FAILED,
    checking: false,
    error: result.error
  }
}

function renderStatus(result: ModelWithStatus, entries: readonly ApiKeyEntry[] = apiKeyEntries) {
  return render(
    <div data-testid="model-row">
      <ModelCheckStatus
        result={result}
        apiKeyEntries={entries}
        savingKeyId={null}
        onToggleKey={vi.fn(async () => undefined)}
      />
    </div>
  )
}

describe('ModelCheckStatus', () => {
  it('announces that the model is being checked', () => {
    renderStatus({
      kind: 'checking',
      model,
      status: HealthStatus.NOT_CHECKED,
      checking: true,
      keyResults: []
    })

    expect(screen.getByLabelText('Chat: Checking…')).toBeInTheDocument()
    expect(screen.getByText('Checking…')).toBeInTheDocument()
  })

  it('shows passed feedback without inline latency details', () => {
    renderStatus({
      kind: 'ok',
      model,
      status: HealthStatus.SUCCESS,
      checking: false,
      keyResults: [keyResult(apiKeyEntries[0], { kind: 'ok', latency: 42 })],
      latency: 42
    })

    expect(screen.getByRole('button', { name: 'Chat: Passed' })).toBeInTheDocument()
  })

  it('summarizes how many API keys failed when only some checks fail', () => {
    renderStatus({
      kind: 'failed',
      model,
      status: HealthStatus.FAILED,
      checking: false,
      keyResults: [
        keyResult(apiKeyEntries[0], { kind: 'ok', latency: 42 }),
        keyResult(apiKeyEntries[1], { kind: 'failed', error: error('secondary key failed') })
      ],
      error: error('secondary key failed'),
      latency: 42
    })

    expect(screen.getByRole('button', { name: 'Chat: 1/2 keys failed' })).toBeInTheDocument()
  })

  it('shows Failed without an inline error summary and portals every complete error', async () => {
    const user = userEvent.setup()
    renderStatus({
      kind: 'failed',
      model,
      status: HealthStatus.FAILED,
      checking: false,
      keyResults: [
        keyResult(apiKeyEntries[0], { kind: 'failed', error: error(' ', '') }),
        keyResult(apiKeyEntries[1], { kind: 'failed', error: error('first key failure details') }),
        keyResult(apiKeyEntries[2], { kind: 'failed', error: error('second key failure details') })
      ],
      error: error('aggregate provider failure')
    })

    const row = screen.getByTestId('model-row')
    const trigger = screen.getByRole('button', { name: 'Chat: Failed' })
    await user.click(trigger)

    let popover: HTMLElement | null = null
    await waitFor(() => {
      popover = document.querySelector<HTMLElement>('[data-slot="popover-content"]')
      expect(popover).toBeInTheDocument()
    })

    expect(row).not.toContainElement(popover)
    expect(within(popover!).queryByText('aggregate provider failure')).not.toBeInTheDocument()
    expect(within(popover!).getByText('first key failure details')).toBeInTheDocument()
    expect(within(popover!).getByText('second key failure details')).toBeInTheDocument()
  })

  it('shows a complete reason for a skipped model', async () => {
    const user = userEvent.setup()
    renderStatus(
      {
        kind: 'skipped',
        model,
        status: HealthStatus.NOT_CHECKED,
        checking: false,
        keyResults: [],
        skipReason: { kind: 'generation_cost', output: 'image' }
      },
      []
    )

    await user.click(screen.getByRole('button', { name: 'Chat: Skipped' }))

    expect(
      await screen.findByText(
        'Checking this model would generate an image and consume quota, so it is skipped by default.'
      )
    ).toBeInTheDocument()
  })
})
