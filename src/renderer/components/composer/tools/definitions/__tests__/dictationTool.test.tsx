import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { useMemo } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ComposerToolRuntimeProvider, useComposerToolDispatch } from '@renderer/components/composer/ComposerToolRuntime'
import type { ComposerToolLauncher } from '@renderer/components/composer/toolLauncher'
import { getComposerToolbarManifestsForScope } from '@renderer/components/composer/tools/toolbarManifests'
import { type ComposerToolScope, TopicType } from '@renderer/components/composer/tools/types'
import { ComposerDictationButton } from '@renderer/components/composer/variants/shared/ComposerDictationButton'
import { QuickPanelProvider } from '@renderer/components/QuickPanel'
import enUS from '@renderer/i18n/locales/en-us.json'

const mocks = vi.hoisted(() => ({
  cancel: vi.fn(async () => {}),
  copyRecovery: vi.fn(async () => true),
  discard: vi.fn(async () => {}),
  insertRecovery: vi.fn(() => 'inserted' as const),
  listener: undefined as (() => void) | undefined,
  listeners: new Set<() => void>(),
  openSettingsTab: vi.fn(),
  retry: vi.fn(async () => {}),
  snapshot: { phase: 'idle', elapsedMs: 0, recoveryAvailable: false } as any,
  startScoped: vi.fn(),
  stop: vi.fn(async () => {}),
  transcribeRecording: vi.fn(async () => {})
}))

vi.mock('@renderer/services/mainWindowNavigation', () => ({
  openSettingsTab: mocks.openSettingsTab
}))

vi.mock('@renderer/services/voice', () => ({
  dictationService: {
    subscribe: (listener: () => void) => {
      mocks.listeners.add(listener)
      mocks.listener = () => mocks.listeners.forEach((notify) => notify())
      return () => {
        mocks.listeners.delete(listener)
      }
    },
    getSnapshot: () => mocks.snapshot,
    startScoped: mocks.startScoped,
    stop: mocks.stop,
    transcribeRecording: mocks.transcribeRecording,
    cancel: mocks.cancel,
    retry: mocks.retry,
    insertRecovery: mocks.insertRecovery,
    copyRecovery: mocks.copyRecovery,
    discard: mocks.discard
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: translate })
}))

import dictationTool from '../dictationTool'

const testI18n = createInstance()
await testI18n.init({ lng: 'en-US', keySeparator: false, resources: { 'en-US': { translation: enUS } } })
const translate = testI18n.t.bind(testI18n)

function renderRuntime(scope: ComposerToolScope = TopicType.Chat) {
  const launchers: ComposerToolLauncher[][] = []
  const registerLaunchers = vi.fn((next: ComposerToolLauncher[]) => {
    launchers.push(next)
    return vi.fn()
  })
  const Runtime = dictationTool.composer!.runtime!
  function RuntimeWithButton() {
    const { toolsRegistry } = useComposerToolDispatch()
    const launcher = useMemo(
      () => ({
        registerLaunchers: (next: ComposerToolLauncher[]) => {
          registerLaunchers(next)
          return toolsRegistry.registerLaunchers('dictation', next)
        }
      }),
      [toolsRegistry]
    )
    return (
      <>
        <Runtime
          context={
            {
              scope,
              launcher,
              t: translate
            } as any
          }
        />
        <ComposerDictationButton />
      </>
    )
  }
  render(
    <QuickPanelProvider>
      <ComposerToolRuntimeProvider actions={{ addNewTopic: vi.fn(), onTextChange: vi.fn() }}>
        <RuntimeWithButton />
      </ComposerToolRuntimeProvider>
    </QuickPanelProvider>
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
    mocks.transcribeRecording.mockClear()
  })

  it('starts scoped dictation only after the user invokes the launcher and passes no preference overrides', async () => {
    const rendered = renderRuntime()
    await waitFor(() => expect(latestLauncher(rendered)).toBeDefined())

    expect(mocks.startScoped).not.toHaveBeenCalled()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Start dictation' }))

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
    expect(launcher.description).toBe('Recording')
    expect(launcher.suffix).toBe('3 s')
    expect(screen.getByText('3 s')).toBeVisible()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Stop recording' }))
    expect(mocks.stop).toHaveBeenCalledOnce()

    launcher.submenu?.find((item) => item.id === 'dictation:cancel')?.action?.({} as never)
    expect(mocks.cancel).toHaveBeenCalledOnce()
  })

  it('returns to the inactive microphone after no speech instead of leaving an empty recording capsule', async () => {
    mocks.snapshot = { phase: 'recording', elapsedMs: 3200, recoveryAvailable: false }
    const rendered = renderRuntime()
    expect(await screen.findByRole('button', { name: 'Stop recording' })).toBeEnabled()
    // data-slot is the shared visualizer's semantic hook; a completed capture must remove the spectrum.
    expect(document.querySelector('[data-slot="bar-visualizer"]')).not.toBeNull()

    act(() => {
      mocks.snapshot = { phase: 'failed', error: 'no_speech', elapsedMs: 0, recoveryAvailable: false }
      mocks.listener?.()
    })

    expect(await screen.findByRole('button', { name: 'Start dictation' })).toBeEnabled()
    expect(latestLauncher(rendered)?.active).toBe(false)
    expect(latestLauncher(rendered)?.description).toBe(enUS['settings.voice.status.no_speech'])
    expect(document.querySelector('[data-slot="bar-visualizer"]')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Retry transcription' })).not.toBeInTheDocument()
    expect(screen.queryByText('3 s')).not.toBeInTheDocument()
  })

  it.each([
    { phase: 'failed', retryAvailable: true, recoveryAvailable: false, error: 'transcription_failed' },
    { phase: 'recorded', recoveryAvailable: false },
    { phase: 'recovery', recoveryAvailable: true }
  ])('lets the user discard retained $phase data from the visible composer and start again', async (state) => {
    mocks.snapshot = { ...state, elapsedMs: 1000 }
    mocks.discard.mockImplementationOnce(async () => {
      mocks.snapshot = { phase: 'idle', elapsedMs: 0, recoveryAvailable: false }
      mocks.listener?.()
    })
    renderRuntime()

    const discard = await screen.findByRole('button', { name: 'Discard' })
    expect(screen.queryByRole('button', { name: 'Start dictation' })).not.toBeInTheDocument()
    expect(mocks.discard).not.toHaveBeenCalled()
    await userEvent.setup().click(discard)

    expect(await screen.findByRole('button', { name: 'Start dictation' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Discard' })).not.toBeInTheDocument()
    expect(mocks.discard).toHaveBeenCalledOnce()
    expect(mocks.startScoped).not.toHaveBeenCalled()
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
    expect(launcher.label).toBe('Cancel dictation')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Cancel dictation' }))
    expect(mocks.cancel).toHaveBeenCalledOnce()
  })

  it('offers explicit transcription of an interrupted recording without starting a new capture', async () => {
    mocks.snapshot = { phase: 'recorded', elapsedMs: 1000, recoveryAvailable: false }
    const rendered = renderRuntime()
    const button = await screen.findByRole('button', { name: 'Transcribe' })

    expect(latestLauncher(rendered)?.description).toBe('Ready to transcribe')
    expect(mocks.transcribeRecording).not.toHaveBeenCalled()
    await userEvent.setup().click(button)
    expect(mocks.transcribeRecording).toHaveBeenCalledOnce()
    expect(mocks.startScoped).not.toHaveBeenCalled()

    latestLauncher(rendered)
      ?.submenu?.find((item) => item.id === 'dictation:discard')
      ?.action?.({} as never)
    expect(mocks.discard).toHaveBeenCalledOnce()
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
    expect(launcher.description).toBe(enUS['settings.voice.status.unconfigured'])
    expect(launcher.disabled).toBe(false)
    launcher.submenu?.find((item) => item.id === 'dictation:open-settings')?.action?.({} as never)
    expect(mocks.openSettingsTab).toHaveBeenCalledWith('/settings/voice')
  })

  it.each([TopicType.Chat, TopicType.Session, 'painting'] as const)(
    'keeps %s dictation in the menu without a duplicate toolbar entry',
    (scope) => {
      const rendered = renderRuntime(scope)

      expect(latestLauncher(rendered)!.sources).toEqual(['root-panel'])
      expect(getComposerToolbarManifestsForScope(scope, translate as never).map((tool) => tool.id)).not.toContain(
        'dictation'
      )
    }
  )
})
