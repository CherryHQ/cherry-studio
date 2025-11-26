import { HStack } from '@renderer/components/Layout'
import { PROVIDER_URLS } from '@renderer/config/providers'
import { useVolcengineSettings } from '@renderer/hooks/useVolcengine'
import { Alert, Button, Input, Space } from 'antd'
import type { FC } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingHelpLink, SettingHelpText, SettingHelpTextRow, SettingSubtitle } from '..'

const VolcengineSettings: FC = () => {
  const { t } = useTranslation()
  const {
    accessKeyId,
    secretAccessKey,
    region,
    projectName,
    setAccessKeyId,
    setSecretAccessKey,
    setRegion,
    setProjectName
  } = useVolcengineSettings()

  const providerConfig = PROVIDER_URLS['doubao']
  const apiKeyWebsite = providerConfig?.websites?.apiKey

  const [localAccessKeyId, setLocalAccessKeyId] = useState(accessKeyId)
  const [localSecretAccessKey, setLocalSecretAccessKey] = useState(secretAccessKey)
  const [localRegion, setLocalRegion] = useState(region)
  const [localProjectName, setLocalProjectName] = useState(projectName)
  const [saving, setSaving] = useState(false)
  const [hasCredentials, setHasCredentials] = useState(false)

  // Check if credentials exist on mount
  useEffect(() => {
    window.api.volcengine.hasCredentials().then(setHasCredentials)
  }, [])

  // Sync local state with store
  useEffect(() => {
    setLocalAccessKeyId(accessKeyId)
    setLocalSecretAccessKey(secretAccessKey)
    setLocalRegion(region)
    setLocalProjectName(projectName)
  }, [accessKeyId, secretAccessKey, region, projectName])

  const handleSaveCredentials = useCallback(async () => {
    if (!localAccessKeyId || !localSecretAccessKey) {
      window.toast.error(t('settings.provider.volcengine.credentials_required'))
      return
    }

    setSaving(true)
    try {
      // Save to Redux store
      setAccessKeyId(localAccessKeyId)
      setSecretAccessKey(localSecretAccessKey)
      setRegion(localRegion)
      setProjectName(localProjectName)

      // Save to secure storage via IPC
      await window.api.volcengine.saveCredentials(localAccessKeyId, localSecretAccessKey)
      setHasCredentials(true)
      window.toast.success(t('settings.provider.volcengine.credentials_saved'))
    } catch (error) {
      window.toast.error(String(error))
    } finally {
      setSaving(false)
    }
  }, [
    localAccessKeyId,
    localSecretAccessKey,
    localRegion,
    localProjectName,
    setAccessKeyId,
    setSecretAccessKey,
    setRegion,
    setProjectName,
    t
  ])

  const handleClearCredentials = useCallback(async () => {
    try {
      await window.api.volcengine.clearCredentials()
      setAccessKeyId('')
      setSecretAccessKey('')
      setLocalAccessKeyId('')
      setLocalSecretAccessKey('')
      setHasCredentials(false)
      window.toast.success(t('settings.provider.volcengine.credentials_cleared'))
    } catch (error) {
      window.toast.error(String(error))
    }
  }, [setAccessKeyId, setSecretAccessKey, t])

  return (
    <>
      <SettingSubtitle style={{ marginTop: 5 }}>{t('settings.provider.volcengine.title')}</SettingSubtitle>
      <Alert type="info" style={{ marginTop: 5 }} message={t('settings.provider.volcengine.description')} showIcon />

      <SettingSubtitle style={{ marginTop: 15 }}>{t('settings.provider.volcengine.access_key_id')}</SettingSubtitle>
      <Input
        value={localAccessKeyId}
        placeholder="Access Key ID"
        onChange={(e) => setLocalAccessKeyId(e.target.value)}
        onBlur={() => setAccessKeyId(localAccessKeyId)}
        style={{ marginTop: 5 }}
        spellCheck={false}
      />
      <SettingHelpTextRow>
        <SettingHelpText>{t('settings.provider.volcengine.access_key_id_help')}</SettingHelpText>
      </SettingHelpTextRow>

      <SettingSubtitle style={{ marginTop: 15 }}>{t('settings.provider.volcengine.secret_access_key')}</SettingSubtitle>
      <Input.Password
        value={localSecretAccessKey}
        placeholder="Secret Access Key"
        onChange={(e) => setLocalSecretAccessKey(e.target.value)}
        onBlur={() => setSecretAccessKey(localSecretAccessKey)}
        style={{ marginTop: 5 }}
        spellCheck={false}
      />
      <SettingHelpTextRow style={{ justifyContent: 'space-between' }}>
        <HStack>
          {apiKeyWebsite && (
            <SettingHelpLink target="_blank" href={apiKeyWebsite}>
              {t('settings.provider.get_api_key')}
            </SettingHelpLink>
          )}
        </HStack>
        <SettingHelpText>{t('settings.provider.volcengine.secret_access_key_help')}</SettingHelpText>
      </SettingHelpTextRow>

      <SettingSubtitle style={{ marginTop: 15 }}>{t('settings.provider.volcengine.region')}</SettingSubtitle>
      <Input
        value={localRegion}
        placeholder="cn-beijing"
        onChange={(e) => setLocalRegion(e.target.value)}
        onBlur={() => setRegion(localRegion)}
        style={{ marginTop: 5 }}
      />
      <SettingHelpTextRow>
        <SettingHelpText>{t('settings.provider.volcengine.region_help')}</SettingHelpText>
      </SettingHelpTextRow>

      <SettingSubtitle style={{ marginTop: 15 }}>{t('settings.provider.volcengine.project_name')}</SettingSubtitle>
      <Input
        value={localProjectName}
        placeholder="default"
        onChange={(e) => setLocalProjectName(e.target.value)}
        onBlur={() => setProjectName(localProjectName)}
        style={{ marginTop: 5 }}
      />
      <SettingHelpTextRow>
        <SettingHelpText>{t('settings.provider.volcengine.project_name_help')}</SettingHelpText>
      </SettingHelpTextRow>

      <Space style={{ marginTop: 15 }}>
        <Button type="primary" onClick={handleSaveCredentials} loading={saving}>
          {t('settings.provider.volcengine.save_credentials')}
        </Button>
        {hasCredentials && (
          <Button danger onClick={handleClearCredentials}>
            {t('settings.provider.volcengine.clear_credentials')}
          </Button>
        )}
      </Space>
    </>
  )
}

export default VolcengineSettings
