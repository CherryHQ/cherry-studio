// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { preferenceValues, setFullScreenMock } = vi.hoisted(() => ({
  preferenceValues: {} as Record<string, unknown>,
  setFullScreenMock: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn()
    })
  }
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: (key: string) => [preferenceValues[key] ?? false, vi.fn()],
  useMultiplePreferences: () => [preferenceValues, vi.fn()]
}))

vi.mock('@renderer/config/constant', () => ({
  platform: 'win32'
}))

vi.mock('@renderer/hooks/useAppInit', () => ({
  useAppInit: vi.fn()
}))

vi.mock('@renderer/components/AppModal', () => ({
  default: () => null
}))

vi.mock('@cherrystudio/ui', () => ({
  Box: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>
}))

vi.mock('../toast', () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useToasts: () => ({
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    loading: vi.fn()
  })
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

import { CommandProvider, ContextKeyProvider } from '@renderer/commands'

import TopViewContainer from '..'

const renderTopView = () =>
  render(
    <ContextKeyProvider>
      <CommandProvider>
        <TopViewContainer>
          <div />
        </TopViewContainer>
      </CommandProvider>
    </ContextKeyProvider>
  )

const dispatchEscape = () => {
  const event = new KeyboardEvent('keydown', {
    key: 'Escape',
    code: 'Escape',
    cancelable: true
  })
  const preventDefault = vi.spyOn(event, 'preventDefault')
  window.dispatchEvent(event)
  return preventDefault
}

describe('TopView fullscreen command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const key of Object.keys(preferenceValues)) {
      delete preferenceValues[key]
    }
    setFullScreenMock.mockResolvedValue(undefined)
    window.api = {
      command: {
        onExecuteFromNativeMenu: vi.fn(() => vi.fn())
      },
      windowManager: {
        setFullScreen: setFullScreenMock
      }
    } as unknown as typeof window.api
  })

  afterEach(() => {
    cleanup()
  })

  it('handles app.fullscreen.exit through the renderer command dispatcher', async () => {
    renderTopView()

    const preventDefault = dispatchEscape()

    await waitFor(() => {
      expect(setFullScreenMock).toHaveBeenCalledWith(false)
    })
    expect(preventDefault).toHaveBeenCalledOnce()
  })

  it('does not handle Escape when the command shortcut is disabled', async () => {
    preferenceValues['app.fullscreen.exit'] = {
      binding: ['Escape'],
      enabled: false
    }

    renderTopView()

    const preventDefault = dispatchEscape()

    await waitFor(() => {
      expect(setFullScreenMock).not.toHaveBeenCalled()
    })
    expect(preventDefault).not.toHaveBeenCalled()
  })
})
