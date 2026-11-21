import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createUniqueModelId, type Model } from '@shared/data/types/model'

import { ModelProviderMetadataControls } from '../ModelProviderMetadataControls'

const mocks = vi.hoisted(() => ({ request: vi.fn(), error: vi.fn() }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: mocks.request } }))
vi.mock('@renderer/services/toast', () => ({ toast: { error: mocks.error } }))
vi.mock('@cherrystudio/ui', () => ({ Button: ({ children, ...props }: any) => <button {...props}>{children}</button> }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

const model = {
  id: createUniqueModelId('custom', 'model'),
  apiModelId: 'model',
  providerId: 'custom',
  name: 'Model',
  capabilities: [],
  supportsStreaming: true,
  isEnabled: true,
  isHidden: false,
  contextWindow: 32000,
  maxOutputTokens: 4000,
  providerMetadata: { contextWindow: 128000, maxOutputTokens: 8000 },
  metadataSources: { contextWindow: 'user', maxOutputTokens: 'provider', capabilities: 'unknown' }
} satisfies Model
function Harness({ disabled = false }: { disabled?: boolean }) {
  const [current, setCurrent] = useState<Model>(model)
  return (
    <>
      <ModelProviderMetadataControls model={current} disabled={disabled} onChange={setCurrent} />
      <output>
        {current.contextWindow}/{current.maxOutputTokens}
      </output>
    </>
  )
}
beforeEach(() => vi.clearAllMocks())

describe('provider metadata settings', () => {
  it('shows source labels and never refreshes automatically (AC7/AC8)', () => {
    render(<Harness />)
    expect(screen.getByText(/settings.models.metadata.source.user/)).toBeInTheDocument()
    expect(screen.getByText(/settings.models.metadata.source.provider/)).toBeInTheDocument()
    expect(screen.getByText(/settings.models.metadata.source.unknown/)).toBeInTheDocument()
    expect(mocks.request).not.toHaveBeenCalled()
  })
  it('resets just the selected field and applies the returned values (AC6)', async () => {
    mocks.request.mockResolvedValue({
      ...model,
      contextWindow: 128000,
      metadataSources: { ...model.metadataSources, contextWindow: 'provider' }
    })
    render(<Harness />)
    fireEvent.click(
      screen.getByRole('button', {
        name: 'settings.models.metadata.reset settings.models.metadata.field.contextWindow'
      })
    )
    await waitFor(() => expect(screen.getByText('128000/4000')).toBeInTheDocument())
    expect(mocks.request).toHaveBeenCalledExactlyOnceWith('ai.provider.model.reset_metadata', {
      providerId: 'custom',
      modelId: 'model',
      field: 'contextWindow'
    })
  })
  it('only fetches metadata after an explicit click', async () => {
    mocks.request.mockResolvedValue(model)
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'settings.models.metadata.refresh' }))
    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledExactlyOnceWith('ai.provider.model.refresh_metadata', {
        providerId: 'custom',
        modelId: 'model'
      })
    )
  })
  it('keeps values on failed refresh and disables actions while saving', async () => {
    mocks.request.mockRejectedValue(new Error('offline'))
    const view = render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'settings.models.metadata.refresh' }))
    await waitFor(() => expect(mocks.error).toHaveBeenCalled())
    expect(screen.getByText('32000/4000')).toBeInTheDocument()
    view.rerender(<Harness disabled />)
    expect(screen.getByRole('button', { name: 'settings.models.metadata.refresh' })).toBeDisabled()
  })
})
