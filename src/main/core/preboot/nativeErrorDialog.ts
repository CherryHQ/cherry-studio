import { app, clipboard, dialog, shell } from 'electron'

import { loggerService } from '@logger'
import { resolveSystemLanguage, t } from '@main/i18n'

const logger = loggerService.withContext('nativeErrorDialog')

const SUPPORT_EMAIL = 'support@cherry-ai.com'
const FEEDBACK_URL = `mailto:${SUPPORT_EMAIL}?subject=Cherry%20Studio%20Feedback`
const DOWNLOAD_URLS = { global: 'https://cherryai.com/download', cn: 'https://cherryai.com.cn/download' } as const

/** A support failure whose message is already the localized line to show. */
class SupportActionFailure extends Error {}

/** Loaded lazily: preboot dialogs can open before the app root that names the edition is readable. */
async function officialDownloadUrl(): Promise<string> {
  try {
    const { getAppEdition } = await import('@main/utils/appEdition')
    return DOWNLOAD_URLS[getAppEdition()]
  } catch {
    return DOWNLOAD_URLS.global
  }
}

type DialogLanguage = ReturnType<typeof resolveSystemLanguage>

interface SupportedDialogAction {
  readonly label: string
  readonly run: () => Promise<void>
}

interface SupportedDialogInput {
  readonly box: Electron.MessageBoxOptions
  /** Copied on request. Kept off the primary message so private paths stay out of it. */
  readonly technicalDetail?: string
  /** Support-chrome catalog. Omitted callers keep the system language, which preboot already used. */
  readonly language?: DialogLanguage
  /** One extra button. The dialog does not interpret it. */
  readonly action?: SupportedDialogAction
}

/** Native dialogs stack every button; past four they stop reading as a choice. */
const MAX_BUTTONS = 4

/** Caller action first, then support, trimmed so the whole row stays within MAX_BUTTONS. */
function supportActions(
  input: SupportedDialogInput,
  language: DialogLanguage,
  primaryLength: number
): SupportedDialogAction[] {
  const copyAndFeedback: SupportedDialogAction = {
    label: t('dialog.support.copy_and_feedback', undefined, language),
    run: async () => {
      let copyError: unknown
      try {
        await clipboard.writeText(input.technicalDetail ?? input.box.message)
      } catch (error) {
        copyError = error
      }
      try {
        await shell.openExternal(FEEDBACK_URL)
      } catch (error) {
        if (copyError) throw error
        // The error is on the clipboard; say so and name where to send it.
        throw new SupportActionFailure(t('dialog.support.copied_feedback_failed', { email: SUPPORT_EMAIL }, language))
      }
      if (copyError) throw copyError
    }
  }
  const releases: SupportedDialogAction = {
    label: t('dialog.support.releases', undefined, language),
    run: async () => {
      await shell.openExternal(await officialDownloadUrl())
    }
  }
  const actions = input.action ? [input.action, copyAndFeedback, releases] : [copyAndFeedback, releases]
  return actions.slice(0, Math.max(0, MAX_BUTTONS - primaryLength))
}

function failureLine(language: DialogLanguage): string {
  return t('dialog.support.failed', undefined, language)
}

function cancelIndex(cancelId: number | undefined, primaryLength: number): number {
  if (typeof cancelId === 'number' && cancelId >= 0 && cancelId < primaryLength) return cancelId
  return 0
}

/**
 * Show the original dialog, then the caller action (if any), "Copy error and send
 * feedback", and "Open download page", capped at four buttons in total. Support
 * choices loop back to the same dialog. The returned index is always one of the
 * original buttons. A response outside that set returns the original cancel
 * button and does not ask again. Technical text is copied on request and is not
 * placed on the dialog options.
 */
export async function showSupportedMessageBox(input: SupportedDialogInput): Promise<number> {
  if (typeof app.isReady === 'function' && !app.isReady()) await app.whenReady()
  const language = input.language ?? resolveSystemLanguage(app.getLocale())
  const primary = input.box.buttons ?? [t('dialog.support.ok', undefined, language)]
  const support = supportActions(input, language, primary.length)
  const cancelId = cancelIndex(input.box.cancelId, primary.length)
  let failure = ''
  for (;;) {
    const result = await dialog.showMessageBox({
      ...input.box,
      buttons: [...primary, ...support.map((item) => item.label)],
      detail: failure ? [input.box.detail, failure].filter(Boolean).join('\n\n') : input.box.detail
    })
    const response = result?.response
    const supportIndex = typeof response === 'number' ? response - primary.length : -1
    const action = supportIndex >= 0 ? support[supportIndex] : undefined
    if (!action) return typeof response === 'number' && response >= 0 && response < primary.length ? response : cancelId
    try {
      await action.run()
      failure = ''
    } catch (error) {
      logger.warn('Support action failed', error as Error)
      failure = error instanceof SupportActionFailure ? error.message : failureLine(language)
    }
  }
}
