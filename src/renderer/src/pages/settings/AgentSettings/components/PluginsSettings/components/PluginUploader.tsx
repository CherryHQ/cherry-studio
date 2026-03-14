import { usePluginInstall } from '@renderer/hooks/usePluginInstall'
import { Upload } from 'antd'
import { Package, Upload as UploadIcon } from 'lucide-react'
import type { FC } from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const { Dragger } = Upload

interface PluginUploaderProps {
  agentId: string
  onUploadSuccess?: () => void
  disabled?: boolean
}

export const PluginUploader: FC<PluginUploaderProps> = ({ agentId, onUploadSuccess, disabled }) => {
  const { t } = useTranslation()

  const { uploading, uploadFromFile, uploadFromDirectory } = usePluginInstall({
    agentId,
    onSuccess: (result) => {
      const packageCount = result.packages.length
      const installedCount = result.totalInstalled
      const failedCount = result.totalFailed

      if (failedCount === 0) {
        // All components installed successfully
        if (packageCount === 1) {
          // Single package
          window.toast.success(
            t('agent.settings.plugins.plugin_upload.success', {
              name: result.packages[0].pluginName,
              count: installedCount
            })
          )
        } else {
          // Multiple packages
          window.toast.success(
            t('agent.settings.plugins.plugin_upload.success_multi', {
              packages: packageCount,
              count: installedCount
            }) || `Installed ${installedCount} components from ${packageCount} packages`
          )
        }
      } else if (installedCount > 0) {
        // Partial success
        window.toast.warning(
          t('agent.settings.plugins.plugin_upload.partial_success', {
            installed: installedCount,
            failed: failedCount
          }) || `Installed ${installedCount} components, ${failedCount} failed`
        )
      } else {
        // All failed
        window.toast.error(
          t('agent.settings.plugins.plugin_upload.all_failed', {
            failed: failedCount
          }) || `All ${failedCount} components failed to install`
        )
      }
      onUploadSuccess?.()
    },
    onError: (error) => {
      window.toast.error(t('agent.settings.plugins.plugin_upload.error') + ': ' + error)
    }
  })

  const handleDrop = useCallback(
    async (file: File) => {
      if (disabled || uploading) return false

      // Get the file path (Electron-specific)
      const filePath = window.api.file.getPathForFile(file)
      if (!filePath) {
        window.toast.error(t('agent.settings.plugins.plugin_upload.error'))
        return false
      }

      // Check if it's a directory or a ZIP file
      const isDirectory = await window.api.file.isDirectory(filePath)

      if (isDirectory) {
        // Handle folder drop
        await uploadFromDirectory(filePath)
      } else if (file.name.toLowerCase().endsWith('.zip')) {
        // Handle ZIP file drop
        await uploadFromFile(file)
      } else {
        window.toast.error(t('agent.settings.plugins.plugin_upload.invalid_format'))
      }

      return false
    },
    [disabled, uploading, uploadFromFile, uploadFromDirectory, t]
  )

  return (
    <UploaderContainer>
      <Dragger
        showUploadList={false}
        beforeUpload={handleDrop}
        disabled={disabled || uploading}
        multiple={false}
        openFileDialogOnClick={true}>
        <UploadContent>
          <IconContainer>
            {uploading ? <UploadIcon className="animate-pulse" size={24} /> : <Package size={24} />}
          </IconContainer>
          <UploadText>
            {uploading
              ? t('agent.settings.plugins.plugin_upload.uploading')
              : t('agent.settings.plugins.plugin_upload.hint')}
          </UploadText>
          <UploadHint>{t('agent.settings.plugins.plugin_upload.format_hint')}</UploadHint>
        </UploadContent>
      </Dragger>
    </UploaderContainer>
  )
}

const UploaderContainer = styled.div`
  margin-bottom: 16px;

  .ant-upload-dragger {
    border-color: var(--color-border);
    background: var(--color-background);
    transition: all 0.2s ease;
    padding: 12px;

    &:hover {
      border-color: var(--color-primary);
    }
  }
`

const UploadContent = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
`

const IconContainer = styled.div`
  color: var(--color-text-secondary);
  margin-bottom: 4px;
`

const UploadText = styled.p`
  font-size: 13px;
  color: var(--color-text);
  margin: 0;
`

const UploadHint = styled.p`
  font-size: 11px;
  color: var(--color-text-secondary);
  margin: 0;
`

export default PluginUploader
