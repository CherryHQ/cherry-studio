import { app, clipboard, dialog, shell } from 'electron'

import { loggerService } from '@logger'
import { resolveSystemLanguage, t } from '@main/i18n'
import { FEEDBACK_MAILTO, officialDownloadUrl, SUPPORT_EMAIL } from '@shared/utils/officialLinks'

const logger = loggerService.withContext('nativeErrorDialog')

/** A support failure whose message is already the localized line to show. */
class SupportActionFailure extends Error {}

/** Loaded lazily: preboot dialogs can open before the app root that names the edition is readable. */
async function editionDownloadUrl(): Promise<string> {
  try {
    const { getAppEdition } = await import('@main/utils/appEdition')
    return officialDownloadUrl(getAppEdition())
  } catch {
    return officialDownloadUrl('global')
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
}

function supportActions(input: SupportedDialogInput, language: DialogLanguage): SupportedDialogAction[] {
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
        await shell.openExternal(FEEDBACK_MAILTO)
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
      await shell.openExternal(await editionDownloadUrl())
    }
  }
  return [copyAndFeedback, releases]
}

function cancelIndex(cancelId: number | undefined, primaryLength: number): number {
  if (typeof cancelId === 'number' && cancelId >= 0 && cancelId < primaryLength) return cancelId
  return 0
}

async function runAction(action: SupportedDialogAction, language: DialogLanguage): Promise<string> {
  try {
    await action.run()
    return ''
  } catch (error) {
    logger.warn('Support action failed', error as Error)
    return error instanceof SupportActionFailure ? error.message : t('dialog.support.failed', undefined, language)
  }
}

/**
 * Show the original dialog with "Copy error and send feedback" and "Open download
 * page" after the caller buttons. A support action reopens the same dialog, with a
 * line when it failed. The returned index is a caller button; any other response
 * returns the original cancel button. Technical text is copied on request and is
 * not placed on the dialog options.
 */
export async function showSupportedMessageBox(input: SupportedDialogInput): Promise<number> {
  if (typeof app.isReady === 'function' && !app.isReady()) await app.whenReady()
  const language = input.language ?? resolveSystemLanguage(app.getLocale())
  const primary = input.box.buttons ?? [t('dialog.support.ok', undefined, language)]
  const support = supportActions(input, language)
  const cancelId = cancelIndex(input.box.cancelId, primary.length)
  let notice = ''
  for (;;) {
    const result = await dialog.showMessageBox({
      ...input.box,
      buttons: [...primary, ...support.map((item) => item.label)],
      // Without it Electron may map Escape to a support action.
      cancelId,
      detail: notice ? [input.box.detail, notice].filter(Boolean).join('\n\n') : input.box.detail
    })
    const response = result?.response
    if (typeof response !== 'number' || response < 0) return cancelId
    if (response < primary.length) return response
    const action = support[response - primary.length]
    if (!action) return cancelId
    notice = await runAction(action, language)
  }
}
