import { Alert, Input, RadioGroup, RadioGroupItem, RowFlex } from '@cherrystudio/ui'
import { PROVIDER_URLS } from '@renderer/config/providers'
import { useAwsBedrockSettings } from '@renderer/hooks/useAwsBedrock'
import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingHelpLink, SettingHelpText, SettingHelpTextRow, SettingSubtitle } from '..'

const AwsBedrockSettings: FC = () => {
  const { t } = useTranslation()
  const {
    authType,
    accessKeyId,
    secretAccessKey,
    apiKey,
    region,
    setAuthType,
    setAccessKeyId,
    setSecretAccessKey,
    setApiKey,
    setRegion
  } = useAwsBedrockSettings()

  const providerConfig = PROVIDER_URLS['aws-bedrock']
  const apiKeyWebsite = providerConfig?.websites?.apiKey

  const [localAccessKeyId, setLocalAccessKeyId] = useState(accessKeyId)
  const [localSecretAccessKey, setLocalSecretAccessKey] = useState(secretAccessKey)
  const [localApiKey, setLocalApiKey] = useState(apiKey)
  const [localRegion, setLocalRegion] = useState(region)

  return (
    <>
      <SettingSubtitle style={{ marginTop: 5 }}>{t('settings.provider.aws-bedrock.title')}</SettingSubtitle>
      <Alert type="info" className="mt-1.25" message={t('settings.provider.aws-bedrock.description')} showIcon />

      {/* Authentication Type Selector */}
      <SettingSubtitle style={{ marginTop: 15 }}>{t('settings.provider.aws-bedrock.auth_type')}</SettingSubtitle>
      <RadioGroup value={authType} onValueChange={setAuthType} className="mt-1.25 flex gap-4">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <RadioGroupItem size="sm" value="iam" />
          <span>{t('settings.provider.aws-bedrock.auth_type_iam')}</span>
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <RadioGroupItem size="sm" value="apiKey" />
          <span>{t('settings.provider.aws-bedrock.auth_type_api_key')}</span>
        </label>
      </RadioGroup>
      <SettingHelpTextRow>
        <SettingHelpText>{t('settings.provider.aws-bedrock.auth_type_help')}</SettingHelpText>
      </SettingHelpTextRow>

      {/* IAM Credentials Fields */}
      {authType === 'iam' && (
        <>
          <SettingSubtitle style={{ marginTop: 15 }}>
            {t('settings.provider.aws-bedrock.access_key_id')}
          </SettingSubtitle>
          <Input
            value={localAccessKeyId}
            placeholder={t('settings.provider.aws-bedrock.access_key_id')}
            onChange={(e) => setLocalAccessKeyId(e.target.value)}
            onBlur={() => setAccessKeyId(localAccessKeyId)}
            style={{ marginTop: 5 }}
          />
          <SettingHelpTextRow>
            <SettingHelpText>{t('settings.provider.aws-bedrock.access_key_id_help')}</SettingHelpText>
          </SettingHelpTextRow>

          <SettingSubtitle style={{ marginTop: 15 }}>
            {t('settings.provider.aws-bedrock.secret_access_key')}
          </SettingSubtitle>
          <Input
            type="password"
            value={localSecretAccessKey}
            placeholder={t('settings.provider.aws-bedrock.secret_access_key')}
            onChange={(e) => setLocalSecretAccessKey(e.target.value)}
            onBlur={() => setSecretAccessKey(localSecretAccessKey)}
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

      {authType === 'apiKey' && (
        <>
          <SettingSubtitle style={{ marginTop: 15 }}>{t('settings.provider.aws-bedrock.api_key')}</SettingSubtitle>
          <Input
            type="password"
            value={localApiKey}
            placeholder={t('settings.provider.aws-bedrock.api_key')}
            onChange={(e) => setLocalApiKey(e.target.value)}
            onBlur={() => setApiKey(localApiKey)}
            style={{ marginTop: 5 }}
            spellCheck={false}
          />
          <SettingHelpTextRow>
            <SettingHelpText>{t('settings.provider.aws-bedrock.api_key_help')}</SettingHelpText>
          </SettingHelpTextRow>
        </>
      )}

      <SettingSubtitle style={{ marginTop: 15 }}>{t('settings.provider.aws-bedrock.region')}</SettingSubtitle>
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
