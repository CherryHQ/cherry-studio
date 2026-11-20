import type { ReactNode } from 'react'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { ErrorNotice, type ErrorNoticeAction } from '@renderer/components/ErrorNotice'
import { useCherryCloudPlans } from '@renderer/hooks/useCherryCloudPlans'
import { useProviderById } from '@renderer/hooks/useProvider'
import { useTimer } from '@renderer/hooks/useTimer'
import { getProviderLabelKey } from '@renderer/i18n/label'
import type { SerializedError } from '@renderer/types/error'
import { getCherryCloudErrorPresentation } from '@renderer/utils/cherryCloudErrorPresentation'
import { formatErrorMessageWithPrefix, providerErrorText } from '@renderer/utils/error'
import {
  classifyError,
  type ErrorCategory,
  getClaudeCodeExitCategory,
  getClaudeCodeExitInfo,
  getLocalModelResolutionFailure,
  isClaudeCodeNotLoggedIn
} from '@renderer/utils/errorClassifier'
import { isLikelyInLanguage } from '@renderer/utils/errorLanguage'
import { CHERRY_CLOUD_PROVIDER_ID } from '@shared/data/presets/cherryai'

import { useMessageListActions } from '../MessageListProvider'
import type { MessageListItem } from '../types'
import { getMessageListItemModel } from '../utils/messageListItem'
import { useMessageParts } from './MessagePartsContext'

const logger = loggerService.withContext('ErrorBlock')

/** A slow or unreachable summarizer must not leave the card on its placeholder. */
const SUMMARY_TIMEOUT_MS = 8000

/** Short conclusion + one-sentence cause/next step; `unknown` has no fixed info (translation or raw text). */
const NOTICE_KEYS: Record<ErrorCategory, { readonly title: string; readonly info?: string }> = {
  auth: { title: 'error.notice.auth.title', info: 'error.notice.auth.info' },
  bad_request: { title: 'error.notice.bad_request.title', info: 'error.notice.bad_request.info' },
  permission: { title: 'error.notice.permission.title', info: 'error.notice.permission.info' },
  region: { title: 'error.notice.region.title', info: 'error.notice.region.info' },
  model: { title: 'error.notice.model.title', info: 'error.notice.model.info' },
  quota: { title: 'error.notice.quota.title', info: 'error.notice.quota.info' },
  rate_limit: { title: 'error.notice.rate_limit.title', info: 'error.notice.rate_limit.info' },
  context_length: { title: 'error.notice.context_length.title', info: 'error.notice.context_length.info' },
  payload: { title: 'error.notice.payload.title', info: 'error.notice.payload.info' },
  network: { title: 'error.notice.network.title', info: 'error.notice.network.info' },
  proxy: { title: 'error.notice.proxy.title', info: 'error.notice.proxy.info' },
  stream: { title: 'error.notice.stream.title', info: 'error.notice.stream.info' },
  content: { title: 'error.notice.content.title', info: 'error.notice.content.info' },
  server: { title: 'error.notice.server.title', info: 'error.notice.server.info' },
  deprecated: { title: 'error.notice.deprecated.title', info: 'error.notice.deprecated.info' },
  knowledge: { title: 'error.diagnosis.knowledge', info: 'error.notice.knowledge.info' },
  ocr: { title: 'error.notice.ocr.title', info: 'error.notice.ocr.info' },
  mcp: { title: 'error.notice.mcp.title', info: 'error.notice.mcp.info' },
  parse: { title: 'error.notice.parse.title', info: 'error.notice.parse.info' },
  unknown: { title: 'error.diagnosis.unknown' }
}
const RETRY_CATEGORIES: ReadonlySet<ErrorCategory> = new Set<ErrorCategory>(['server', 'stream', 'parse'])
/** Failures another provider's model can get past; request-shaped and local-tool failures would recur. */
const PROVIDER_SWITCH_CATEGORIES: ReadonlySet<ErrorCategory> = new Set<ErrorCategory>([
  'auth',
  'permission',
  'region',
  'model',
  'quota',
  'rate_limit',
  'server',
  'deprecated'
])

interface Props {
  partId: string
  error: SerializedError | undefined
  message: MessageListItem
}

const ErrorBlock: React.FC<Props> = ({ partId, error, message }) => {
  return <MessageErrorInfo partId={partId} error={error} message={message} />
}

/** Built-in providers show their localized label; a custom one shows the name the user gave it. */
function useProviderDisplayName(providerId: string | undefined): string {
  const { t } = useTranslation()
  const { provider } = useProviderById(providerId)
  const labelKey = providerId ? getProviderLabelKey(providerId, '') : ''
  return labelKey ? t(labelKey) : (provider?.name ?? t('error.notice.provider_fallback'))
}

/** An app-owned key interpolating `<provider>` renders the provider name as a settings link. */
const ProviderLinkedErrorText: React.FC<{ i18nKey: string; providerId: string }> = ({ i18nKey, providerId }) => {
  const { navigateToRoute } = useMessageListActions()
  const providerName = useProviderDisplayName(providerId)
  return (
    <Trans
      i18nKey={i18nKey}
      values={{ provider: providerName }}
      components={{
        provider: navigateToRoute ? (
          <button
            type="button"
            className="cursor-pointer text-link hover:underline focus-visible:underline focus-visible:outline-none"
            onClick={(event) => {
              event.stopPropagation()
              void navigateToRoute({ path: '/settings/provider', query: { id: providerId } })
            }}
          />
        ) : (
          <span />
        )
      }}
    />
  )
}

const MessageErrorInfo: React.FC<{
  partId: string
  error: Props['error']
  message: MessageListItem
}> = ({ partId, error, message }) => {
  const {
    diagnoseMessageError,
    removeMessageErrorPart,
    openErrorDetail,
    navigateErrorTarget,
    notifyError,
    regenerateMessage,
    renderRegenerateModelPicker
  } = useMessageListActions()
  const { setTimeoutTimer } = useTimer()
  const { t, i18n } = useTranslation()
  const [storedSummary, setStoredSummary] = useState<{ readonly fault: string; readonly text: string } | undefined>(
    undefined
  )
  const errorRef = useRef(error)
  const messageRef = useRef(message)
  errorRef.current = error
  messageRef.current = message

  const errorBag = error as Record<string, unknown> | undefined
  const errorMessage = error?.message ?? undefined
  const errorProviderId = typeof errorBag?.providerId === 'string' ? errorBag.providerId : undefined
  const errorI18nKey = errorBag?.i18nKey
  const claudeCodeExitCategory = getClaudeCodeExitCategory(error)
  const claudeCodeExit = getClaudeCodeExitInfo(error)
  const claudeCodeLogin = isClaudeCodeNotLoggedIn(error)
  const appOwnedErrorKey = typeof errorI18nKey === 'string' ? `error.${errorI18nKey}` : ''
  const hasAppOwnedI18nKey = appOwnedErrorKey !== '' && i18n.exists(appOwnedErrorKey)
  const messageErrorKey = errorMessage ? `error.${errorMessage}` : ''

  const providerId = getMessageListItemModel(message)?.provider ?? errorProviderId
  const classification = useMemo(() => classifyError(error, providerId), [error, providerId])
  const providerName = useProviderDisplayName(providerId)
  const category = classification.category
  const localModelFailure = useMemo(() => getLocalModelResolutionFailure(error), [error])
  const cloudPresentation = getCherryCloudErrorPresentation(error, providerId, category)
  const cherryCloudQuotaRejection = cloudPresentation.quota
  const messageParts = useMessageParts(message.id)
  const canOfferSubscriptionModel =
    !!renderRegenerateModelPicker &&
    !!providerId &&
    providerId !== CHERRY_CLOUD_PROVIDER_ID &&
    message.status !== 'pending' &&
    (PROVIDER_SWITCH_CATEGORIES.has(category) || !!localModelFailure)
  const { activePaid, isPlansReady } = useCherryCloudPlans(canOfferSubscriptionModel)
  const offerSubscriptionModel = canOfferSubscriptionModel && isPlansReady && !!activePaid

  // An app-owned i18nKey is the throwing code's own conclusion — prefer it over a pattern-matched
  // category, which can name the wrong subsystem. `<provider>` keys stay as the info (link form).
  const title = cherryCloudQuotaRejection
    ? t('models.detail.quota_insufficient_for_request')
    : claudeCodeLogin
      ? t('error.notice.claude_code_login.title')
      : hasAppOwnedI18nKey && !errorProviderId
        ? t(appOwnedErrorKey)
        : t(localModelFailure ? NOTICE_KEYS.model.title : NOTICE_KEYS[category].title)

  const summaryFault = [
    message.id,
    partId,
    message.persistedAt ?? '',
    error?.name ?? '',
    errorMessage ?? '',
    i18n.language
  ].join('\0')
  // Fault identity omits status and app i18n key, so a newly classifiable error would keep the previous class's summary.
  const summaryEligible =
    claudeCodeExitCategory === undefined &&
    !localModelFailure &&
    !hasAppOwnedI18nKey &&
    category === 'unknown' &&
    !!errorMessage &&
    !isLikelyInLanguage(errorMessage, i18n.language) &&
    !!error &&
    !!diagnoseMessageError
  const summarySettled = summaryEligible && storedSummary?.fault === summaryFault
  const translation = summarySettled ? storedSummary.text : ''

  useEffect(() => {
    const currentError = errorRef.current
    if (!summaryEligible || !currentError) return
    let cancelled = false
    const fault = summaryFault
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<string>((resolve) => {
      timer = setTimeout(() => resolve(''), SUMMARY_TIMEOUT_MS)
    })
    void Promise.race([
      diagnoseMessageError({
        message: messageRef.current,
        partId,
        error: currentError,
        language: i18n.language
      }),
      timeout
    ])
      .then((result) => {
        if (cancelled) return
        const summary = typeof result === 'string' ? result : (result?.summary ?? '')
        setStoredSummary({ fault, text: summary })
      })
      .catch(() => {
        if (!cancelled) setStoredSummary({ fault, text: '' })
      })
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [diagnoseMessageError, i18n.language, partId, summaryEligible, summaryFault])

  const info = ((): ReactNode => {
    if (cherryCloudQuotaRejection) return cloudPresentation.text
    if (claudeCodeExit) {
      const { reference, exitCode, exitSignal } = claudeCodeExit
      if (exitCode !== undefined) return t('error.claude_code_exit.code', { code: exitCode, reference })
      if (exitSignal !== undefined) return t('error.claude_code_exit.signal', { signal: exitSignal, reference })
      return t('error.claude_code_exit.start', { reference })
    }
    if (claudeCodeLogin) return t('error.notice.claude_code_login.info')
    if (hasAppOwnedI18nKey) {
      if (errorProviderId) return <ProviderLinkedErrorText i18nKey={appOwnedErrorKey} providerId={errorProviderId} />
      // The detail key carries the localized "why" (e.g. which OCR path failed).
      const detailKey = typeof errorBag?.detailI18nKey === 'string' ? `error.${errorBag.detailI18nKey}` : ''
      return detailKey && i18n.exists(detailKey)
        ? t(detailKey, errorBag?.detailI18nValues as Record<string, string> | undefined)
        : undefined
    }
    if (messageErrorKey && i18n.exists(messageErrorKey)) return t(messageErrorKey)
    if (localModelFailure) {
      const { providerId: failedProviderId, modelId } = localModelFailure
      if (!modelId) return t('code.select_provider_model')
      return t('error.diagnosis.model_unavailable', {
        model: failedProviderId ? `${failedProviderId}/${modelId}` : modelId
      })
    }
    const infoKey = NOTICE_KEYS[category].info
    if (infoKey) {
      return t(infoKey, { provider: providerName })
    }
    if (translation) return translation
    if (summaryEligible && !summarySettled) return t('error.notice.unknown.summarizing')
    const original = providerErrorText(error)
    return original && !isLikelyInLanguage(original, i18n.language)
      ? t('error.notice.unknown.original', { message: original })
      : original
  })()

  const onRemoveErrorPart = useCallback(() => {
    setTimeoutTimer(
      'onRemoveErrorPart',
      async () => {
        try {
          await removeMessageErrorPart?.({ messageId: message.id, partId })
        } catch (error) {
          logger.error('Failed to dismiss message error part:', error as Error, { messageId: message.id, partId })
          notifyError?.(formatErrorMessageWithPrefix(error, t('message.error.dismiss_failed')))
        }
      },
      350
    )
  }, [message.id, notifyError, partId, removeMessageErrorPart, setTimeoutTimer, t])

  const showErrorDetail = () => {
    void openErrorDetail?.({
      message,
      error,
      partId,
      localizedErrorMessage: title
    })
  }

  const retry = async () => {
    try {
      await regenerateMessage?.(message.id)
    } catch (error) {
      logger.error('Failed to retry message from its error card:', error as Error, { messageId: message.id })
      notifyError?.(formatErrorMessageWithPrefix(error, t('common.error')))
    }
  }

  const navTarget = cherryCloudQuotaRejection ? null : classification.navTarget
  const canRetry = !!regenerateMessage && RETRY_CATEGORIES.has(category) && message.status !== 'pending'
  let action: ErrorNoticeAction | undefined
  if (navTarget && navigateErrorTarget) {
    action = {
      label: claudeCodeLogin ? t('error.notice.claude_code_login.action') : t('error.diagnosis.go_to_settings'),
      onClick: () => void navigateErrorTarget(navTarget)
    }
  } else if (canRetry) {
    action = { label: t('common.retry'), onClick: () => void retry() }
  }

  const subscriptionModelEntry =
    offerSubscriptionModel && renderRegenerateModelPicker ? (
      // React bubbles the picker's portal clicks through the card; keep them from opening the detail.
      <span className="contents" onClick={(event) => event.stopPropagation()}>
        {renderRegenerateModelPicker({
          message,
          messageParts,
          providerId: CHERRY_CLOUD_PROVIDER_ID,
          trigger: (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto min-h-0 cursor-pointer rounded-sm px-0 text-link shadow-none hover:no-underline">
              {t('error.notice.switch_to_subscription_model')}
            </Button>
          )
        })}
      </span>
    ) : undefined

  return (
    <ErrorNotice
      className="my-2"
      role="group"
      title={title}
      info={info}
      action={action}
      extra={subscriptionModelEntry}
      onOpenDetail={openErrorDetail ? showErrorDetail : undefined}
      onDismiss={removeMessageErrorPart ? onRemoveErrorPart : undefined}
    />
  )
}

export default React.memo(ErrorBlock)
