import { loggerService } from '@logger'
import { HStack } from '@renderer/components/Layout'
import { useVolcengineSettings } from '@renderer/hooks/useVolcengine'
import { Alert, Button, Input, Space } from 'antd'
import type { FC } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingHelpLink, SettingHelpText, SettingHelpTextRow, SettingSubtitle } from '..'
const accessKeyWebSite = 'https://console.volcengine.com/iam/identitymanage'

const VolcengineSettings: FC = () => {
  const { t } = useTranslation()
  const { region, projectName, setRegion, setProjectName } = useVolcengineSettings()

  const [localAccessKeyId, setLocalAccessKeyId] = useState('')
  const [localSecretAccessKey, setLocalSecretAccessKey] = useState('')
  const [localRegion, setLocalRegion] = useState(region)
  const [localProjectName, setLocalProjectName] = useState(projectName)
  const [saving, setSaving] = useState(false)
  const [hasCredentials, setHasCredentials] = useState(false)

  // Check if credentials exist on mount
  useEffect(() => {
    window.api.volcengine
      .hasCredentials()
      .then(setHasCredentials)
      .catch((error) => {
        loggerService.withContext('VolcengineSettings').error('Failed to check credentials:', error as Error)
        window.toast?.error('Failed to check Volcengine credentials')
      })
  }, [])

  // Sync local state with store (only for region and projectName)
  useEffect(() => {
    setLocalRegion(region)
    setLocalProjectName(projectName)
  }, [region, projectName])

  const handleSaveCredentials = useCallback(async () => {
    if (!localAccessKeyId || !localSecretAccessKey) {
      window.toast.error(t('settings.provider.volcengine.credentials_required'))
      return
    }

    setSaving(true)
    try {
      // Save credentials to secure storage via IPC first
      await window.api.volcengine.saveCredentials(localAccessKeyId, localSecretAccessKey)

      // Only update Redux after IPC success (for region and projectName only)
      setRegion(localRegion)
      setProjectName(localProjectName)

      setHasCredentials(true)
      // Clear local credential state after successful save (they're now in secure storage)
      setLocalAccessKeyId('')
      setLocalSecretAccessKey('')
      window.toast.success(t('settings.provider.volcengine.credentials_saved'))
    } catch (error) {
      loggerService.withContext('VolcengineSettings').error('Failed to save credentials:', error as Error)
      window.toast.error(t('settings.provider.volcengine.credentials_save_failed'))
    } finally {
      setSaving(false)
    }
  }, [localAccessKeyId, localSecretAccessKey, localRegion, localProjectName, setRegion, setProjectName, t])

  const handleClearCredentials = useCallback(async () => {
    try {
      await window.api.volcengine.clearCredentials()
      setLocalAccessKeyId('')
      setLocalSecretAccessKey('')
      setHasCredentials(false)
      window.toast.success(t('settings.provider.volcengine.credentials_cleared'))
    } catch (error) {
      loggerService.withContext('VolcengineSettings').error('Failed to clear credentials:', error as Error)
      window.toast.error(String(error))
    }
  }, [t])

  return (
    <>
      <SettingSubtitle style={{ marginTop: 5 }}>{t('settings.provider.volcengine.title')}</SettingSubtitle>
      <Alert type="info" style={{ marginTop: 5 }} message={t('settings.provider.volcengine.description')} showIcon />

      {!hasCredentials ? (
        <>
          <SettingSubtitle style={{ marginTop: 15 }}>{t('settings.provider.volcengine.access_key_id')}</SettingSubtitle>
          <Input
            value={localAccessKeyId}
            placeholder="Access Key ID"
            onChange={(e) => setLocalAccessKeyId(e.target.value)}
            style={{ marginTop: 5 }}
            spellCheck={false}
          />
          <SettingHelpTextRow>
            <SettingHelpText>{t('settings.provider.volcengine.access_key_id_help')}</SettingHelpText>
          </SettingHelpTextRow>

          <SettingSubtitle style={{ marginTop: 15 }}>
            {t('settings.provider.volcengine.secret_access_key')}
          </SettingSubtitle>
          <Input.Password
            value={localSecretAccessKey}
            placeholder="Secret Access Key"
            onChange={(e) => setLocalSecretAccessKey(e.target.value)}
            style={{ marginTop: 5 }}
            spellCheck={false}
          />
          <SettingHelpTextRow style={{ justifyContent: 'space-between' }}>
            <HStack>
              <SettingHelpLink target="_blank" href={accessKeyWebSite}>
                {t('settings.provider.get_api_key')}
              </SettingHelpLink>
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
        </>
      ) : (
        <Alert
          type="success"
          style={{ marginTop: 15 }}
          message={t('settings.provider.volcengine.credentials_saved_notice')}
          showIcon
        />
      )}

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
