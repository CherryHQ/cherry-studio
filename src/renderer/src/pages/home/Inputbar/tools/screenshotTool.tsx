import { loggerService } from '@logger'
import { ActionIconButton } from '@renderer/components/Buttons'
import { defineTool, registerTool, TopicType } from '@renderer/pages/home/Inputbar/types'
import type { FileType } from '@renderer/types'
import { FileTypes } from '@renderer/types'
import type { MenuProps } from 'antd'
import { Dropdown } from 'antd'
import { Camera, ChevronDown } from 'lucide-react'
import { useCallback, useState } from 'react'

const logger = loggerService.withContext('ScreenshotTool')

const ScreenshotTool = ({ context }) => {
  const { actions, t } = context
  const [isCapturing, setIsCapturing] = useState(false)

  const showPermissionDialog = useCallback(
    (needsRestart: boolean = false) => {
      const content = needsRestart
        ? (t('chat.input.screenshot.permission_granted_restart') ??
          'Permission has been granted. Please restart the application for the changes to take effect.')
        : (t('chat.input.screenshot.permission_dialog_content') ??
          'Screenshot feature requires screen recording permission. Would you like to open system settings to grant permission?')

      window.modal.confirm({
        title: t('chat.input.screenshot.permission_dialog_title') ?? 'Screen Recording Permission Required',
        content,
        centered: true,
        okText: needsRestart ? (t('common.ok') ?? 'OK') : (t('chat.input.screenshot.open_settings') ?? 'Open Settings'),
        cancelText: needsRestart ? undefined : (t('chat.input.screenshot.cancel') ?? 'Cancel'),
        onOk: () => {
          if (!needsRestart && window.electron.process.platform === 'darwin') {
            void window.api.shell.openExternal(
              'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
            )
          }
        }
      })
    },
    [t]
  )

  const handleCapture = useCallback(async () => {
    if (isCapturing) return
    setIsCapturing(true)
    try {
      // Directly try to capture - this will trigger system permission dialog on first use
      const fileName = `screenshot_${Date.now()}.png`
      const result = await window.api.screenshot.capture(fileName)

      if (!result.success) {
        // Handle permission errors
        if (result.status === 'denied') {
          if (result.needsRestart) {
            showPermissionDialog(true)
          } else {
            showPermissionDialog(false)
          }
        } else {
          logger.error('Screenshot capture failed', new Error(result.message))
          window.toast?.error(t('chat.input.screenshot.capture_failed') ?? 'Failed to capture screenshot')
        }
        return
      }

      // Normalize to FileType
      const nextFile: FileType = {
        ...result.file,
        type: FileTypes.IMAGE
      }

      actions.setFiles((prev) => [...prev, nextFile])
    } catch (error: any) {
      logger.error('Screenshot capture failed', error as Error)
      window.toast?.error(t('chat.input.screenshot.capture_failed') ?? 'Failed to capture screenshot')
    } finally {
      setIsCapturing(false)
    }
  }, [actions, isCapturing, showPermissionDialog, t])

  const handleCaptureWithSelection = useCallback(async () => {
    if (isCapturing) return
    setIsCapturing(true)
    try {
      const fileName = `screenshot_${Date.now()}.png`
      const result = await window.api.screenshot.captureWithSelection(fileName)

      if (!result.success) {
        // Handle different status types
        if (result.status === 'denied') {
          if (result.needsRestart) {
            showPermissionDialog(true)
          } else {
            showPermissionDialog(false)
          }
        } else if (result.status === 'cancelled') {
          logger.info('User cancelled screenshot selection')
          // No toast for cancelled - user intentionally cancelled
        } else {
          logger.error('Screenshot selection failed', new Error(result.message))
          window.toast?.error(t('chat.input.screenshot.capture_failed') ?? 'Failed to capture screenshot')
        }
        return
      }

      // Normalize to FileType
      const nextFile: FileType = {
        ...result.file,
        type: FileTypes.IMAGE
      }

      actions.setFiles((prev) => [...prev, nextFile])
    } catch (error: any) {
      logger.error('Screenshot selection failed', error as Error)
      window.toast?.error(t('chat.input.screenshot.capture_failed') ?? 'Failed to capture screenshot')
    } finally {
      setIsCapturing(false)
    }
  }, [actions, isCapturing, showPermissionDialog, t])

  const menuItems: MenuProps['items'] = [
    {
      key: 'full',
      label: t('chat.input.screenshot.full_screen') ?? 'Full Screen',
      onClick: handleCapture
    },
    {
      key: 'region',
      label: t('chat.input.screenshot.select_region') ?? 'Select Region',
      onClick: handleCaptureWithSelection
    }
  ]

  return (
    <Dropdown menu={{ items: menuItems }} trigger={['click']} disabled={isCapturing}>
      <ActionIconButton loading={isCapturing} disabled={isCapturing}>
        <Camera size={16} />
        <ChevronDown size={12} style={{ marginLeft: 2 }} />
      </ActionIconButton>
    </Dropdown>
  )
}

const screenshotTool = defineTool({
  key: 'screenshot',
  label: (t) => t('chat.input.tools.screenshot') ?? 'Screenshot',

  visibleInScopes: [TopicType.Chat, TopicType.Session, 'mini-window'],

  dependencies: {
    state: ['files'] as const,
    actions: ['setFiles'] as const
  },

  render: (context) => <ScreenshotTool context={context} />
})

registerTool(screenshotTool)

export default screenshotTool
