import { MockUseDataApiUtils, mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ModelSchema } from '@shared/data/types/model'
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
  create.mockClear()
  update.mockClear()
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
            endpointTypes: ['google-generate-content'],
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
            endpointTypes: [...model.endpointTypes!, 'anthropic-messages'],
            capabilities: model.capabilities,
            inputModalities: model.inputModalities,
            outputModalities: model.outputModalities
          })
        ]
      })
    )
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
