import { HStack } from '@renderer/components/Layout'
import { PROVIDER_URLS } from '@renderer/config/providers'
import { useAwsBedrockSettings } from '@renderer/hooks/useAwsBedrock'
import { Alert, Input } from 'antd'
import { FC, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingHelpLink, SettingHelpText, SettingHelpTextRow, SettingSubtitle } from '..'

const AwsBedrockSettings: FC = () => {
  const { t } = useTranslation()
  const { accessKeyId, secretAccessKey, region, setAccessKeyId, setSecretAccessKey, setRegion } =
    useAwsBedrockSettings()

  const providerConfig = PROVIDER_URLS['aws-bedrock']
  const apiKeyWebsite = providerConfig?.websites?.apiKey

  const [localAccessKeyId, setLocalAccessKeyId] = useState(accessKeyId)
  const [localSecretAccessKey, setLocalSecretAccessKey] = useState(secretAccessKey)
  const [localRegion, setLocalRegion] = useState(region)

  return (
    <>
      <SettingSubtitle style={{ marginTop: 5 }}>{t('settings.provider.aws-bedrock.title')}</SettingSubtitle>
      <Alert type="info" style={{ marginTop: 5 }} message={t('settings.provider.aws-bedrock.description')} showIcon />

      <SettingSubtitle style={{ marginTop: 5 }}>{t('settings.provider.aws-bedrock.access_key_id')}</SettingSubtitle>
      <Input
        value={localAccessKeyId}
        placeholder="Access Key ID"
        onChange={(e) => setLocalAccessKeyId(e.target.value)}
        onBlur={() => setAccessKeyId(localAccessKeyId)}
        style={{ marginTop: 5 }}
      />
      <SettingHelpTextRow>
        <SettingHelpText>{t('settings.provider.aws-bedrock.access_key_id_help')}</SettingHelpText>
      </SettingHelpTextRow>

      <SettingSubtitle style={{ marginTop: 5 }}>{t('settings.provider.aws-bedrock.secret_access_key')}</SettingSubtitle>
      <Input.Password
        value={localSecretAccessKey}
        placeholder="Secret Access Key"
        onChange={(e) => setLocalSecretAccessKey(e.target.value)}
        onBlur={() => setSecretAccessKey(localSecretAccessKey)}
        style={{ marginTop: 5 }}
        spellCheck={false}
      />
      {apiKeyWebsite && (
        <SettingHelpTextRow style={{ justifyContent: 'space-between' }}>
          <HStack>
            <SettingHelpLink target="_blank" href={apiKeyWebsite}>
              {t('settings.provider.get_api_key')}
            </SettingHelpLink>
          </HStack>
          <SettingHelpText>{t('settings.provider.aws-bedrock.secret_access_key_help')}</SettingHelpText>
        </SettingHelpTextRow>
      )}

      <SettingSubtitle style={{ marginTop: 5 }}>{t('settings.provider.aws-bedrock.region')}</SettingSubtitle>
      <Input
        value={localRegion}
        placeholder="us-east-1"
        onChange={(e) => setLocalRegion(e.target.value)}
        onBlur={() => setRegion(localRegion)}
        style={{ marginTop: 5 }}
      />
      <SettingHelpTextRow>
        <SettingHelpText>{t('settings.provider.aws-bedrock.region_help')}</SettingHelpText>
      </SettingHelpTextRow>
    </>
  )
}

export default AwsBedrockSettings
