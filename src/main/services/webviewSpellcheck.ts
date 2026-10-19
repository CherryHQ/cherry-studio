import { app, session, webContents } from 'electron'

import { application } from '@application'
import { loggerService } from '@logger'
import { getWebviewPartition, WebviewSecurityProfile } from '@shared/utils/webviewSecurity'

const logger = loggerService.withContext('WebviewSpellcheck')

/**
 * The agent browser's partitions. Their spellcheck follows
 * `app.browser.spellcheck`; every other webview keeps following the global
 * `app.spell_check.*` preference. Electron does not expose a session's
 * partition, so identity against `fromPartition` is the only handle we have.
 */
const BROWSER_PARTITIONS = [
  getWebviewPartition(WebviewSecurityProfile.AgentBrowser),
  getWebviewPartition(WebviewSecurityProfile.AgentDevPreview),
  getWebviewPartition(WebviewSecurityProfile.AgentHtmlArtifact)
] as const

export function isBrowserSession(target: Electron.Session): boolean {
  return BROWSER_PARTITIONS.some((partition) => target === session.fromPartition(partition))
}

export interface SpellcheckPolicy {
  enabled: boolean
  languages: string[]
}

const DISABLED: SpellcheckPolicy = { enabled: false, languages: [] }

/**
 * Chromium fetches a Hunspell dictionary from Google's CDN for every language in
 * a session's spellchecker list, and it does so when the session is created.
 * Neither `webPreferences.spellcheck: false` nor `setSpellCheckerEnabled(false)`
 * stops that fetch, and `webRequest` never sees it. An empty language list is
 * the only in-process gate: with no languages there is nothing to download.
 *
 * The gate therefore fails closed: sessions created before preferences are
 * readable, and sessions whose preference is off, start with no languages.
 * `applyWebviewSpellcheckPolicy` and the webview attachment path restore them
 * once the user opts in.
 */
function readEnabled(key: 'app.browser.spellcheck' | 'app.spell_check.enabled'): boolean {
  try {
    return application.get('PreferenceService').get(key)
  } catch (error) {
    logger.warn('Spellcheck preference unavailable; keeping dictionaries gated', { error })
    return false
  }
}

/** Applies a policy to one session. Invalid language codes make Chromium throw, so filter them. */
export function applySpellcheck(target: Electron.Session, policy: SpellcheckPolicy): void {
  target.setSpellCheckerEnabled(policy.enabled)
  const supported = policy.languages.filter((language) => target.availableSpellCheckerLanguages.includes(language))
  target.setSpellCheckerLanguages(supported)
}

/**
 * Re-applies the browser policy to the agent browser sessions. Call at ready
 * and whenever `app.browser.spellcheck` / the language list changes.
 */
export function applyWebviewSpellcheckPolicy(): void {
  const enabled = readEnabled('app.browser.spellcheck')
  let languages: string[] = []
  if (enabled) {
    try {
      languages = application.get('PreferenceService').get('app.spell_check.languages')
    } catch (error) {
      logger.warn('Spellcheck languages unavailable; leaving the browser gated', { error })
    }
  }
  const policy = { enabled, languages }
  for (const partition of BROWSER_PARTITIONS) {
    applySpellcheck(session.fromPartition(partition), policy)
  }
  for (const contents of webContents.getAllWebContents()) {
    if (contents.getType() === 'webview' && isBrowserSession(contents.session)) {
      applySpellcheck(contents.session, policy)
    }
  }
}

/**
 * Installs the session-created gate. Must run during preboot, before any webview
 * session exists: the dictionary fetch starts at session construction, so a
 * listener registered later would only see sessions that are already fetching.
 *
 * `defaultSession` (app windows) is left alone: it has its own preference and
 * clearing its languages would silently disable spell checking in the editor.
 */
export function installWebviewSpellcheckGate(): () => void {
  const onCreated = (created: Electron.Session) => {
    if (created === session.defaultSession) return

    if (!app.isReady()) {
      applySpellcheck(created, DISABLED)
      return
    }

    const allowed = isBrowserSession(created)
      ? readEnabled('app.browser.spellcheck')
      : readEnabled('app.spell_check.enabled')
    if (!allowed) applySpellcheck(created, DISABLED)
  }
  app.on('session-created', onCreated)
  return () => app.removeListener('session-created', onCreated)
}
