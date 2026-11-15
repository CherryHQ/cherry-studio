import { useNavigate } from '@tanstack/react-router'
import { createElement, useEffect, useEffectEvent } from 'react'
import { useTranslation } from 'react-i18next'
import * as z from 'zod'

import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import { useProviderActions } from '@renderer/hooks/useProvider'
import { ipcApi } from '@renderer/ipc'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import type { AuthConfig } from '@shared/data/types/provider'
import { SystemProviderIds } from '@shared/utils/systemProviderId'
import {
  isVertexAuthorizedUserCredentials,
  VERTEX_AUTHORIZED_USER_TYPE,
  type VertexAuthorizedUserView
} from '@shared/utils/vertexGoogleCredentials'

import VertexGoogleSetupSummary, { type VertexSetupReplacement } from '../components/VertexGoogleSetupSummary'

const logger = loggerService.withContext('useVertexGoogleSetupLink')

const VERTEX_PROVIDER_ID = SystemProviderIds.vertexai

const VertexGoogleSetupSchema = z.object({
  project: z.string().trim().min(1),
  location: z.string().trim().min(1),
  clientId: z.string().trim().min(1),
  clientSecret: z.string().trim().min(1)
})

/** Parse a `cherrystudio://providers/vertex-google` payload, or null when it is not a valid setup. */
export function parseVertexGoogleSetup(raw: string) {
  try {
    const result = VertexGoogleSetupSchema.safeParse(JSON.parse(raw))
    return result.success ? result.data : null
  } catch {
    return null
  }
}

/** How applying a link for `clientId` changes the stored Vertex AI sign-in. */
function compareWithStoredSignIn(authConfig: AuthConfig | null, clientId: string) {
  const credentials = authConfig?.type === 'iam-gcp' ? authConfig.credentials : undefined
  if (isVertexAuthorizedUserCredentials(credentials)) {
    const google = credentials as VertexAuthorizedUserView
    const sameClient = google.clientId === clientId
    return {
      replaces: sameClient ? null : ('google' as VertexSetupReplacement),
      staysSignedIn: sameClient && google.signedIn,
      signsOut: !sameClient && google.signedIn
    }
  }
  const hasServiceAccountKey = Boolean(credentials?.privateKey || credentials?.clientEmail)
  return {
    replaces: hasServiceAccountKey ? ('service_account' as VertexSetupReplacement) : null,
    staysSignedIn: false,
    signsOut: false
  }
}

/**
 * Applies an administrator's Vertex AI "Sign in with Google" setup link to the
 * built-in Vertex AI provider after the person confirms it. It never signs in on its own.
 */
export function useVertexGoogleSetupLink(rawSetup: string | undefined, onSelectProvider: (providerId: string) => void) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { updateProviderById } = useProviderActions()

  const applySetupLink = useEffectEvent(async (raw: string, isStale: () => boolean) => {
    // `replace` drops the secret-bearing search param from history, so Back cannot reopen the dialog.
    const leaveSetupLink = () => void navigate({ to: '/settings/provider', replace: true })
    const setup = parseVertexGoogleSetup(raw)
    if (!setup) {
      toast.error(t('settings.provider.vertex_ai.setup_link.invalid'))
      leaveSetupLink()
      return
    }

    try {
      // The concrete path also matches `/providers/:providerId`, so the response type needs narrowing.
      const authConfig = (await dataApiService.get(`/providers/${VERTEX_PROVIDER_ID}/auth-config`)) as AuthConfig | null
      if (isStale()) return
      const { replaces, staysSignedIn, signsOut } = compareWithStoredSignIn(authConfig, setup.clientId)

      const confirmed = await popup.confirm({
        title: t('settings.provider.vertex_ai.setup_link.title'),
        content: createElement(VertexGoogleSetupSummary, {
          project: setup.project,
          location: setup.location,
          clientId: setup.clientId,
          replaces
        }),
        centered: true
      })
      if (isStale()) return
      if (!confirmed) {
        leaveSetupLink()
        return
      }

      // A new client drops the session; revoke it first instead of leaving the refresh token live at Google.
      if (signsOut) await ipcApi.request('oauth.logout', { providerId: VERTEX_PROVIDER_ID })
      await updateProviderById(VERTEX_PROVIDER_ID, {
        isEnabled: true,
        authConfig: {
          type: 'iam-gcp',
          project: setup.project,
          location: setup.location,
          credentials: {
            type: VERTEX_AUTHORIZED_USER_TYPE,
            clientId: setup.clientId,
            clientSecret: setup.clientSecret
          }
        }
      })
      if (isStale()) return
      onSelectProvider(VERTEX_PROVIDER_ID)
      void navigate({ to: '/settings/provider', search: { id: VERTEX_PROVIDER_ID }, replace: true })
      toast.success(
        staysSignedIn
          ? t('settings.provider.vertex_ai.setup_link.applied_signed_in')
          : t('settings.provider.vertex_ai.setup_link.applied')
      )
    } catch (error) {
      logger.error('Failed to apply Vertex Google setup link', { providerId: VERTEX_PROVIDER_ID, error })
      if (isStale()) return
      toast.error(t('settings.provider.save_failed'))
      leaveSetupLink()
    }
  })

  useEffect(() => {
    if (!rawSetup) return
    let stale = false
    void applySetupLink(rawSetup, () => stale)
    return () => {
      stale = true
    }
  }, [rawSetup])
}
