import type { ModelWithStatus } from '@renderer/pages/settings/ProviderSettings/types/healthCheck'
import { HealthStatus } from '@renderer/pages/settings/ProviderSettings/types/healthCheck'
import type { Model } from '@shared/data/types/model'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import ModelCheckStatus from '../ModelCheckStatus'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

const model: Model = {
  id: 'openai::chat',
  providerId: 'openai',
  name: 'Chat',
  capabilities: [],
  supportsStreaming: true,
  isEnabled: true,
  isHidden: false
}

describe('ModelCheckStatus', () => {
  it('renders checking feedback without changing row height', () => {
    const result: ModelWithStatus = {
      kind: 'checking',
      model,
      status: HealthStatus.NOT_CHECKED,
      checking: true,
      keyResults: []
    }
    render(<ModelCheckStatus result={result} apiKeyEntries={[]} savingKeyId={null} onToggleKey={vi.fn()} />)
    expect(screen.getByLabelText('Chat: settings.models.check.status_checking')).toBeInTheDocument()
    expect(screen.getByText('settings.models.check.status_checking')).toBeInTheDocument()
  })

  it('shows both the passed state and its fastest latency', () => {
    const result: ModelWithStatus = {
      kind: 'ok',
      model,
      status: HealthStatus.SUCCESS,
      checking: false,
      keyResults: [],
      latency: 42
    }
    render(<ModelCheckStatus result={result} apiKeyEntries={[]} savingKeyId={null} onToggleKey={vi.fn()} />)

    expect(screen.getByRole('button', { name: /settings.models.check.passed · 42 ms/ })).toBeInTheDocument()
  })

  it('uses a focusable failed status trigger and exposes the full error in a portal popover', async () => {
    const entry = { id: 'key-1', key: 'sk-primary', label: 'Primary', isEnabled: true }
    const result: ModelWithStatus = {
      kind: 'failed',
      model,
      status: HealthStatus.FAILED,
      checking: false,
      keyResults: [
        {
          kind: 'failed',
          credential: { kind: 'api-key', entry },
          status: HealthStatus.FAILED,
          checking: false,
          error: { name: 'Error', message: 'full provider error', stack: null }
        }
      ],
      error: { name: 'Error', message: 'full provider error', stack: null }
    }
    render(<ModelCheckStatus result={result} apiKeyEntries={[entry]} savingKeyId={null} onToggleKey={vi.fn()} />)

    const trigger = screen.getByRole('button', { name: /Chat: full provider error/ })
    fireEvent.click(trigger)
    expect(await screen.findAllByText('full provider error')).not.toHaveLength(0)
  })
})
