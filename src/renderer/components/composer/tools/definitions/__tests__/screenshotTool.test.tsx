import type { ComposerToolLauncher } from '@renderer/components/composer/toolLauncher'
import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUsePreference, mockRequest, mockToastError, mockAttachImageBytes, ipcHandlers } = vi.hoisted(() => ({
  mockUsePreference: vi.fn(),
  mockRequest: vi.fn(),
  mockToastError: vi.fn(),
  mockAttachImageBytes: vi.fn(),
  ipcHandlers: new Map<string, () => void>()
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: (...args: unknown[]) => mockUsePreference(...args)
}))
vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: mockRequest },
  useIpcOn: (event: string, handler: () => void) => {
    ipcHandlers.set(event, handler)
  }
}))
vi.mock('@renderer/services/toast', () => ({
  toast: { error: mockToastError }
}))
vi.mock('@renderer/components/composer/paste/pasteHandling', () => ({
  attachImageBytes: (...args: unknown[]) => mockAttachImageBytes(...args)
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

import screenshotTool from '../screenshotTool'

const PNG_BYTES = new Uint8Array([137, 80, 78, 71])
const setFiles = vi.fn()

/** A clipboard holding exactly the given MIME types, PNG payloads being the capture. */
const stubClipboard = (types: string[]) => {
  const read = vi.fn().mockResolvedValue([
    {
      types,
      getType: vi.fn().mockResolvedValue({ arrayBuffer: () => Promise.resolve(PNG_BYTES.buffer) })
    }
  ])
  vi.stubGlobal('navigator', { clipboard: { read } })
  return read
}

function renderRuntime({ extensions = ['.png'], couldAddImageFile = true } = {}) {
  const registerLaunchers = vi.fn<(launchers: ComposerToolLauncher[]) => () => void>(() => vi.fn())
  const Runtime = screenshotTool.composer?.runtime
  if (!Runtime) throw new Error('screenshot runtime should be registered')

  render(
    <Runtime
      context={
        {
          launcher: { registerLaunchers },
          state: { couldAddImageFile, extensions },
          actions: { setFiles }
        } as any
      }
    />
  )
  return registerLaunchers
}

const firstLauncher = async (registerLaunchers: ReturnType<typeof renderRuntime>) => {
  await waitFor(() => expect(registerLaunchers).toHaveBeenCalled())
  return registerLaunchers.mock.calls[0][0][0]
}

/** Replays the `screenshot.captured` event main sends once the clipboard is written. */
const emitCaptured = async () => {
  ipcHandlers.get('screenshot.captured')?.()
  await waitFor(() =>
    expect(mockAttachImageBytes.mock.calls.length + mockToastError.mock.calls.length).toBeGreaterThan(0)
  )
}

describe('screenshotTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ipcHandlers.clear()
    mockUsePreference.mockReturnValue([true, vi.fn()])
    mockAttachImageBytes.mockResolvedValue(true)
    stubClipboard(['image/png'])
  })

  it('does not offer the button when the screenshot feature is turned off', () => {
    mockUsePreference.mockReturnValue([false, vi.fn()])

    expect(renderRuntime()).not.toHaveBeenCalled()
  })

  it('starts a capture, letting main route the result back to this window', async () => {
    const launcher = await firstLauncher(renderRuntime())

    launcher.action?.({} as never)

    expect(mockRequest).toHaveBeenCalledWith('screenshot.capture')
  })

  it('disables the button when the composer cannot take an image', async () => {
    const launcher = await firstLauncher(renderRuntime({ couldAddImageFile: false }))

    expect(launcher.disabled).toBe(true)
    expect(launcher.disabledReason).toBeTruthy()
  })

  it('attaches the capture the clipboard received', async () => {
    renderRuntime()

    await emitCaptured()

    expect(mockAttachImageBytes).toHaveBeenCalledWith('screenshot.png', expect.any(Uint8Array), setFiles)
    expect(mockToastError).not.toHaveBeenCalled()
  })

  it('reports a capture that never reached the clipboard instead of doing nothing', async () => {
    stubClipboard(['text/plain'])
    renderRuntime()

    await emitCaptured()

    expect(mockAttachImageBytes).not.toHaveBeenCalled()
    expect(mockToastError).toHaveBeenCalledWith('chat.input.screenshot_attach_failed')
  })

  it('reports a temporary file it could not read back instead of doing nothing', async () => {
    mockAttachImageBytes.mockResolvedValue(false)
    renderRuntime()

    await emitCaptured()

    expect(mockToastError).toHaveBeenCalledWith('chat.input.screenshot_attach_failed')
  })
})
