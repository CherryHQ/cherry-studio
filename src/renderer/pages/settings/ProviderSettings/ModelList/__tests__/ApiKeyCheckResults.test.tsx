import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import type { ApiKeyWithStatus } from '@renderer/pages/settings/ProviderSettings/types/healthCheck'
import { HealthStatus } from '@renderer/pages/settings/ProviderSettings/types/healthCheck'

import ApiKeyCheckResults from '../ApiKeyCheckResults'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { latency?: string }) =>
      key === 'settings.models.check.latency' ? `${options?.latency} ms` : key
  })
}))

describe('ApiKeyCheckResults', () => {
  it('shows stable key identity, two-decimal latency, full errors, and no disabled status row', async () => {
    const user = userEvent.setup()
    const primary = { id: 'key-1', key: 'sk-primary-1234', label: 'Primary', isEnabled: true }
    const backup = { id: 'key-2', key: 'sk-backup-5678', isEnabled: false }
    const results: ApiKeyWithStatus[] = [
      {
        kind: 'ok',
        credential: { kind: 'api-key', entry: primary },
        status: HealthStatus.SUCCESS,
        checking: false,
        latency: 2060.2434580000117
      },
      {
        kind: 'failed',
        credential: { kind: 'api-key', entry: backup },
        status: HealthStatus.FAILED,
        checking: false,
        error: { name: 'QuotaError', message: 'quota exhausted', stack: null }
      }
    ]
    const onToggleKey = vi.fn().mockResolvedValue(undefined)

    render(<ApiKeyCheckResults keyResults={results} apiKeyEntries={[primary, backup]} onToggleKey={onToggleKey} />)

    expect(screen.getByText('Primary')).toBeInTheDocument()
    expect(screen.getByText('2060.24 ms')).toBeInTheDocument()
    expect(screen.getByText('quota exhausted')).toBeInTheDocument()
    expect(screen.queryByText('settings.models.check.disabled')).not.toBeInTheDocument()
    const switches = screen.getAllByRole('switch')
    expect(switches).toHaveLength(2)
    expect(switches[1]).not.toBeChecked()
    expect(screen.queryByRole('button', { name: /copy|edit|delete/i })).not.toBeInTheDocument()

    await user.click(switches[1])
    expect(onToggleKey).toHaveBeenCalledWith('key-2', true)
  })

  it('locks every key switch while a key toggle is saving', async () => {
    const user = userEvent.setup()
    const primary = { id: 'key-1', key: 'sk-primary-1234', label: 'Primary', isEnabled: true }
    const backup = { id: 'key-2', key: 'sk-backup-5678', label: 'Backup', isEnabled: true }
    const results: ApiKeyWithStatus[] = [
      {
        kind: 'ok',
        credential: { kind: 'api-key', entry: primary },
        status: HealthStatus.SUCCESS,
        checking: false,
        latency: 42
      },
      {
        kind: 'ok',
        credential: { kind: 'api-key', entry: backup },
        status: HealthStatus.SUCCESS,
        checking: false,
        latency: 48
      }
    ]
    const onToggleKey = vi.fn().mockResolvedValue(undefined)

    render(
      <ApiKeyCheckResults
        keyResults={results}
        apiKeyEntries={[primary, backup]}
        savingKeyId="key-1"
        onToggleKey={onToggleKey}
      />
    )

    const switches = screen.getAllByRole('switch')
    expect(switches).toHaveLength(2)
    expect(switches[0]).toBeDisabled()
    expect(switches[1]).toBeDisabled()

    await user.click(switches[0])
    await user.click(switches[1])
    expect(onToggleKey).not.toHaveBeenCalled()
  })
})
