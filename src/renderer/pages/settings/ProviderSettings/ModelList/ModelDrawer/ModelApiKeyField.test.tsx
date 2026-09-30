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

const fieldLabel = 'settings.models.edit.api_key.label'
const autoLabel = 'settings.models.edit.api_key.auto'

function selectedKeyTrigger(label: string) {
  return screen.getByRole('button', { name: `${fieldLabel} ${label}` })
}

describe('ModelApiKeyField', () => {
  it('shows the bound key label as the current selection', () => {
    render(<ModelApiKeyField apiKeys={apiKeys} value="key-2" onChange={vi.fn()} />)

    expect(selectedKeyTrigger('Backup')).toBeInTheDocument()
  })

  it('shows automatic selection when the bound key no longer exists', () => {
    render(<ModelApiKeyField apiKeys={apiKeys} value="deleted-key" onChange={vi.fn()} />)

    expect(selectedKeyTrigger(autoLabel)).toBeInTheDocument()
  })

  it('shows automatic selection when no key is bound', () => {
    render(<ModelApiKeyField apiKeys={apiKeys} value={null} onChange={vi.fn()} />)

    expect(selectedKeyTrigger(autoLabel)).toBeInTheDocument()
  })
})
