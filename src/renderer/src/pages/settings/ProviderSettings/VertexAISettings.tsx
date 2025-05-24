import { useVertexAISettings } from '@renderer/hooks/useVertexAI'
import { Provider } from '@renderer/types'
import { Alert, Input } from 'antd'
import { FC, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingHelpText, SettingHelpTextRow, SettingSubtitle } from '..'

interface VertexAISettingsProps {
  provider: Provider
}

const VertexAISettings: FC<VertexAISettingsProps> = ({ provider }) => {
  console.log('provider', provider)
  const { t } = useTranslation()
  const {
    projectId,
    location,
    serviceAccount,
    setProjectId,
    setLocation,
    setServiceAccountPrivateKey,
    setServiceAccountClientEmail
  } = useVertexAISettings()

  const [localProjectId, setLocalProjectId] = useState(projectId)
  const [localLocation, setLocalLocation] = useState(location)

  const handleProjectIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalProjectId(e.target.value)
  }

  const handleLocationChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newLocation = e.target.value
    setLocalLocation(newLocation)
  }

  const handleServiceAccountPrivateKeyChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setServiceAccountPrivateKey(e.target.value)
  }

  const handleServiceAccountPrivateKeyBlur = () => {
    setServiceAccountPrivateKey(serviceAccount.privateKey)
  }

  const handleServiceAccountClientEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setServiceAccountClientEmail(e.target.value)
  }

  const handleServiceAccountClientEmailBlur = () => {
    setServiceAccountClientEmail(serviceAccount.clientEmail)
  }

  const handleProjectIdBlur = () => {
    setProjectId(localProjectId)
  }

  const handleLocationBlur = () => {
    setLocation(localLocation)
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
        value={serviceAccount.clientEmail}
        placeholder={t('settings.provider.vertex_ai.service_account.client_email_placeholder')}
        onChange={handleServiceAccountClientEmailChange}
        onBlur={handleServiceAccountClientEmailBlur}
        style={{ marginTop: 5 }}
      />
      <SettingHelpTextRow>
        <SettingHelpText>{t('settings.provider.vertex_ai.service_account.client_email_help')}</SettingHelpText>
      </SettingHelpTextRow>

      <SettingSubtitle style={{ marginTop: 5 }}>
        {t('settings.provider.vertex_ai.service_account.private_key')}
      </SettingSubtitle>
      <Input.TextArea
        value={serviceAccount.privateKey}
        placeholder={t('settings.provider.vertex_ai.service_account.private_key_placeholder')}
        onChange={handleServiceAccountPrivateKeyChange}
        onBlur={handleServiceAccountPrivateKeyBlur}
        style={{ marginTop: 5 }}
        spellCheck={false}
        autoSize={{ minRows: 4, maxRows: 4 }}
      />
      <SettingHelpTextRow>
        <SettingHelpText>{t('settings.provider.vertex_ai.service_account.private_key_help')}</SettingHelpText>
      </SettingHelpTextRow>

      <>
        <SettingSubtitle style={{ marginTop: 5 }}>{t('settings.provider.vertex_ai.project_id')}</SettingSubtitle>
        <Input.Password
          value={localProjectId}
          placeholder={t('settings.provider.vertex_ai.project_id_placeholder')}
          onChange={handleProjectIdChange}
          onBlur={handleProjectIdBlur}
          style={{ marginTop: 5 }}
        />
        <SettingHelpTextRow>
          <SettingHelpText>{t('settings.provider.vertex_ai.project_id_help')}</SettingHelpText>
        </SettingHelpTextRow>

        <SettingSubtitle style={{ marginTop: 5 }}>{t('settings.provider.vertex_ai.location')}</SettingSubtitle>
        <Input
          value={localLocation}
          placeholder="us-central1"
          onChange={handleLocationChange}
          onBlur={handleLocationBlur}
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
