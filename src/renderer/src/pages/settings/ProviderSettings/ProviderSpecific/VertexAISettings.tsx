import { Input, RowFlex, Textarea } from '@cherrystudio/ui'
import { useProvider, useProviderAuthConfig, useProviderMutations } from '@renderer/hooks/useProviders'
import { Info } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  ProviderHelpLink,
  ProviderHelpText,
  ProviderHelpTextRow,
  ProviderSettingsSubtitle
} from '../shared/primitives/ProviderSettingsPrimitives'

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

  useEffect(() => {
    const config = authConfig?.type === 'iam-gcp' ? authConfig : null
    if (config) {
      setLocalProjectId(config.project ?? '')
      setLocalLocation(config.location ?? '')
      setLocalPrivateKey((config.credentials as Record<string, string> | undefined)?.privateKey ?? '')
      setLocalClientEmail((config.credentials as Record<string, string> | undefined)?.clientEmail ?? '')
    }
  }, [authConfig])

  const apiKeyWebsite = provider?.websites?.apiKey

  const saveAuthConfig = async () => {
    await saveAuthConfigToServer({
      type: 'iam-gcp' as const,
      project: localProjectId,
      location: localLocation,
      credentials: {
        privateKey: localPrivateKey,
        clientEmail: localClientEmail
      }
    })
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
        onChange={(e) => setLocalClientEmail(e.target.value)}
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
        onChange={(e) => setLocalPrivateKey(e.target.value)}
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
          onChange={(e) => setLocalProjectId(e.target.value)}
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
          onChange={(e) => setLocalLocation(e.target.value)}
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
