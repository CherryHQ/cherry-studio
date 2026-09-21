import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComposerToolLauncher } from '@renderer/components/composer/toolLauncher'

const mocks = vi.hoisted(() => ({
  cancel: vi.fn(async () => {}),
  copyRecovery: vi.fn(async () => true),
  discard: vi.fn(async () => {}),
  insertRecovery: vi.fn(() => 'inserted' as const),
  listener: undefined as (() => void) | undefined,
  openSettingsTab: vi.fn(),
  retry: vi.fn(async () => {}),
  snapshot: { phase: 'idle', elapsedMs: 0, recoveryAvailable: false } as any,
  startScoped: vi.fn(),
  stop: vi.fn(async () => {})
}))

vi.mock('@renderer/services/mainWindowNavigation', () => ({
  openSettingsTab: mocks.openSettingsTab
}))

vi.mock('@renderer/services/voice', () => ({
  dictationService: {
    subscribe: (listener: () => void) => {
      mocks.listener = listener
      return () => {
        if (mocks.listener === listener) mocks.listener = undefined
      }
    },
    getSnapshot: () => mocks.snapshot,
    startScoped: mocks.startScoped,
    stop: mocks.stop,
    cancel: mocks.cancel,
    retry: mocks.retry,
    insertRecovery: mocks.insertRecovery,
    copyRecovery: mocks.copyRecovery,
    discard: mocks.discard
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: { seconds?: number }) => `${key}${options?.seconds ?? ''}` })
}))

import dictationTool from '../dictationTool'

function renderRuntime() {
  const launchers: ComposerToolLauncher[][] = []
  const registerLaunchers = vi.fn((next: ComposerToolLauncher[]) => {
    launchers.push(next)
    return vi.fn()
  })
  const Runtime = dictationTool.composer?.runtime
  if (!Runtime) throw new Error('dictation runtime should be registered')
  render(
    <Runtime
      context={
        {
          launcher: { registerLaunchers },
          t: (key: string, options?: { seconds?: number }) => `${key}${options?.seconds ?? ''}`
        } as any
      }
    />
  )
  return { launchers, registerLaunchers }
}

function latestLauncher(rendered: ReturnType<typeof renderRuntime>) {
  return rendered.launchers.at(-1)?.[0]
}

describe('dictationTool', () => {
  beforeEach(() => {
    mocks.cancel.mockClear()
    mocks.copyRecovery.mockClear()
    mocks.discard.mockClear()
    mocks.insertRecovery.mockClear()
    mocks.openSettingsTab.mockClear()
    mocks.retry.mockClear()
    mocks.snapshot = { phase: 'idle', elapsedMs: 0, recoveryAvailable: false }
    mocks.startScoped.mockReset()
    mocks.startScoped.mockReturnValue({ result: Promise.resolve(), cancel: mocks.cancel })
    mocks.stop.mockClear()
  })

  it('starts scoped dictation only after the user invokes the launcher and passes no preference overrides', async () => {
    const rendered = renderRuntime()
    await waitFor(() => expect(latestLauncher(rendered)).toBeDefined())

    expect(mocks.startScoped).not.toHaveBeenCalled()
    latestLauncher(rendered)!.action?.({} as never)

    expect(mocks.startScoped).toHaveBeenCalledOnce()
    expect(mocks.startScoped).toHaveBeenCalledWith()
  })

  it('exposes recording status, elapsed time, stop, and cancel through one shared launcher', async () => {
    const rendered = renderRuntime()
    await waitFor(() => expect(latestLauncher(rendered)).toBeDefined())

    act(() => {
      mocks.snapshot = { phase: 'recording', elapsedMs: 3200, recoveryAvailable: false }
      mocks.listener?.()
    })

    const launcher = latestLauncher(rendered)!
    expect(launcher).toMatchObject({ active: true, disabled: false })
    expect(launcher.description).toBe('settings.voice.dictation.phase.recording')
    expect(launcher.suffix).toBe('settings.voice.dictation.elapsed3')
    launcher.action?.({} as never)
    expect(mocks.stop).toHaveBeenCalledOnce()

    launcher.submenu?.find((item) => item.id === 'dictation:cancel')?.action?.({} as never)
    expect(mocks.cancel).toHaveBeenCalledOnce()
  })

  it('offers explicit retry and recovery actions without inserting automatically', async () => {
    const rendered = renderRuntime()
    await waitFor(() => expect(latestLauncher(rendered)).toBeDefined())

    act(() => {
      mocks.snapshot = {
        phase: 'recovery',
        elapsedMs: 0,
        recoveryAvailable: true,
        retryAvailable: true
      }
      mocks.listener?.()
    })

    const submenu = latestLauncher(rendered)!.submenu ?? []
    expect(mocks.insertRecovery).not.toHaveBeenCalled()
    submenu.find((item) => item.id === 'dictation:retry')?.action?.({} as never)
    submenu.find((item) => item.id === 'dictation:insert-recovery')?.action?.({} as never)
    submenu.find((item) => item.id === 'dictation:copy-recovery')?.action?.({} as never)
    submenu.find((item) => item.id === 'dictation:discard')?.action?.({} as never)

    expect(mocks.retry).toHaveBeenCalledOnce()
    expect(mocks.insertRecovery).toHaveBeenCalledOnce()
    expect(mocks.copyRecovery).toHaveBeenCalledOnce()
    expect(mocks.discard).toHaveBeenCalledOnce()
  })

  it('keeps cancel available while transcription is processing', async () => {
    const rendered = renderRuntime()
    await waitFor(() => expect(latestLauncher(rendered)).toBeDefined())

    act(() => {
      mocks.snapshot = { phase: 'transcribing', elapsedMs: 1000, recoveryAvailable: false }
      mocks.listener?.()
    })

    const launcher = latestLauncher(rendered)!
    expect(launcher.disabled).toBe(false)
    expect(launcher.label).toBe('chat.input.dictation.action.cancel')
    launcher.action?.({} as never)
    expect(mocks.cancel).toHaveBeenCalledOnce()
  })

  it('keeps configuration failures discoverable with localized detail and a Voice Settings recovery action', async () => {
    const rendered = renderRuntime()
    await waitFor(() => expect(latestLauncher(rendered)).toBeDefined())

    act(() => {
      mocks.snapshot = {
        phase: 'failed',
        elapsedMs: 0,
        recoveryAvailable: false,
        error: 'model_required'
      }
      mocks.listener?.()
    })

    const launcher = latestLauncher(rendered)!
    expect(launcher.description).toBe('settings.voice.status.unconfigured')
    expect(launcher.disabled).toBe(false)
    launcher.submenu?.find((item) => item.id === 'dictation:open-settings')?.action?.({} as never)
    expect(mocks.openSettingsTab).toHaveBeenCalledWith('/settings/voice')
  })
})
