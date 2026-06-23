import type { ComposerToolLauncher } from '@renderer/components/chat/composer/toolLauncher'
import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockIsGenerateImageModel } = vi.hoisted(() => ({
  mockIsGenerateImageModel: vi.fn()
}))

vi.mock('@renderer/config/models', () => ({
  isGenerateImageModel: (...args: unknown[]) => mockIsGenerateImageModel(...args)
}))

import generateImageTool from '../generateImageTool'

describe('generateImageTool', () => {
  beforeEach(() => {
    mockIsGenerateImageModel.mockReset()
  })

  it('registers generate image only for the plus menu', async () => {
    mockIsGenerateImageModel.mockReturnValue(true)
    const registerLaunchers = vi.fn<(launchers: ComposerToolLauncher[]) => () => void>(() => vi.fn())
    const Runtime = generateImageTool.composer?.runtime

    if (!Runtime) {
      throw new Error('generate image runtime should be registered')
    }

    render(
      <Runtime
        context={
          {
            launcher: { registerLaunchers },
            model: { id: 'image-model' },
            t: (key: string) => key
          } as any
        }
      />
    )

    await waitFor(() => expect(registerLaunchers).toHaveBeenCalled())

    const [generateImageLauncher] = vi.mocked(registerLaunchers).mock.calls[0][0]
    expect(generateImageLauncher).toMatchObject({
      id: 'generate-image',
      sources: ['popover']
    })
  })
})
