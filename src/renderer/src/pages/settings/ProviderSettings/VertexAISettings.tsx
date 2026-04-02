import { RowFlex } from '@cherrystudio/ui'
import { PROVIDER_URLS } from '@renderer/config/providers'
import { dataApiService } from '@renderer/data/DataApiService'
import { useInvalidateCache, useQuery } from '@renderer/data/hooks/useDataApi'
import type { AuthConfig } from '@shared/data/types/provider'
import { Alert, Input } from 'antd'
import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingHelpLink, SettingHelpText, SettingHelpTextRow, SettingSubtitle } from '..'

interface Props {
  providerId: string
}

const VertexAISettings: FC<Props> = ({ providerId }) => {
  const { t } = useTranslation()
  const { data: authConfig } = useQuery(`/providers/${providerId}/auth-config` as any) as {
    data: AuthConfig | null | undefined
  }
  const invalidate = useInvalidateCache()

  const gcpConfig = authConfig?.type === 'iam-gcp' ? authConfig : null
  const credentials = gcpConfig?.credentials as Record<string, string> | undefined

  const [localProjectId, setLocalProjectId] = useState(gcpConfig?.project ?? '')
  const [localLocation, setLocalLocation] = useState(gcpConfig?.location ?? '')
  const [localPrivateKey, setLocalPrivateKey] = useState(credentials?.privateKey ?? '')
  const [localClientEmail, setLocalClientEmail] = useState(credentials?.clientEmail ?? '')

  const providerConfig = PROVIDER_URLS['vertexai']
  const apiKeyWebsite = providerConfig?.websites?.apiKey

  const saveAuthConfig = async () => {
    await dataApiService.patch(`/providers/${providerId}` as any, {
      body: {
        authConfig: {
          type: 'iam-gcp' as const,
          project: localProjectId,
          location: localLocation,
          credentials: {
            privateKey: localPrivateKey,
            clientEmail: localClientEmail
          }
        }
      }
    })
    await invalidate([`/providers/${providerId}`, `/providers/${providerId}/auth-config`])
  }

  return (
    <>
      <SettingSubtitle style={{ marginTop: 5 }}>
        {t('settings.provider.vertex_ai.service_account.title')}
      </SettingSubtitle>
      <Alert
        type="info"
        style={{ marginTop: 5 }}
        message={t('settings.provider.vertex_ai.service_account.description')}
        showIcon
      />

      <SettingSubtitle style={{ marginTop: 5 }}>
        {t('settings.provider.vertex_ai.service_account.client_email')}
      </SettingSubtitle>
      <Input.Password
        value={localClientEmail}
        placeholder={t('settings.provider.vertex_ai.service_account.client_email_placeholder')}
        onChange={(e) => setLocalClientEmail(e.target.value)}
        onBlur={saveAuthConfig}
        style={{ marginTop: 5 }}
      />
      <SettingHelpTextRow>
        <SettingHelpText>{t('settings.provider.vertex_ai.service_account.client_email_help')}</SettingHelpText>
      </SettingHelpTextRow>

      <SettingSubtitle style={{ marginTop: 5 }}>
        {t('settings.provider.vertex_ai.service_account.private_key')}
      </SettingSubtitle>
      <Input.TextArea
        value={localPrivateKey}
        placeholder={t('settings.provider.vertex_ai.service_account.private_key_placeholder')}
        onChange={(e) => setLocalPrivateKey(e.target.value)}
        onBlur={saveAuthConfig}
        style={{ marginTop: 5 }}
        spellCheck={false}
        autoSize={{ minRows: 4, maxRows: 4 }}
      />
      {apiKeyWebsite && (
        <SettingHelpTextRow style={{ justifyContent: 'space-between' }}>
          <RowFlex>
            <SettingHelpLink target="_blank" href={apiKeyWebsite}>
              {t('settings.provider.get_api_key')}
            </SettingHelpLink>
          </RowFlex>
          <SettingHelpText>{t('settings.provider.vertex_ai.service_account.private_key_help')}</SettingHelpText>
        </SettingHelpTextRow>
      )}
      <>
        <SettingSubtitle style={{ marginTop: 5 }}>{t('settings.provider.vertex_ai.project_id')}</SettingSubtitle>
        <Input.Password
          value={localProjectId}
          placeholder={t('settings.provider.vertex_ai.project_id_placeholder')}
          onChange={(e) => setLocalProjectId(e.target.value)}
          onBlur={saveAuthConfig}
          style={{ marginTop: 5 }}
        />
        <SettingHelpTextRow>
          <SettingHelpText>{t('settings.provider.vertex_ai.project_id_help')}</SettingHelpText>
        </SettingHelpTextRow>

        <SettingSubtitle style={{ marginTop: 5 }}>{t('settings.provider.vertex_ai.location')}</SettingSubtitle>
        <Input
          value={localLocation}
          placeholder="us-central1"
          onChange={(e) => setLocalLocation(e.target.value)}
          onBlur={saveAuthConfig}
          style={{ marginTop: 5 }}
        />
        <SettingHelpTextRow>
          <SettingHelpText>{t('settings.provider.vertex_ai.location_help')}</SettingHelpText>
        </SettingHelpTextRow>
      </>
    </>
  )
}

export default VertexAISettings
