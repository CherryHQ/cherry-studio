import { application } from '@application'
import { OAuthSignInCancelledError } from '@main/services/oauth/errors'
import type { OAuthRuntimeProviderContext, OAuthSignInResult } from '@main/services/oauth/runtime/types'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { oauthErrorCodes } from '@shared/ipc/errors/oauth'
import type { WindowId } from '@shared/ipc/types'

export async function mapOAuthSignInCancellation<T>(request: Promise<T>): Promise<T> {
  try {
    return await request
  } catch (error) {
    if (error instanceof OAuthSignInCancelledError) {
      throw new IpcError(oauthErrorCodes.SIGN_IN_CANCELLED, error.message)
    }
    throw error
  }
}

export async function runOAuthSignIn(
  senderId: WindowId | null,
  providerId: string,
  requestId: string,
  context: OAuthRuntimeProviderContext = {}
): Promise<OAuthSignInResult> {
  const result = await mapOAuthSignInCancellation(
    application.get('OAuthRuntimeService').signIn(senderId, providerId, requestId, context)
  )

  if (senderId) {
    application.get('MainWindowService').showMainWindow()
  }
  return result
}
