import type { TFunction } from 'i18next'

import { cherryCloudErrorCodes } from '@shared/ipc/errors/cherryCloud'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { oauthErrorCodes } from '@shared/ipc/errors/oauth'
import { normalizeSignInFailure, type SignInFailureReason, type SignInPhase } from '@shared/ipc/errors/signIn'

export type SignInNamespace = 'codex' | 'grok_cli' | 'cherry_cloud'
type SignInAction = 'login' | 'cancel'

export interface SignInFailureText {
  title: string
  description: string
}

const providerKeys: Record<SignInNamespace, string> = {
  codex: 'provider.openai-codex',
  grok_cli: 'provider.grok-cli',
  cherry_cloud: 'settings.provider.cherry_cloud.title'
}

const failureKeys: Record<SignInNamespace, string> = {
  codex: 'settings.provider.codex.sign_in_failed',
  grok_cli: 'settings.provider.grok_cli.sign_in_failed',
  cherry_cloud: 'settings.provider.cherry_cloud.sign_in_failed'
}

const failureDuringStepKeys: Record<SignInNamespace, string> = {
  codex: 'settings.provider.codex.sign_in_failed_during_step',
  grok_cli: 'settings.provider.grok_cli.sign_in_failed_during_step',
  cherry_cloud: 'settings.provider.cherry_cloud.sign_in_failed_during_step'
}

const reasonKeys: Record<SignInFailureReason, string> = {
  network: 'settings.provider.oauth.sign_in_failure.reason.network',
  request_timeout: 'settings.provider.oauth.sign_in_failure.reason.request_timeout',
  callback_timeout: 'settings.provider.oauth.sign_in_failure.reason.callback_timeout',
  browser_open_failed: 'settings.provider.oauth.sign_in_failure.reason.browser_open_failed',
  http_error: 'settings.provider.oauth.sign_in_failure.reason.http_error',
  authorization_denied: 'settings.provider.oauth.sign_in_failure.reason.authorization_denied',
  callback_failed: 'settings.provider.oauth.sign_in_failure.reason.callback_failed',
  missing_code: 'settings.provider.oauth.sign_in_failure.reason.missing_code',
  callback_unavailable: 'settings.provider.oauth.sign_in_failure.reason.callback_unavailable',
  invalid_response: 'settings.provider.oauth.sign_in_failure.reason.invalid_response',
  already_in_progress: 'settings.provider.oauth.sign_in_failure.reason.already_in_progress',
  provider_not_registered: 'settings.provider.oauth.sign_in_failure.reason.provider_not_registered',
  configuration_missing: 'settings.provider.oauth.sign_in_failure.reason.configuration_missing',
  service_unavailable: 'settings.provider.oauth.sign_in_failure.reason.service_unavailable',
  upgrade_required: 'settings.provider.oauth.sign_in_failure.reason.upgrade_required',
  unknown: 'settings.provider.oauth.sign_in_failure.reason.unknown'
}

const stepKeys: Record<SignInPhase, string> = {
  discovery: 'settings.provider.oauth.sign_in_failure.step.discovery',
  authorization: 'settings.provider.oauth.sign_in_failure.step.authorization',
  callback: 'settings.provider.oauth.sign_in_failure.step.callback',
  exchange: 'settings.provider.oauth.sign_in_failure.step.exchange',
  persist: 'settings.provider.oauth.sign_in_failure.step.persist'
}

export function formatSignInFailure(
  t: TFunction,
  namespace: SignInNamespace,
  error: unknown,
  action: SignInAction
): SignInFailureText {
  const failure = normalizeSignInFailure(
    error instanceof IpcError &&
      (error.code === oauthErrorCodes.SIGN_IN_FAILED || error.code === cherryCloudErrorCodes.SIGN_IN_FAILED)
      ? error.data
      : undefined
  ) ?? { reason: 'unknown' }
  const provider = t(providerKeys[namespace])
  const reason =
    failure.reason === 'http_error'
      ? failure.httpStatus === undefined
        ? t('settings.provider.oauth.sign_in_failure.reason.http_error_no_status')
        : t(reasonKeys.http_error, { status: failure.httpStatus })
      : t(reasonKeys[failure.reason])

  if (action === 'cancel') {
    return { title: t('settings.provider.oauth.cancel_sign_in_failed', { provider }), description: reason }
  }

  if (failure.phase && failure.reason !== 'unknown') {
    return {
      title: t(failureKeys[namespace], { provider }),
      description: t(failureDuringStepKeys[namespace], { step: t(stepKeys[failure.phase]), reason })
    }
  }
  return { title: t(failureKeys[namespace], { provider }), description: reason }
}
