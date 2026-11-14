import { getToastUtilities, type ToastLabels } from '@cherrystudio/ui'
import i18n from '@renderer/i18n/resolver'
import { getCherryCloudErrorPresentation } from '@renderer/utils/cherryCloudErrorPresentation'
import { isAbortError, providerErrorText } from '@renderer/utils/error'
import { classifyError, type ErrorCategory } from '@renderer/utils/errorClassifier'
import {
  type ErrorToastAction,
  type ErrorToastPresentation,
  errorToastPresentations,
  serializeToastError
} from '@renderer/utils/errorToast'
import type { Provider } from '@shared/data/types/provider'

import { openSettingsTab } from './mainWindowNavigation'
import { openExternalWebsite } from './website'

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
  details: i18n.t('error.diagnosis.view_details'),
  error: i18n.t('common.error'),
  errorDescription: i18n.t('error.unknown'),
  loading: i18n.t('common.loading'),
  success: i18n.t('common.success')
})

const notifications = getToastUtilities(resolveToastLabels)

export interface ErrorToastContext {
  key?: string
  category?: ErrorCategory
  provider?: Pick<Provider, 'id' | 'name' | 'websites'>
  modelName?: string
  mcpServer?: { id: string; name: string }
  retryAfterSeconds?: number
  actions?: Partial<Record<ErrorToastAction, () => void | boolean | Promise<void | boolean>>>
  isCurrent?: () => boolean
}

function errorFromException(error: unknown, context: ErrorToastContext = {}): string {
  const serialized = serializeToastError(error)
  const classification = classifyError(serialized, context.provider?.id)
  const category = context.category ?? classification.category
  const provider = context.provider
  const cloudPresentation = getCherryCloudErrorPresentation(serialized, provider?.id, category)
  const planQuota = cloudPresentation.quota
  const presentation: ErrorToastPresentation = planQuota ? { type: 'warning' } : errorToastPresentations[category]
  const providerDetails = planQuota ? cloudPresentation.text : providerErrorText(serialized)
  // Admission-time runtime failures (e.g. `ClaudeCodeRuntimeUnavailableError` via
  // `AI_REQUEST_FAILED`) carry renderer-facing recovery copy in
  // `i18nKey`/`detailI18nKey`. `providerErrorText` alone would show only the legacy
  // message, so prefer the app-owned keys — mirroring `ErrorBlock`, where
  // `claude_code_*` keys stay preferred even when the failed message carries a
  // model provider (the runtime, not the provider, is at fault).
  const errorBag = serialized as unknown as Record<string, unknown>
  const appOwnedKey = typeof errorBag.i18nKey === 'string' ? `error.${errorBag.i18nKey}` : ''
  const hasAppOwnedKey = appOwnedKey !== '' && i18n.exists(appOwnedKey)
  const isClaudeRuntimeKey = typeof errorBag.i18nKey === 'string' && errorBag.i18nKey.startsWith('claude_code_')
  const useAppOwnedCopy = hasAppOwnedKey && (!provider?.id || isClaudeRuntimeKey)
  const detailFullKey = typeof errorBag.detailI18nKey === 'string' ? `error.${errorBag.detailI18nKey}` : ''
  const hasAppOwnedDetail = detailFullKey !== '' && i18n.exists(detailFullKey)
  const detailValues = errorBag.detailI18nValues as Record<string, string> | undefined
  const appOwnedTitle = useAppOwnedCopy ? i18n.t(appOwnedKey) : undefined
  const appOwnedDetails = useAppOwnedCopy && hasAppOwnedDetail ? i18n.t(detailFullKey, detailValues) : undefined
  const configure = provider
    ? () => openSettingsTab(`/settings/provider?id=${encodeURIComponent(provider.id)}`)
    : undefined
  const billing = provider?.websites?.billing
  const actions = {
    configure,
    billing: billing ? () => openExternalWebsite(billing) : configure,
    mcp: context.mcpServer
      ? () => openSettingsTab(`/settings/mcp/settings/${encodeURIComponent(context.mcpServer!.id)}`)
      : undefined,
    ...context.actions
  }
  const actionKind = presentation.action
  const diagnosisKey = `error.diagnosis.${category}`
  const actionLabelKey = `toast.error.${actionKind}`
  const run = actionKind ? actions[actionKind] : undefined
  let running = false
  const key = notifications[presentation.type]({
    key: context.key,
    title: planQuota
      ? i18n.t('models.detail.quota_exhausted')
      : (appOwnedTitle ?? (category === 'unknown' ? providerDetails || i18n.t('error.unknown') : i18n.t(diagnosisKey))),
    description:
      [
        context.mcpServer?.name ?? provider?.name,
        context.modelName,
        category === 'rate_limit' && context.retryAfterSeconds !== undefined
          ? i18n.t('toast.error.retry_after', { seconds: context.retryAfterSeconds })
          : undefined
      ]
        .filter(Boolean)
        .join(' · ') || undefined,
    details: planQuota ? providerDetails : (appOwnedDetails ?? (category === 'unknown' ? undefined : providerDetails)),
    action:
      run && actionKind
        ? {
            label:
              actionKind === 'billing' && !billing && !context.actions?.billing
                ? i18n.t('toast.error.configure')
                : i18n.t(actionLabelKey),
            onClick: async () => {
              if (running || context.isCurrent?.() === false) return
              running = true
              const tracksCompletion = actionKind === 'retry' || actionKind === 'trimContext'
              if (tracksCompletion) notifications.loading({ key })
              const pending = notifications.getToastQueue().toasts.find((item) => item.key === key)
              const canUpdate = () =>
                context.isCurrent?.() !== false &&
                (!tracksCompletion || notifications.getToastQueue().toasts.find((item) => item.key === key) === pending)
              try {
                const result = await run()
                if (!canUpdate()) return
                if (tracksCompletion) {
                  if (result === false) notifications.closeToast(key)
                  else notifications.success({ key, title: i18n.t('common.success') })
                }
              } catch (failure) {
                if (!canUpdate()) return
                if (isAbortError(failure)) notifications.closeToast(key)
                else
                  errorFromException(failure, {
                    ...context,
                    key,
                    category: undefined,
                    actions: tracksCompletion ? context.actions : {}
                  })
              } finally {
                running = false
              }
            }
          }
        : undefined
  })
  return key
}

export const toast = { ...notifications, errorFromException }
