import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { app, session, webContents } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getWebviewPartition, WebviewSecurityProfile } from '@shared/utils/webviewSecurity'

import { applyWebviewSpellcheckPolicy, installWebviewSpellcheckGate, isBrowserSession } from '../webviewSpellcheck'

const BROWSER_PARTITIONS = [
  getWebviewPartition(WebviewSecurityProfile.AgentBrowser),
  getWebviewPartition(WebviewSecurityProfile.AgentDevPreview),
  getWebviewPartition(WebviewSecurityProfile.AgentHtmlArtifact)
] as const

function browserSession(partition: string): Electron.Session {
  return session.fromPartition(partition)
}

function foreignSession() {
  return {
    availableSpellCheckerLanguages: ['en-US', 'de'],
    setSpellCheckerEnabled: vi.fn(),
    setSpellCheckerLanguages: vi.fn()
  } as unknown as Electron.Session
}

function createdListener(): (created: Electron.Session) => void {
  const calls = vi.mocked(app.on).mock.calls as unknown as Array<[string, (created: Electron.Session) => void]>
  const call = calls.find(([event]) => event === 'session-created')
  if (!call) throw new Error('the gate did not subscribe to session-created')
  return call[1]
}

beforeEach(() => {
  MockMainPreferenceServiceUtils.resetMocks()
  vi.mocked(app.isReady).mockReturnValue(true)
  vi.mocked(app.on).mockClear()
  vi.mocked(app.removeListener).mockClear()
  vi.mocked(webContents.getAllWebContents).mockReturnValue([])
  for (const partition of BROWSER_PARTITIONS) {
    vi.mocked(session.fromPartition(partition).setSpellCheckerEnabled).mockClear()
    vi.mocked(session.fromPartition(partition).setSpellCheckerLanguages).mockClear()
  }
})

afterEach(() => {
  vi.mocked(app.isReady).mockReturnValue(true)
})

describe('isBrowserSession', () => {
  it('recognises the agent browser sessions only', () => {
    for (const partition of BROWSER_PARTITIONS) {
      expect(isBrowserSession(browserSession(partition))).toBe(true)
    }
    expect(isBrowserSession(session.fromPartition('persist:webview'))).toBe(false)
    expect(isBrowserSession(foreignSession())).toBe(false)
  })
})

describe('session-created gate', () => {
  let dispose: () => void

  afterEach(() => dispose())

  it('leaves the default session to the global preference', () => {
    dispose = installWebviewSpellcheckGate()
    const defaultSession = session.defaultSession
    const setEnabled = vi.mocked(defaultSession.setSpellCheckerEnabled)
    setEnabled.mockClear()

    createdListener()(defaultSession)

    expect(setEnabled).not.toHaveBeenCalled()
  })

  it('clears a webview session created before preferences load', () => {
    dispose = installWebviewSpellcheckGate()
    vi.mocked(app.isReady).mockReturnValue(false)
    const created = foreignSession()

    createdListener()(created)

    expect(created.setSpellCheckerEnabled).toHaveBeenCalledWith(false)
    expect(created.setSpellCheckerLanguages).toHaveBeenCalledWith([])
  })

  it('gates a browser session while the browser preference is off', () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('app.spell_check.enabled', true)
    dispose = installWebviewSpellcheckGate()
    const created = browserSession(BROWSER_PARTITIONS[0])

    createdListener()(created)

    expect(created.setSpellCheckerEnabled).toHaveBeenLastCalledWith(false)
    expect(created.setSpellCheckerLanguages).toHaveBeenLastCalledWith([])
  })

  it('leaves a browser session alone once the browser preference is on', () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('app.browser.spellcheck', true)
    dispose = installWebviewSpellcheckGate()
    const created = browserSession(BROWSER_PARTITIONS[0])

    createdListener()(created)

    expect(created.setSpellCheckerEnabled).not.toHaveBeenCalled()
    expect(created.setSpellCheckerLanguages).not.toHaveBeenCalled()
  })

  it('keeps a mini-app session on the global preference', () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('app.spell_check.enabled', true)
    dispose = installWebviewSpellcheckGate()
    const created = foreignSession()

    createdListener()(created)

    expect(created.setSpellCheckerEnabled).not.toHaveBeenCalled()
  })

  it('gates a mini-app session when the global preference is off', () => {
    dispose = installWebviewSpellcheckGate()
    const created = foreignSession()

    createdListener()(created)

    expect(created.setSpellCheckerEnabled).toHaveBeenCalledWith(false)
  })

  it('unsubscribes on dispose', () => {
    const stop = installWebviewSpellcheckGate()
    const listener = createdListener()
    dispose = () => {}

    stop()

    expect(app.removeListener).toHaveBeenCalledWith('session-created', listener)
  })
})

describe('applyWebviewSpellcheckPolicy', () => {
  it('writes the browser preference onto every agent browser session', () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('app.browser.spellcheck', true)
    MockMainPreferenceServiceUtils.setPreferenceValue('app.spell_check.languages', ['en-US', 'not-a-language'])

    applyWebviewSpellcheckPolicy()

    for (const partition of BROWSER_PARTITIONS) {
      const target = session.fromPartition(partition)
      expect(vi.mocked(target.setSpellCheckerEnabled)).toHaveBeenLastCalledWith(true)
      expect(vi.mocked(target.setSpellCheckerLanguages)).toHaveBeenLastCalledWith(['en-US'])
    }
  })

  it('gates every agent browser session when the preference is off', () => {
    applyWebviewSpellcheckPolicy()

    for (const partition of BROWSER_PARTITIONS) {
      const target = session.fromPartition(partition)
      expect(vi.mocked(target.setSpellCheckerEnabled)).toHaveBeenLastCalledWith(false)
      expect(vi.mocked(target.setSpellCheckerLanguages)).toHaveBeenLastCalledWith([])
    }
  })
})
