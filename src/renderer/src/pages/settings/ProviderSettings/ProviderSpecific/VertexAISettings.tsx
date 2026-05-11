import { Input, RowFlex, Textarea } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { useProvider, useProviderAuthConfig, useProviderMutations } from '@renderer/hooks/useProviders'
import { Info } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  ProviderHelpLink,
  ProviderHelpText,
  ProviderHelpTextRow,
  ProviderSettingsSubtitle
} from '../primitives/ProviderSettingsPrimitives'

const logger = loggerService.withContext('VertexAISettings')

interface Props {
  providerId: string
}

const VertexAISettings: FC<Props> = ({ providerId }) => {
  const { t } = useTranslation()
  const { provider } = useProvider(providerId)
  const { data: authConfig } = useProviderAuthConfig(providerId)
  const { updateAuthConfig: saveAuthConfigToServer } = useProviderMutations(providerId)

  const gcpConfig = authConfig?.type === 'iam-gcp' ? authConfig : null
  const credentials = gcpConfig?.credentials as Record<string, string> | undefined

  const [localProjectId, setLocalProjectId] = useState(gcpConfig?.project ?? '')
  const [localLocation, setLocalLocation] = useState(gcpConfig?.location ?? '')
  const [localPrivateKey, setLocalPrivateKey] = useState(credentials?.privateKey ?? '')
  const [localClientEmail, setLocalClientEmail] = useState(credentials?.clientEmail ?? '')
  const isDraftDirtyRef = useRef(false)

  const resetLocalAuthConfig = useCallback(() => {
    setLocalProjectId(gcpConfig?.project ?? '')
    setLocalLocation(gcpConfig?.location ?? '')
    setLocalPrivateKey(credentials?.privateKey ?? '')
    setLocalClientEmail(credentials?.clientEmail ?? '')
  }, [credentials?.clientEmail, credentials?.privateKey, gcpConfig?.location, gcpConfig?.project])

  useEffect(() => {
    if (!isDraftDirtyRef.current) {
      resetLocalAuthConfig()
    }
  }, [resetLocalAuthConfig])

  const markDraftDirty = () => {
    isDraftDirtyRef.current = true
  }

  const apiKeyWebsite = provider?.websites?.apiKey

  const saveAuthConfig = async () => {
    try {
      await saveAuthConfigToServer({
        type: 'iam-gcp' as const,
        project: localProjectId,
        location: localLocation,
        credentials: {
          privateKey: localPrivateKey,
          clientEmail: localClientEmail
        }
      })
      isDraftDirtyRef.current = false
    } catch (error) {
      logger.error('Failed to save Vertex AI auth config', { providerId, error })
      window.toast.error(t('settings.provider.save_failed'))
      isDraftDirtyRef.current = false
      resetLocalAuthConfig()
    }
  }

  return (
    <>
      <ProviderSettingsSubtitle className="mt-1.5">
        {t('settings.provider.vertex_ai.service_account.title')}
      </ProviderSettingsSubtitle>
      <div
        className="mt-1.5 flex gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2.5 text-foreground text-sm"
        role="status">
        <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <span>{t('settings.provider.vertex_ai.service_account.description')}</span>
      </div>

      <ProviderSettingsSubtitle className="mt-1.5">
        {t('settings.provider.vertex_ai.service_account.client_email')}
      </ProviderSettingsSubtitle>
      <Input
        className="mt-1.5 w-full"
        type="password"
        value={localClientEmail}
        placeholder={t('settings.provider.vertex_ai.service_account.client_email_placeholder')}
        onChange={(e) => {
          markDraftDirty()
          setLocalClientEmail(e.target.value)
        }}
        onBlur={saveAuthConfig}
      />
      <ProviderHelpTextRow>
        <ProviderHelpText>{t('settings.provider.vertex_ai.service_account.client_email_help')}</ProviderHelpText>
      </ProviderHelpTextRow>

      <ProviderSettingsSubtitle className="mt-1.5">
        {t('settings.provider.vertex_ai.service_account.private_key')}
      </ProviderSettingsSubtitle>
      <Textarea.Input
        className="mt-1.5 min-h-24 w-full"
        value={localPrivateKey}
        placeholder={t('settings.provider.vertex_ai.service_account.private_key_placeholder')}
        onChange={(e) => {
          markDraftDirty()
          setLocalPrivateKey(e.target.value)
        }}
        onBlur={saveAuthConfig}
        spellCheck={false}
        rows={4}
      />
      {apiKeyWebsite && (
        <ProviderHelpTextRow className="justify-between">
          <RowFlex>
            <ProviderHelpLink target="_blank" href={apiKeyWebsite}>
              {t('settings.provider.get_api_key')}
            </ProviderHelpLink>
          </RowFlex>
          <ProviderHelpText>{t('settings.provider.vertex_ai.service_account.private_key_help')}</ProviderHelpText>
        </ProviderHelpTextRow>
      )}
      <>
        <ProviderSettingsSubtitle className="mt-1.5">
          {t('settings.provider.vertex_ai.project_id')}
        </ProviderSettingsSubtitle>
        <Input
          className="mt-1.5 w-full"
          type="password"
          value={localProjectId}
          placeholder={t('settings.provider.vertex_ai.project_id_placeholder')}
          onChange={(e) => {
            markDraftDirty()
            setLocalProjectId(e.target.value)
          }}
          onBlur={saveAuthConfig}
        />
        <ProviderHelpTextRow>
          <ProviderHelpText>{t('settings.provider.vertex_ai.project_id_help')}</ProviderHelpText>
        </ProviderHelpTextRow>

        <ProviderSettingsSubtitle className="mt-1.5">
          {t('settings.provider.vertex_ai.location')}
        </ProviderSettingsSubtitle>
        <Input
          className="mt-1.5 w-full"
          value={localLocation}
          placeholder="us-central1"
          onChange={(e) => {
            markDraftDirty()
            setLocalLocation(e.target.value)
          }}
          onBlur={saveAuthConfig}
        />
        <ProviderHelpTextRow>
          <ProviderHelpText>{t('settings.provider.vertex_ai.location_help')}</ProviderHelpText>
        </ProviderHelpTextRow>
      </>
    </>
  )
}

export default VertexAISettings
