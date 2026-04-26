import { RowFlex } from '@cherrystudio/ui'
import { useProviderAuthConfig, useProviderMutations, useProviderPresetMetadata } from '@renderer/hooks/useProviders'
import { Alert, Input } from 'antd'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingHelpLink, SettingHelpText, SettingHelpTextRow, SettingSubtitle } from '..'

interface Props {
  providerId: string
}

const VertexAISettings: FC<Props> = ({ providerId }) => {
  const { t } = useTranslation()
  const { data: authConfig } = useProviderAuthConfig(providerId)
  const { data: presetMetadata } = useProviderPresetMetadata(providerId)
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

  const apiKeyWebsite = presetMetadata?.websites?.apiKey

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
