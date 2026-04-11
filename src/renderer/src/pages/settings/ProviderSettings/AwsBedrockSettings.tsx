import { RowFlex } from '@cherrystudio/ui'
import { PROVIDER_URLS } from '@renderer/config/providers'
import { useProvider, useProviderAuthConfig } from '@renderer/data/hooks/useProviders'
import { Alert, Input, Radio } from 'antd'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingHelpLink, SettingHelpText, SettingHelpTextRow, SettingSubtitle } from '..'

interface Props {
  providerId: string
}

const AwsBedrockSettings: FC<Props> = ({ providerId }) => {
  const { t } = useTranslation()
  const { provider, updateAuthConfig } = useProvider(providerId)
  const { data: authConfig } = useProviderAuthConfig(providerId)

  const isIamMode = provider?.authType === 'iam-aws'
  const awsConfig = authConfig?.type === 'iam-aws' ? authConfig : null

  const providerConfig = PROVIDER_URLS['aws-bedrock']
  const apiKeyWebsite = providerConfig?.websites?.apiKey

  const [localAccessKeyId, setLocalAccessKeyId] = useState(awsConfig?.accessKeyId ?? '')
  const [localSecretAccessKey, setLocalSecretAccessKey] = useState(awsConfig?.secretAccessKey ?? '')
  const [localRegion, setLocalRegion] = useState(awsConfig?.region ?? '')

  useEffect(() => {
    const config = authConfig?.type === 'iam-aws' ? authConfig : null
    if (config) {
      setLocalAccessKeyId(config.accessKeyId ?? '')
      setLocalSecretAccessKey(config.secretAccessKey ?? '')
      setLocalRegion(config.region ?? '')
    }
  }, [authConfig])

  const handleAuthTypeChange = async (value: string) => {
    if (value === 'iam') {
      await updateAuthConfig({ type: 'iam-aws', region: localRegion || 'us-east-1' })
    } else {
      await updateAuthConfig({ type: 'api-key' })
    }
  }

  const saveIamConfig = async () => {
    await updateAuthConfig({
      type: 'iam-aws' as const,
      region: localRegion,
      accessKeyId: localAccessKeyId,
      secretAccessKey: localSecretAccessKey
    })
  }

  const saveRegion = async () => {
    if (isIamMode) {
      await saveIamConfig()
    }
  }

  return (
    <>
      <SettingSubtitle style={{ marginTop: 5 }}>{t('settings.provider.aws-bedrock.title')}</SettingSubtitle>
      <Alert type="info" style={{ marginTop: 5 }} message={t('settings.provider.aws-bedrock.description')} showIcon />

      {/* Authentication Type Selector */}
      <SettingSubtitle style={{ marginTop: 15 }}>{t('settings.provider.aws-bedrock.auth_type')}</SettingSubtitle>
      <Radio.Group
        value={isIamMode ? 'iam' : 'apiKey'}
        onChange={(e) => handleAuthTypeChange(e.target.value)}
        style={{ marginTop: 5 }}>
        <Radio value="iam">{t('settings.provider.aws-bedrock.auth_type_iam')}</Radio>
        <Radio value="apiKey">{t('settings.provider.aws-bedrock.auth_type_api_key')}</Radio>
      </Radio.Group>
      <SettingHelpTextRow>
        <SettingHelpText>{t('settings.provider.aws-bedrock.auth_type_help')}</SettingHelpText>
      </SettingHelpTextRow>

      {/* IAM Credentials Fields */}
      {isIamMode && (
        <>
          <SettingSubtitle style={{ marginTop: 15 }}>
            {t('settings.provider.aws-bedrock.access_key_id')}
          </SettingSubtitle>
          <Input
            value={localAccessKeyId}
            placeholder={t('settings.provider.aws-bedrock.access_key_id')}
            onChange={(e) => setLocalAccessKeyId(e.target.value)}
            onBlur={saveIamConfig}
            style={{ marginTop: 5 }}
          />
          <SettingHelpTextRow>
            <SettingHelpText>{t('settings.provider.aws-bedrock.access_key_id_help')}</SettingHelpText>
          </SettingHelpTextRow>

          <SettingSubtitle style={{ marginTop: 15 }}>
            {t('settings.provider.aws-bedrock.secret_access_key')}
          </SettingSubtitle>
          <Input.Password
            value={localSecretAccessKey}
            placeholder={t('settings.provider.aws-bedrock.secret_access_key')}
            onChange={(e) => setLocalSecretAccessKey(e.target.value)}
            onBlur={saveIamConfig}
            style={{ marginTop: 5 }}
            spellCheck={false}
          />
          {apiKeyWebsite && (
            <SettingHelpTextRow style={{ justifyContent: 'space-between' }}>
              <RowFlex>
                <SettingHelpLink target="_blank" href={apiKeyWebsite}>
                  {t('settings.provider.get_api_key')}
                </SettingHelpLink>
              </RowFlex>
              <SettingHelpText>{t('settings.provider.aws-bedrock.secret_access_key_help')}</SettingHelpText>
            </SettingHelpTextRow>
          )}
        </>
      )}

      <SettingSubtitle style={{ marginTop: 15 }}>{t('settings.provider.aws-bedrock.region')}</SettingSubtitle>
      <Input
        value={localRegion}
        placeholder="us-east-1"
        onChange={(e) => setLocalRegion(e.target.value)}
        onBlur={saveRegion}
        style={{ marginTop: 5 }}
      />
      <SettingHelpTextRow>
        <SettingHelpText>{t('settings.provider.aws-bedrock.region_help')}</SettingHelpText>
      </SettingHelpTextRow>
    </>
  )
}

export default AwsBedrockSettings
