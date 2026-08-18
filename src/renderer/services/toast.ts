import { getToastUtilities, type ToastLabels } from '@cherrystudio/ui'
import i18n from '@renderer/i18n/resolver'

/**
 * services/toast — the notification track: non-blocking, auto-dismissing, no return
 * value. Reach for a toast to tell the user something happened. If you need them to
 * acknowledge before anything continues, that is a dialog — use services/popup
 * (confirm) instead; toasts never take focus and are easy to miss.
 *
 * Labels are supplied as a getter so every toast resolves the current language at
 * fire time (see @cherrystudio/ui ToastLabelsInput). Every toast renders in the one
 * shared `defaultToastStore`, drained by each window's <ToastHost/>.
 */
const resolveToastLabels = (): Partial<ToastLabels> => ({
  close: i18n.t('common.close'),
  error: i18n.t('common.error'),
  errorDescription: i18n.t('error.unknown'),
  loading: i18n.t('common.loading'),
  success: i18n.t('common.success')
})

export const toast = getToastUtilities(resolveToastLabels)
