import type { ApiKeyWithStatus } from '@renderer/pages/settings/ProviderSettings/types/healthCheck'
import { HealthStatus } from '@renderer/pages/settings/ProviderSettings/types/healthCheck'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import ApiKeyCheckResults from '../ApiKeyCheckResults'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

describe('ApiKeyCheckResults', () => {
  it('shows stable key identity, full errors, latency, and only an enable switch', () => {
    const primary = { id: 'key-1', key: 'sk-primary-1234', label: 'Primary', isEnabled: true }
    const backup = { id: 'key-2', key: 'sk-backup-5678', isEnabled: false }
    const results: ApiKeyWithStatus[] = [
      {
        kind: 'ok',
        credential: { kind: 'api-key', entry: primary },
        status: HealthStatus.SUCCESS,
        checking: false,
        latency: 42
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
    expect(screen.getByText('quota exhausted')).toBeInTheDocument()
    expect(screen.getByText('settings.models.check.disabled')).toBeInTheDocument()
    expect(screen.getAllByRole('switch')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: /copy|edit|delete/i })).not.toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('switch')[1])
    expect(onToggleKey).toHaveBeenCalledWith('key-2', true)
  })
})
