import { app, clipboard, dialog, shell } from 'electron'

import { loggerService } from '@logger'
import { resolveSystemLanguage, t } from '@main/i18n'
import { FEEDBACK_MAILTO, officialDownloadUrl, SUPPORT_EMAIL } from '@shared/utils/officialLinks'

const logger = loggerService.withContext('nativeErrorDialog')

/** A support failure whose message is already the localized line to show. */
export class SupportActionFailure extends Error {}

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
  /** A returned line is shown on the dialog when it reopens. */
  readonly run: () => Promise<string | void>
}

interface SupportedDialogInput {
  readonly box: Electron.MessageBoxOptions
  /** Copied on request. Kept off the primary message so private paths stay out of it. */
  readonly technicalDetail?: string
  /** Support-chrome catalog. Omitted callers keep the system language, which preboot already used. */
  readonly language?: DialogLanguage
  /** Non-primary caller choices. Choosing one returns `box.buttons.length + index`. */
  readonly secondaryButtons?: readonly string[]
  /** One extra non-closing action, e.g. diagnostics export. The dialog does not interpret it. */
  readonly action?: SupportedDialogAction
}

// Past four buttons a native dialog stops reading as a choice, so two or more secondary entries fold
// behind "More…"; a single one stays on the row, since "More…" would only take its slot.
const MAX_BUTTONS = 4

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

/** A secondary entry either closes the dialog with a caller index or runs and returns to it. */
type SecondaryEntry = { readonly label: string; readonly response: number } | SupportedDialogAction

function cancelIndex(cancelId: number | undefined, primaryLength: number): number {
  if (typeof cancelId === 'number' && cancelId >= 0 && cancelId < primaryLength) return cancelId
  return 0
}

async function runAction(action: SupportedDialogAction, language: DialogLanguage): Promise<string> {
  try {
    return (await action.run()) ?? ''
  } catch (error) {
    logger.warn('Support action failed', error as Error)
    return error instanceof SupportActionFailure ? error.message : t('dialog.support.failed', undefined, language)
  }
}

/**
 * Show the original dialog with "Copy error and send feedback" and "Open download
 * page" always on the first row next to the caller buttons. Secondary entries
 * (`secondaryButtons`, then `action`) join that row when there is only one or the
 * row stays within four buttons, else they move behind "More…", a second box with
 * Cancel. Actions loop back to the same dialog. The returned index is a caller button or secondary
 * choice; any other response returns the original cancel button. Technical text
 * is copied on request and is not placed on the dialog options.
 */
export async function showSupportedMessageBox(input: SupportedDialogInput): Promise<number> {
  if (typeof app.isReady === 'function' && !app.isReady()) await app.whenReady()
  const language = input.language ?? resolveSystemLanguage(app.getLocale())
  const primary = input.box.buttons ?? [t('dialog.support.ok', undefined, language)]
  const support = supportActions(input, language)
  const secondary: SecondaryEntry[] = [
    ...(input.secondaryButtons ?? []).map((label, index) => ({ label, response: primary.length + index })),
    ...(input.action ? [input.action] : [])
  ]
  const inline = secondary.length <= 1 || primary.length + support.length + secondary.length <= MAX_BUTTONS
  const more = t('dialog.support.more', undefined, language)
  const row: SecondaryEntry[] = inline ? [...secondary, ...support] : support
  const cancelId = cancelIndex(input.box.cancelId, primary.length)
  let notice = ''
  for (;;) {
    const result = await dialog.showMessageBox({
      ...input.box,
      buttons: [...primary, ...row.map((item) => item.label), ...(inline ? [] : [more])],
      detail: notice ? [input.box.detail, notice].filter(Boolean).join('\n\n') : input.box.detail
    })
    const response = result?.response
    if (typeof response !== 'number' || response < 0) return cancelId
    if (response < primary.length) return response
    let entry: SecondaryEntry | undefined = row[response - primary.length]
    if (!entry && !inline && response === primary.length + row.length) {
      entry = await chooseSecondary(input.box, secondary, language)
      if (!entry) continue
    }
    if (!entry) return cancelId
    if ('response' in entry) return entry.response
    notice = await runAction(entry, language)
  }
}

async function chooseSecondary(
  box: Electron.MessageBoxOptions,
  secondary: readonly SecondaryEntry[],
  language: DialogLanguage
): Promise<SecondaryEntry | undefined> {
  const cancel = secondary.length
  const result = await dialog.showMessageBox({
    type: box.type,
    title: box.title,
    message: box.message,
    buttons: [...secondary.map((item) => item.label), t('dialog.support.cancel', undefined, language)],
    defaultId: cancel,
    cancelId: cancel
  })
  return secondary[result?.response ?? cancel]
}
