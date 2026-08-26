import type { ComposerToolLauncher } from '@renderer/components/composer/toolLauncher'
import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUsePreference, mockRequest, mockToastError, mockAttachImageBytes, ipcHandlers } = vi.hoisted(() => ({
  mockUsePreference: vi.fn(),
  mockRequest: vi.fn(),
  mockToastError: vi.fn(),
  mockAttachImageBytes: vi.fn(),
  ipcHandlers: new Map<string, (payload: { pngBytes: Uint8Array }) => void>()
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: (...args: unknown[]) => mockUsePreference(...args)
}))
vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: mockRequest },
  useIpcOn: (event: string, handler: (payload: { pngBytes: Uint8Array }) => void) => {
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

/** Replays the `screenshot.captured` event main directs at the requesting window. */
const emitCaptured = async (pngBytes = PNG_BYTES) => {
  ipcHandlers.get('screenshot.captured')?.({ pngBytes })
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

  it('attaches the bytes the capture delivered', async () => {
    renderRuntime()

    await emitCaptured()

    // Straight from the event, so anything the user copies in between is irrelevant.
    expect(mockAttachImageBytes).toHaveBeenCalledWith('screenshot.png', PNG_BYTES, setFiles)
    expect(mockToastError).not.toHaveBeenCalled()
  })

  it('reports a temporary file it could not read back instead of doing nothing', async () => {
    mockAttachImageBytes.mockResolvedValue(false)
    renderRuntime()

    await emitCaptured()

    expect(mockToastError).toHaveBeenCalledWith('chat.input.screenshot_attach_failed')
  })
})
