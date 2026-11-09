import { mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComposerToolLauncher } from '@renderer/components/composer/toolLauncher'
import { toast } from '@renderer/services/toast'
import { type Assistant, DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'

const mocks = vi.hoisted(() => ({
  update: vi.fn().mockResolvedValue(undefined),
  saved: null as null | { aspectRatio: string },
  panel: { isVisible: false, symbol: '', updateList: vi.fn() }
}))
vi.mock('@renderer/components/QuickPanel', () => ({ useQuickPanel: () => mocks.panel }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
import { GenerateImageGeometryPicker } from '../GenerateImageGeometryPicker'

const support = {
  modes: {
    generate: {
      supports: {
        size: { type: 'enum', options: ['1792x1024'] },
        aspectRatio: { type: 'enum', options: ['ASPECT_16_9'] }
      }
    },
    edit: { supports: { aspectRatio: { type: 'enum', options: ['ASPECT_1_1'] } } }
  }
}
function open() {
  const registerLaunchers = vi.fn<(entries: ComposerToolLauncher[]) => () => void>(() => () => {})
  render(
    <GenerateImageGeometryPicker
      assistant={
        {
          settings: {
            ...DEFAULT_ASSISTANT_SETTINGS,
            enableGenerateImage: true,
            imageGenerationGeometry: mocks.saved
          }
        } as Assistant
      }
      updateAssistant={mocks.update}
      toggleLauncher={{ id: 'generate-image', kind: 'command', icon: null, label: 'Generate image' }}
      launcher={{ registerLaunchers }}
    />
  )
  const quickPanel = { open: vi.fn() }
  const picker = registerLaunchers.mock.calls.at(-1)![0].find((entry) => entry.id === 'generate-image-geometry')!
  picker.action!({ quickPanel } as never)
  return quickPanel.open.mock.calls[0][0].list as Array<{
    label: string
    description?: string
    action?: () => void
    disabled?: boolean
    isSelected?: boolean
  }>
}
describe('image geometry picker', () => {
  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
    MockUsePreferenceUtils.setPreferenceValue('feature.paintings.default_model_id', 'openai::dall-e-3')
    mocks.saved = null
    mocks.update.mockClear()
    mockUseQuery.mockReturnValue({
      data: support,
      isLoading: false,
      isRefreshing: false,
      refetch: vi.fn(),
      mutate: vi.fn()
    } as never)
  })
  it('saves canonical presets and clears automatically', () => {
    const list = open()
    expect(list.find((item) => item.label === '16:9')?.description).toBe(
      'chat.input.generate_image_geometry.generate_only'
    )
    expect(list.find((item) => item.label === '1:1')?.description).toBe('chat.input.generate_image_geometry.edit_only')
    list.find((item) => item.label === '1792×1024')!.action!()
    list.find((item) => item.label === 'chat.input.generate_image_geometry.automatic')!.action!()
    expect(mocks.update).toHaveBeenNthCalledWith(1, { settings: { imageGenerationGeometry: { size: '1792x1024' } } })
    expect(mocks.update).toHaveBeenNthCalledWith(2, { settings: { imageGenerationGeometry: null } })
  })
  it('reports failed writes and keeps the committed choice selected', async () => {
    mocks.update.mockRejectedValueOnce(new Error('offline'))
    const list = open()
    list.find((item) => item.label === '1792×1024')!.action!()
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('common.save_failed'))
    expect(list.find((item) => item.label === 'chat.input.generate_image_geometry.automatic')?.isSelected).toBe(true)
  })
  it('retains an unavailable saved selection and leaves reset accessible', () => {
    mocks.saved = { aspectRatio: 'ASPECT_4_3' }
    const list = open()
    expect(list.find((item) => item.label === '4:3')).toMatchObject({
      disabled: true,
      isSelected: true,
      description: 'chat.input.generate_image_geometry.unavailable'
    })
    expect(list.find((item) => item.label === 'chat.input.generate_image_geometry.automatic')?.disabled).not.toBe(true)
  })
  it.each([
    [{ data: undefined, isLoading: true }, 'common.loading'],
    [
      { data: undefined, isLoading: false, error: new Error('offline') },
      'chat.input.generate_image_geometry.load_failed'
    ],
    [
      {
        data: { modes: { generate: { supports: { imageResolution: { type: 'enum', options: ['2K'] } } } } },
        isLoading: false
      },
      'chat.input.generate_image_geometry.no_presets'
    ]
  ])('distinguishes loading, failure and no presets', (state, label) => {
    mockUseQuery.mockReturnValue({ ...state, isRefreshing: false, refetch: vi.fn(), mutate: vi.fn() } as never)
    expect(open().find((item) => item.label === label)?.disabled).toBe(true)
  })
})
