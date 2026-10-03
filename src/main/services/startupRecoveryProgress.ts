import { dialog } from 'electron'

import { t } from '@main/i18n'
import type { LanguageVarious } from '@shared/data/preference/preferenceTypes'

export class StartupRecoveryCanceled extends Error {}

/** Cancel stops the helper and subsequent actions, not an exit request already delivered to Windows. */
export async function withStartupRecoveryProgress<T>(
  language: LanguageVarious,
  operation: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const work = new AbortController()
  const dismiss = new AbortController()
  const pendingDialog = dialog
    .showMessageBox({
      type: 'info',
      title: t('dialog.startup_recovery.title', undefined, language),
      message: t('dialog.startup_recovery.waiting', undefined, language),
      buttons: [t('dialog.startup_recovery.cancel', undefined, language)],
      cancelId: 0,
      signal: dismiss.signal
    })
    .then(
      () => {
        if (!dismiss.signal.aborted) work.abort()
      },
      () => work.abort()
    )
  try {
    await Promise.resolve()
    if (work.signal.aborted) throw new StartupRecoveryCanceled()
    const value = await operation(work.signal)
    if (work.signal.aborted) throw new StartupRecoveryCanceled()
    return value
  } catch (error) {
    if (work.signal.aborted) throw new StartupRecoveryCanceled()
    throw error
  } finally {
    dismiss.abort()
    await pendingDialog
  }
}
