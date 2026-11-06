import { app, clipboard, dialog, shell } from 'electron'

import { loggerService } from '@logger'
import { resolveSystemLanguage, t } from '@main/i18n'

const logger = loggerService.withContext('nativeErrorDialog')

export const OFFICIAL_RELEASES_URL = 'https://github.com/CherryHQ/cherry-studio/releases'
const FEEDBACK_URL = 'mailto:support@cherry-ai.com?subject=Cherry%20Studio%20Feedback'

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

function supportActions(
  input: SupportedDialogInput,
  language: DialogLanguage
): Array<{ label: string; run: () => Promise<void> }> {
  const actions = [
    {
      label: t('dialog.support.copy', undefined, language),
      run: async () => {
        await clipboard.writeText(input.technicalDetail ?? input.box.message)
      }
    },
    {
      label: t('dialog.support.feedback', undefined, language),
      run: async () => {
        await shell.openExternal(FEEDBACK_URL)
      }
    },
    {
      label: t('dialog.support.releases', undefined, language),
      run: async () => {
        await shell.openExternal(OFFICIAL_RELEASES_URL)
      }
    }
  ]
  if (input.action) actions.push(input.action)
  return actions
}

function failureLine(language: DialogLanguage): string {
  return t('dialog.support.failed', undefined, language)
}

function cancelIndex(cancelId: number | undefined, primaryLength: number): number {
  if (typeof cancelId === 'number' && cancelId >= 0 && cancelId < primaryLength) return cancelId
  return 0
}

/**
 * Show the original dialog, then Copy / Feedback / Releases, plus one caller action
 * when that caller supplied one. Support choices loop back to the same dialog.
 * The returned index is always one of the original buttons. A response outside
 * that set returns the original cancel button and does not ask again.
 * Analysis is unavailable on this path; the detail says so. Technical text is
 * copied on request and is not placed on the dialog options.
 */
export async function showSupportedMessageBox(input: SupportedDialogInput): Promise<number> {
  if (typeof app.isReady === 'function' && !app.isReady()) await app.whenReady()
  const language = input.language ?? resolveSystemLanguage(app.getLocale())
  const primary = input.box.buttons ?? [t('dialog.support.ok', undefined, language)]
  const support = supportActions(input, language)
  const cancelId = cancelIndex(input.box.cancelId, primary.length)
  const analysis = t('dialog.support.analysis_unavailable', undefined, language)
  let failure = ''
  for (;;) {
    const baseDetail = [input.box.detail, analysis].filter(Boolean).join('\n\n')
    const result = await dialog.showMessageBox({
      ...input.box,
      buttons: [...primary, ...support.map((item) => item.label)],
      detail: failure ? [baseDetail, failure].filter(Boolean).join('\n\n') : baseDetail
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
      failure = failureLine(language)
    }
  }
}
