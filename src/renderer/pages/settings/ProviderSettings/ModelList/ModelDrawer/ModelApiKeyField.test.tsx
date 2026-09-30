import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { RuntimeApiKey } from '@shared/data/types/provider'

import { ModelApiKeyField } from './ModelApiKeyField'

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<object>()

  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key
    })
  }
})

const apiKeys: RuntimeApiKey[] = [
  { id: 'key-1', label: 'Primary', isEnabled: true },
  { id: 'key-2', label: 'Backup', isEnabled: true }
]

describe('ModelApiKeyField', () => {
  it('shows the bound key label as the current selection', () => {
    render(<ModelApiKeyField apiKeys={apiKeys} value="key-2" onChange={vi.fn()} />)

    expect(screen.getByText('Backup')).toBeInTheDocument()
  })

  it('shows automatic selection when the bound key no longer exists', () => {
    // A deleted key id must render as automatic, not as an unset-looking stale value.
    render(<ModelApiKeyField apiKeys={apiKeys} value="deleted-key" onChange={vi.fn()} />)

    expect(screen.getByText('settings.models.edit.api_key.auto')).toBeInTheDocument()
  })

  it('shows automatic selection when no key is bound', () => {
    render(<ModelApiKeyField apiKeys={apiKeys} value={null} onChange={vi.fn()} />)

    expect(screen.getByText('settings.models.edit.api_key.auto')).toBeInTheDocument()
  })
})
