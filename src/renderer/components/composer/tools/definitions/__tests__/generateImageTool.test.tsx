import type { ComposerToolLauncher } from '@renderer/components/composer/toolLauncher'
import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUseAssistant, mockUsePreference, mockUpdateAssistant } = vi.hoisted(() => ({
  mockUseAssistant: vi.fn(),
  mockUsePreference: vi.fn(),
  mockUpdateAssistant: vi.fn()
}))

vi.mock('@renderer/hooks/useAssistant', () => ({
  useAssistant: (...args: unknown[]) => mockUseAssistant(...args)
}))
vi.mock('@data/hooks/usePreference', () => ({
  usePreference: (...args: unknown[]) => mockUsePreference(...args)
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

import generateImageTool from '../generateImageTool'

function renderRuntime() {
  const registerLaunchers = vi.fn<(launchers: ComposerToolLauncher[]) => () => void>(() => vi.fn())
  const Runtime = generateImageTool.composer?.runtime
  if (!Runtime) {
    throw new Error('generate image runtime should be registered')
  }
  render(<Runtime context={{ assistant: { id: 'a1' }, launcher: { registerLaunchers } } as any} />)
  return registerLaunchers
}

async function firstLauncher(registerLaunchers: ReturnType<typeof renderRuntime>) {
  await waitFor(() => expect(registerLaunchers).toHaveBeenCalled())
  return registerLaunchers.mock.calls[0][0][0]
}

describe('generateImageTool', () => {
  beforeEach(() => {
    mockUseAssistant.mockReset()
    mockUsePreference.mockReset()
    mockUpdateAssistant.mockReset()
    mockUseAssistant.mockReturnValue({
      assistant: { settings: { enableGenerateImage: false } },
      updateAssistant: mockUpdateAssistant
    })
    mockUsePreference.mockReturnValue(['openai::dall-e-3', vi.fn()])
  })

  it('registers a popover launcher gated on the assistant toggle', async () => {
    const launcher = await firstLauncher(renderRuntime())
    expect(launcher).toMatchObject({ id: 'generate-image', sources: ['popover'], active: false, disabled: false })
  })

  it('disables the launcher (with a hint) when no painting model is configured', async () => {
    mockUsePreference.mockReturnValue([null, vi.fn()])
    const launcher = await firstLauncher(renderRuntime())
    expect(launcher.disabled).toBe(true)
    expect(launcher.disabledReason).toBeTruthy()
  })

  it('persists the toggle to the assistant setting', async () => {
    const launcher = await firstLauncher(renderRuntime())
    launcher.action?.({} as never)
    expect(mockUpdateAssistant).toHaveBeenCalledWith({ settings: { enableGenerateImage: true } })
  })

  it('does not toggle when disabled (no painting model)', async () => {
    mockUsePreference.mockReturnValue([null, vi.fn()])
    const launcher = await firstLauncher(renderRuntime())
    launcher.action?.({} as never)
    expect(mockUpdateAssistant).not.toHaveBeenCalled()
  })

  it('reflects the enabled state as active', async () => {
    mockUseAssistant.mockReturnValue({
      assistant: { settings: { enableGenerateImage: true } },
      updateAssistant: mockUpdateAssistant
    })
    const launcher = await firstLauncher(renderRuntime())
    expect(launcher.active).toBe(true)
  })
})
