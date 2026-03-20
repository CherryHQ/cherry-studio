import { HStack } from '@renderer/components/Layout'
import { PROVIDER_URLS } from '@renderer/config/providers'
import { useAwsBedrockSettings } from '@renderer/hooks/useAwsBedrock'
import { Alert, Button, Input, message, Radio } from 'antd'
import type { FC } from 'react'
import { useCallback, useState } from 'react'
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
    ssoStartUrl,
    ssoRegion,
    ssoAccountId,
    ssoRoleName,
    setAuthType,
    setAccessKeyId,
    setSecretAccessKey,
    setApiKey,
    setRegion,
    setSSOStartUrl,
    setSSORegion,
    setSSOAccountId,
    setSSORoleName
  } = useAwsBedrockSettings()

  const providerConfig = PROVIDER_URLS['aws-bedrock']
  const apiKeyWebsite = providerConfig?.websites?.apiKey

  const [localAccessKeyId, setLocalAccessKeyId] = useState(accessKeyId)
  const [localSecretAccessKey, setLocalSecretAccessKey] = useState(secretAccessKey)
  const [localApiKey, setLocalApiKey] = useState(apiKey)
  const [localRegion, setLocalRegion] = useState(region)
  const [localSSOStartUrl, setLocalSSOStartUrl] = useState(ssoStartUrl)
  const [localSSORegion, setLocalSSORegion] = useState(ssoRegion)
  const [localSSOAccountId, setLocalSSOAccountId] = useState(ssoAccountId)
  const [localSSORoleName, setLocalSSORoleName] = useState(ssoRoleName)
  const [ssoLoggingIn, setSSOLoggingIn] = useState(false)

  const handleSSOLogin = useCallback(async () => {
    setSSOLoggingIn(true)
    try {
      await window.api.awsBedrock.ssoLogin({
        startUrl: ssoStartUrl,
        ssoRegion,
        accountId: ssoAccountId,
        roleName: ssoRoleName
      })
      message.success(t('settings.provider.aws-bedrock.sso_login_success'))
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      message.error(errorMessage)
    } finally {
      setSSOLoggingIn(false)
    }
  }, [ssoStartUrl, ssoRegion, ssoAccountId, ssoRoleName, t])

  return (
    <>
      <SettingSubtitle style={{ marginTop: 5 }}>{t('settings.provider.aws-bedrock.title')}</SettingSubtitle>
      <Alert type="info" style={{ marginTop: 5 }} message={t('settings.provider.aws-bedrock.description')} showIcon />

      {/* Authentication Type Selector */}
      <SettingSubtitle style={{ marginTop: 15 }}>{t('settings.provider.aws-bedrock.auth_type')}</SettingSubtitle>
      <Radio.Group value={authType} onChange={(e) => setAuthType(e.target.value)} style={{ marginTop: 5 }}>
        <Radio value="iam">{t('settings.provider.aws-bedrock.auth_type_iam')}</Radio>
        <Radio value="apiKey">{t('settings.provider.aws-bedrock.auth_type_api_key')}</Radio>
        <Radio value="sso">{t('settings.provider.aws-bedrock.auth_type_sso')}</Radio>
      </Radio.Group>
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
          <Input.Password
            value={localSecretAccessKey}
            placeholder={t('settings.provider.aws-bedrock.secret_access_key')}
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
        </>
      )}

      {authType === 'apiKey' && (
        <>
          <SettingSubtitle style={{ marginTop: 15 }}>{t('settings.provider.aws-bedrock.api_key')}</SettingSubtitle>
          <Input.Password
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

      {authType === 'sso' && (
        <>
          <SettingSubtitle style={{ marginTop: 15 }}>
            {t('settings.provider.aws-bedrock.sso_start_url')}
          </SettingSubtitle>
          <Input
            value={localSSOStartUrl}
            placeholder="https://my-sso-portal.awsapps.com/start"
            onChange={(e) => setLocalSSOStartUrl(e.target.value)}
            onBlur={() => setSSOStartUrl(localSSOStartUrl)}
            style={{ marginTop: 5 }}
          />
          <SettingHelpTextRow>
            <SettingHelpText>{t('settings.provider.aws-bedrock.sso_start_url_help')}</SettingHelpText>
          </SettingHelpTextRow>

          <SettingSubtitle style={{ marginTop: 15 }}>{t('settings.provider.aws-bedrock.sso_region')}</SettingSubtitle>
          <Input
            value={localSSORegion}
            placeholder="us-east-1"
            onChange={(e) => setLocalSSORegion(e.target.value)}
            onBlur={() => setSSORegion(localSSORegion)}
            style={{ marginTop: 5 }}
          />
          <SettingHelpTextRow>
            <SettingHelpText>{t('settings.provider.aws-bedrock.sso_region_help')}</SettingHelpText>
          </SettingHelpTextRow>

          <SettingSubtitle style={{ marginTop: 15 }}>
            {t('settings.provider.aws-bedrock.sso_account_id')}
          </SettingSubtitle>
          <Input
            value={localSSOAccountId}
            placeholder="123456789012"
            onChange={(e) => setLocalSSOAccountId(e.target.value)}
            onBlur={() => setSSOAccountId(localSSOAccountId)}
            style={{ marginTop: 5 }}
          />
          <SettingHelpTextRow>
            <SettingHelpText>{t('settings.provider.aws-bedrock.sso_account_id_help')}</SettingHelpText>
          </SettingHelpTextRow>

          <SettingSubtitle style={{ marginTop: 15 }}>
            {t('settings.provider.aws-bedrock.sso_role_name')}
          </SettingSubtitle>
          <Input
            value={localSSORoleName}
            placeholder="BedrockFullAccess"
            onChange={(e) => setLocalSSORoleName(e.target.value)}
            onBlur={() => setSSORoleName(localSSORoleName)}
            style={{ marginTop: 5 }}
          />
          <SettingHelpTextRow>
            <SettingHelpText>{t('settings.provider.aws-bedrock.sso_role_name_help')}</SettingHelpText>
          </SettingHelpTextRow>

          <Button
            type="primary"
            loading={ssoLoggingIn}
            disabled={!ssoStartUrl || !ssoRegion || !ssoAccountId || !ssoRoleName}
            onClick={handleSSOLogin}
            style={{ marginTop: 10 }}>
            {t('settings.provider.aws-bedrock.sso_login')}
          </Button>
          <SettingHelpTextRow>
            <SettingHelpText>{t('settings.provider.aws-bedrock.sso_login_help')}</SettingHelpText>
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
