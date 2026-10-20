import { mockDataApiService } from '@test-mocks/renderer/DataApiService'
import { MockUseDataApiUtils, mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ModelSchema, type Model } from '@shared/data/types/model'
import { ProviderSchema } from '@shared/data/types/provider'
import { isAudioModel, isVideoModel, isVisionModel } from '@shared/utils/model'

import AddModelFormPanel from '../AddModelFormPanel'
import EditModelDrawer from '../EditModelDrawer'

vi.unmock('@cherrystudio/ui')

const provider = ProviderSchema.parse({
  id: 'custom-relay',
  name: 'Relay',
  settings: {},
  apiKeys: [],
  authType: 'api-key',
  reportsActualCost: false,
  isEnabled: true,
  defaultChatEndpoint: 'google-generate-content',
  endpointConfigs: { 'google-generate-content': { baseUrl: 'https://relay.example/gemini', adapterFamily: 'google' } }
})
const model = ModelSchema.parse({
  id: 'custom-relay::image-model',
  providerId: 'custom-relay',
  name: 'Image model',
  endpointTypes: ['google-generate-content', 'openai-responses', 'ollama-chat'],
  capabilities: ['image-generation', 'audio-generation', 'structured-output'],
  inputModalities: ['text', 'image'],
  outputModalities: ['image'],
  supportsStreaming: false,
  isEnabled: true,
  isHidden: false
})
const create = vi.fn().mockResolvedValue([model])
const update = vi.fn().mockResolvedValue(model)

beforeAll(async () => {
  await i18n.changeLanguage('en-US')
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
  Element.prototype.scrollIntoView = () => {}
})
beforeEach(() => {
  mockDataApiService.get.mockImplementation(async (_path, options) =>
    (options?.query?.ids ?? []).map((id: string) =>
      ModelSchema.parse({
        ...model,
        id: `${provider.id}::${id}`,
        apiModelId: id,
        capabilities: [],
        inputModalities: undefined,
        outputModalities: undefined,
        presetModelId: null
      })
    )
  )
  create.mockClear()
  update.mockReset().mockResolvedValue(model)
  mockUseQuery.mockImplementation((path) => ({
    data: path === '/providers/:providerId' ? provider : [],
    isLoading: false,
    isRefreshing: false,
    error: undefined,
    refetch: vi.fn(),
    mutate: vi.fn()
  }))
  MockUseDataApiUtils.mockMutationWithTrigger('PATCH', '/models/:uniqueModelId*', update)
})
afterEach(cleanup)

const groupButton = (group: string, name: string) =>
  within(screen.getByRole('group', { name: group })).getByRole('button', { name })

describe('model metadata persistence', () => {
  it('shows known defaults without submitting them as explicit overrides', async () => {
    const user = userEvent.setup()
    mockDataApiService.get.mockResolvedValue([{ ...model, presetModelId: 'image-model' }])
    MockUseDataApiUtils.mockMutationWithTrigger('POST', '/models', create)
    render(<AddModelFormPanel providerId={provider.id} prefill={null} onSuccess={vi.fn()} onCancel={vi.fn()} />)
    await user.type(screen.getByRole('textbox', { name: 'Model ID' }), 'image-model')
    await user.click(screen.getByRole('button', { name: 'More Settings' }))
    await waitFor(() =>
      expect(groupButton('Model Capabilities', 'Image generation')).toHaveAttribute('aria-pressed', 'true')
    )
    await user.click(screen.getByRole('button', { name: 'Add Model' }))
    await waitFor(() => expect(create.mock.calls.length).toBe(1))
    const saved = create.mock.calls[0][0].body[0]
    expect(saved).not.toHaveProperty('capabilities')
    expect(saved).not.toHaveProperty('endpointTypes')
  })

  it('retains explicit clearing while a delayed default lookup completes', async () => {
    const user = userEvent.setup()
    let finish!: (models: unknown[]) => void
    mockDataApiService.get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    render(<AddModelFormPanel providerId={provider.id} prefill={null} onSuccess={vi.fn()} onCancel={vi.fn()} />)
    await user.type(screen.getByRole('textbox', { name: 'Model ID' }), 'image-model')
    await user.click(screen.getByRole('button', { name: 'More Settings' }))
    await user.click(groupButton('Model Capabilities', 'Image generation'))
    await user.click(groupButton('Model Capabilities', 'Image generation'))
    finish([{ ...model, presetModelId: 'image-model' }])
    await waitFor(() =>
      expect(groupButton('Model Capabilities', 'Image generation')).toHaveAttribute('aria-pressed', 'false')
    )
  })

  it('does not create when default resolution fails', async () => {
    const user = userEvent.setup()
    mockDataApiService.get.mockRejectedValue(new Error('registry unavailable'))
    MockUseDataApiUtils.mockMutationWithTrigger('POST', '/models', create)
    render(<AddModelFormPanel providerId={provider.id} prefill={null} onSuccess={vi.fn()} onCancel={vi.fn()} />)
    await user.type(screen.getByRole('textbox', { name: 'Model ID' }), 'known-model')
    await user.click(screen.getByRole('button', { name: 'Add Model' }))
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(create.mock.calls).toEqual([])
  })

  it('creates a Gemini image model by independently configuring capabilities and modalities', async () => {
    const user = userEvent.setup()
    MockUseDataApiUtils.mockMutationWithTrigger('POST', '/models', create)
    render(<AddModelFormPanel providerId={provider.id} prefill={null} onSuccess={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Model Type' })).not.toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: 'Model ID' }), 'image-model')
    await user.click(screen.getByRole('button', { name: 'More Settings' }))
    await user.click(groupButton('Model Capabilities', 'Image generation'))
    await user.click(groupButton('Model Capabilities', 'Tool'))
    await user.click(groupButton('Input Modalities', 'Image'))
    await user.click(groupButton('Output Modalities', 'Image'))
    await user.click(screen.getByRole('button', { name: 'Add Model' }))
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        body: [
          expect.objectContaining({
            capabilities: ['image-generation', 'function-call'],
            inputModalities: ['image'],
            outputModalities: ['image']
          })
        ]
      })
    )
  })
  it('preserves catalog metadata and endpoint order when adding another endpoint', async () => {
    const user = userEvent.setup()
    MockUseDataApiUtils.mockMutationWithTrigger('POST', '/models', create)
    render(<AddModelFormPanel providerId={provider.id} prefill={{ model }} onSuccess={vi.fn()} onCancel={vi.fn()} />)
    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: 'Anthropic' }))
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Add Model' }))
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        body: [
          expect.objectContaining({
            endpointTypes: [...model.endpointTypes!, 'anthropic-messages']
          })
        ]
      })
    )
  })
  it('orders a reset after an in-flight save and before subsequent edits', async () => {
    const user = userEvent.setup()
    let saved = { ...model, capabilities: [] as Model['capabilities'] }
    const writes: string[] = []
    let finish!: () => void
    let first = true
    update.mockImplementation(async ({ body }) => {
      if (first) {
        first = false
        await new Promise<void>((resolve) => {
          finish = resolve
        })
      }
      if (body.resetFields) {
        writes.push('reset')
        saved = { ...saved, capabilities: model.capabilities }
      } else {
        writes.push(body.name ? 'name' : 'capabilities')
        saved = { ...saved, ...body }
      }
      return saved
    })
    mockDataApiService.get.mockResolvedValue([{ ...model, presetModelId: 'image-model' }])
    render(<EditModelDrawer providerId={provider.id} model={saved} open onClose={vi.fn()} />)
    const name = screen.getByRole('textbox', { name: 'Model Name' })
    await user.clear(name)
    await user.type(name, 'Renamed')
    await user.click(screen.getByRole('button', { name: 'Restore model defaults' }))
    await user.click(await screen.findByRole('checkbox', { name: /Model Capabilities/ }))
    await user.click(screen.getByRole('button', { name: 'Restore selected fields' }))
    await user.click(groupButton('Model Capabilities', 'Tool'))
    await act(async () => finish())
    await waitFor(() => expect(saved.capabilities).toEqual(['function-call']))
    expect(saved.name).toBe('Renamed')
    const resetIndex = writes.indexOf('reset')
    expect(resetIndex).toBeGreaterThan(0)
    expect(writes.slice(0, resetIndex).every((write) => write === 'name')).toBe(true)
    expect(writes.slice(resetIndex)).toEqual(['reset', 'capabilities'])
    expect(groupButton('Model Capabilities', 'Tool')).toHaveAttribute('aria-pressed', 'true')
    expect(groupButton('Model Capabilities', 'Image generation')).toHaveAttribute('aria-pressed', 'false')
  })

  it('discards a preview that arrives after the model ID changes', async () => {
    const user = userEvent.setup()
    let finish!: (models: unknown[]) => void
    mockDataApiService.get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    render(<AddModelFormPanel providerId={provider.id} prefill={null} onSuccess={vi.fn()} onCancel={vi.fn()} />)
    const id = screen.getByRole('textbox', { name: 'Model ID' })
    await user.type(id, 'old-model')
    await user.click(screen.getByRole('button', { name: 'More Settings' }))
    await user.clear(id)
    await user.type(id, 'new-model')
    await user.tab()
    await act(async () => finish([{ ...model, presetModelId: 'old-model' }]))
    expect(groupButton('Model Capabilities', 'Image generation')).toHaveAttribute('aria-pressed', 'false')
  })

  it('keeps the draft and selected reset fields available when restoration fails', async () => {
    const user = userEvent.setup()
    update.mockRejectedValue(new Error('write failed'))
    mockDataApiService.get.mockResolvedValue([{ ...model, presetModelId: 'image-model' }])
    render(<EditModelDrawer providerId={provider.id} model={{ ...model, capabilities: [] }} open onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Restore model defaults' }))
    await user.click(await screen.findByRole('checkbox', { name: /Model Capabilities/ }))
    await user.click(screen.getByRole('button', { name: 'Restore selected fields' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Restore selected fields' })).toBeEnabled())
    expect(screen.getByRole('checkbox', { name: /Model Capabilities/ })).toBeChecked()
    expect(groupButton('Model Capabilities', 'Image generation')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getAllByRole('alert').some((alert) => alert.textContent?.includes('failed'))).toBe(true)
  })

  it('finishes a pending reset for its original model without replacing the newly opened draft', async () => {
    const user = userEvent.setup()
    const other: Model = { ...model, id: 'custom-relay::other-model', name: 'Other', capabilities: [] }
    const rows = new Map<string, Model>([
      [model.id, { ...model, capabilities: [] as Model['capabilities'] }],
      [other.id, other]
    ])
    let finish!: () => void
    update.mockImplementation(async ({ params }) => {
      await new Promise<void>((resolve) => {
        finish = resolve
      })
      const saved = { ...rows.get(params.uniqueModelId)!, capabilities: model.capabilities }
      rows.set(params.uniqueModelId, saved)
      return saved
    })
    mockDataApiService.get.mockResolvedValue([{ ...model, presetModelId: 'image-model' }])
    const { rerender } = render(
      <EditModelDrawer providerId={provider.id} model={rows.get(model.id)!} open onClose={vi.fn()} />
    )
    await user.click(screen.getByRole('button', { name: 'Restore model defaults' }))
    await user.click(await screen.findByRole('checkbox', { name: /Model Capabilities/ }))
    await user.click(screen.getByRole('button', { name: 'Restore selected fields' }))
    rerender(<EditModelDrawer providerId={provider.id} model={other} open onClose={vi.fn()} />)
    await act(async () => finish())
    expect(rows.get(model.id)?.capabilities).toEqual(model.capabilities)
    expect(rows.get(other.id)?.capabilities).toEqual([])
    expect(screen.getByRole('textbox', { name: 'Model Name' })).toHaveValue('Other')
    expect(groupButton('Model Capabilities', 'Image generation')).toHaveAttribute('aria-pressed', 'false')
  })

  it('saves only the name when renaming a catalog-backed model', async () => {
    const user = userEvent.setup()
    render(<EditModelDrawer providerId={provider.id} model={model} open onClose={vi.fn()} />)
    const name = screen.getByRole('textbox', { name: 'Model Name' })
    await user.clear(name)
    await user.type(name, 'Renamed')
    await user.tab()
    await waitFor(() => expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ body: { name: 'Renamed' } })))
  })
  it('toggles a capability without dropping hidden catalog capabilities or writing other fields', async () => {
    const user = userEvent.setup()
    render(<EditModelDrawer providerId={provider.id} model={model} open onClose={vi.fn()} />)
    await user.click(groupButton('Model Capabilities', 'Reasoning'))
    await waitFor(() =>
      expect(update).toHaveBeenLastCalledWith(
        expect.objectContaining({
          body: {
            capabilities: [...model.capabilities, 'reasoning']
          }
        })
      )
    )
    await user.click(groupButton('Model Capabilities', 'Image generation'))
    await waitFor(() =>
      expect(update).toHaveBeenLastCalledWith(
        expect.objectContaining({
          body: {
            capabilities: ['audio-generation', 'structured-output', 'reasoning']
          }
        })
      )
    )
  })
  it.each([
    ['Image', 'image', 'image-recognition', isVisionModel],
    ['Audio', 'audio', 'audio-recognition', isAudioModel],
    ['Video', 'video', 'video-recognition', isVideoModel]
  ] as const)(
    'disables and re-enables %s input without stale recognition support',
    async (label, modality, capability, supports) => {
      const user = userEvent.setup()
      const original = ModelSchema.parse({
        ...model,
        capabilities: [...model.capabilities, capability],
        inputModalities: ['text', modality]
      })
      render(<EditModelDrawer providerId={provider.id} model={original} open onClose={vi.fn()} />)
      await user.click(groupButton('Input Modalities', label))
      await waitFor(() =>
        expect(update).toHaveBeenLastCalledWith(
          expect.objectContaining({
            body: { inputModalities: ['text'], capabilities: model.capabilities }
          })
        )
      )
      const disabled = { ...original, ...update.mock.lastCall![0].body }
      expect(supports(disabled)).toBe(false)
      expect(disabled.outputModalities).toEqual(model.outputModalities)
      await user.click(groupButton('Input Modalities', label))
      await waitFor(() =>
        expect(update).toHaveBeenLastCalledWith(
          expect.objectContaining({
            body: expect.objectContaining({ inputModalities: ['text', modality] })
          })
        )
      )
      expect(supports({ ...disabled, ...update.mock.lastCall![0].body })).toBe(true)
    }
  )
  it.each([undefined, ['text'] as const])(
    'preserves capability-only image support when enabling audio with modalities %j',
    async (inputModalities) => {
      const user = userEvent.setup()
      const original = ModelSchema.parse({
        ...model,
        capabilities: ['image-recognition', 'function-call'],
        inputModalities
      })
      render(<EditModelDrawer providerId={provider.id} model={original} open onClose={vi.fn()} />)
      expect(groupButton('Input Modalities', 'Image')).toHaveAttribute('aria-pressed', 'true')
      await user.click(groupButton('Input Modalities', 'Audio'))
      await waitFor(() =>
        expect(update).toHaveBeenLastCalledWith(
          expect.objectContaining({
            body: { inputModalities: [...(inputModalities ?? []), 'image', 'audio'], capabilities: ['function-call'] }
          })
        )
      )
      const updated = { ...original, ...update.mock.lastCall![0].body }
      expect(isVisionModel(updated)).toBe(true)
      expect(isAudioModel(updated)).toBe(true)
      await user.click(groupButton('Input Modalities', 'Image'))
      await waitFor(() =>
        expect(update).toHaveBeenLastCalledWith(
          expect.objectContaining({
            body: { inputModalities: [...(inputModalities ?? []), 'audio'], capabilities: ['function-call'] }
          })
        )
      )
      expect(isVisionModel({ ...updated, ...update.mock.lastCall![0].body })).toBe(false)
    }
  )
  it('clears output modalities without changing input modalities, capabilities or endpoints', async () => {
    const user = userEvent.setup()
    render(<EditModelDrawer providerId={provider.id} model={model} open onClose={vi.fn()} />)
    await user.click(groupButton('Output Modalities', 'Image'))
    await waitFor(() =>
      expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ body: { outputModalities: [] } }))
    )
  })
  it('preserves primary and unlisted endpoints when adding or removing another endpoint', async () => {
    const user = userEvent.setup()
    render(<EditModelDrawer providerId={provider.id} model={model} open onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Anthropic' }))
    await waitFor(() =>
      expect(update).toHaveBeenLastCalledWith(
        expect.objectContaining({
          body: {
            endpointTypes: [...model.endpointTypes!, 'anthropic-messages']
          }
        })
      )
    )
    await user.click(screen.getByRole('button', { name: 'OpenAI-Response' }))
    await waitFor(() =>
      expect(update).toHaveBeenLastCalledWith(
        expect.objectContaining({
          body: {
            endpointTypes: ['google-generate-content', 'ollama-chat', 'anthropic-messages']
          }
        })
      )
    )
  })
})
