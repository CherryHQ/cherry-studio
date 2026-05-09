import { Input, Label, RadioGroup, RadioGroupItem, RowFlex } from '@cherrystudio/ui'
import { useProvider, useProviderAuthConfig, useProviderPresetMetadata } from '@renderer/hooks/useProviders'
import { Info } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAuthenticationApiKey } from '../hooks/providerSetting/useAuthenticationApiKey'
import {
  ProviderHelpLink,
  ProviderHelpText,
  ProviderHelpTextRow,
  ProviderSettingsSubtitle
} from '../shared/primitives/ProviderSettingsPrimitives'

interface Props {
  providerId: string
}

const AwsBedrockSettings: FC<Props> = ({ providerId }) => {
  const { t } = useTranslation()
  const { provider, updateAuthConfig } = useProvider(providerId)
  const { data: authConfig } = useProviderAuthConfig(providerId)
  const { data: presetMetadata } = useProviderPresetMetadata(providerId)
  const { inputApiKey, setInputApiKey, commitInputApiKeyNow } = useAuthenticationApiKey()

  const isIamMode = provider?.authType === 'iam-aws'
  const awsConfig = authConfig?.type === 'iam-aws' ? authConfig : null

  const apiKeyWebsite = presetMetadata?.websites?.apiKey

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

  const authMode = isIamMode ? 'iam' : 'apiKey'

  return (
    <>
      <ProviderSettingsSubtitle className="mt-1.5">{t('settings.provider.aws-bedrock.title')}</ProviderSettingsSubtitle>
      <div
        className="mt-1.5 flex gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2.5 text-foreground text-sm"
        role="status">
        <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <span>{t('settings.provider.aws-bedrock.description')}</span>
      </div>

      <ProviderSettingsSubtitle className="mt-4">
        {t('settings.provider.aws-bedrock.auth_type')}
      </ProviderSettingsSubtitle>
      <RadioGroup
        className="mt-1.5 flex flex-col gap-2"
        value={authMode}
        onValueChange={(v) => {
          void handleAuthTypeChange(v)
        }}>
        <div className="flex items-start gap-2">
          <RadioGroupItem value="iam" id="aws-bedrock-auth-iam" className="mt-0.5" />
          <Label htmlFor="aws-bedrock-auth-iam" className="cursor-pointer font-normal leading-snug">
            {t('settings.provider.aws-bedrock.auth_type_iam')}
          </Label>
        </div>
        <div className="flex items-start gap-2">
          <RadioGroupItem value="apiKey" id="aws-bedrock-auth-apikey" className="mt-0.5" />
          <Label htmlFor="aws-bedrock-auth-apikey" className="cursor-pointer font-normal leading-snug">
            {t('settings.provider.aws-bedrock.auth_type_api_key')}
          </Label>
        </div>
      </RadioGroup>
      <ProviderHelpTextRow>
        <ProviderHelpText>{t('settings.provider.aws-bedrock.auth_type_help')}</ProviderHelpText>
      </ProviderHelpTextRow>

      {isIamMode && (
        <>
          <ProviderSettingsSubtitle className="mt-4">
            {t('settings.provider.aws-bedrock.access_key_id')}
          </ProviderSettingsSubtitle>
          <Input
            className="mt-1.5 w-full"
            value={localAccessKeyId}
            placeholder={t('settings.provider.aws-bedrock.access_key_id')}
            onChange={(e) => setLocalAccessKeyId(e.target.value)}
            onBlur={saveIamConfig}
          />
          <ProviderHelpTextRow>
            <ProviderHelpText>{t('settings.provider.aws-bedrock.access_key_id_help')}</ProviderHelpText>
          </ProviderHelpTextRow>

          <ProviderSettingsSubtitle className="mt-4">
            {t('settings.provider.aws-bedrock.secret_access_key')}
          </ProviderSettingsSubtitle>
          <Input
            className="mt-1.5 w-full"
            type="password"
            value={localSecretAccessKey}
            placeholder={t('settings.provider.aws-bedrock.secret_access_key')}
            onChange={(e) => setLocalSecretAccessKey(e.target.value)}
            onBlur={saveIamConfig}
            spellCheck={false}
          />
          {apiKeyWebsite && (
            <ProviderHelpTextRow className="justify-between">
              <RowFlex>
                <ProviderHelpLink target="_blank" href={apiKeyWebsite}>
                  {t('settings.provider.get_api_key')}
                </ProviderHelpLink>
              </RowFlex>
              <ProviderHelpText>{t('settings.provider.aws-bedrock.secret_access_key_help')}</ProviderHelpText>
            </ProviderHelpTextRow>
          )}
        </>
      )}

      {!isIamMode && (
        <>
          <ProviderSettingsSubtitle className="mt-4">
            {t('settings.provider.aws-bedrock.api_key')}
          </ProviderSettingsSubtitle>
          <Input
            className="mt-1.5 w-full"
            type="password"
            value={inputApiKey}
            placeholder={t('settings.provider.aws-bedrock.api_key')}
            onChange={(e) => setInputApiKey(e.target.value)}
            onBlur={() => void commitInputApiKeyNow()}
            spellCheck={false}
          />
          <ProviderHelpTextRow>
            <ProviderHelpText>{t('settings.provider.aws-bedrock.api_key_help')}</ProviderHelpText>
          </ProviderHelpTextRow>
        </>
      )}

      <ProviderSettingsSubtitle className="mt-4">{t('settings.provider.aws-bedrock.region')}</ProviderSettingsSubtitle>
      <Input
        className="mt-1.5 w-full"
        value={localRegion}
        placeholder="us-east-1"
        onChange={(e) => setLocalRegion(e.target.value)}
        onBlur={saveRegion}
      />
      <ProviderHelpTextRow>
        <ProviderHelpText>{t('settings.provider.aws-bedrock.region_help')}</ProviderHelpText>
      </ProviderHelpTextRow>
    </>
  )
}

export default AwsBedrockSettings
