import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { attachImageBytes } from '@renderer/components/composer/paste/pasteHandling'
import { getQuickPanelSearchAliases } from '@renderer/components/composer/quickPanel'
import { SCREENSHOT_TOOLBAR_MANIFEST } from '@renderer/components/composer/tools/toolbarManifests'
import { defineTool, type ToolLauncherApi } from '@renderer/components/composer/tools/types'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { getFileExtension } from '@renderer/utils/file'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import type { Dispatch, FC, SetStateAction } from 'react'
import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('screenshotTool')

const SCREENSHOT_FILE_NAME = 'screenshot.png'

interface Props {
  launcher: ToolLauncherApi
  couldAddImageFile: boolean
  extensions: string[]
  setFiles: Dispatch<SetStateAction<ComposerAttachment[]>>
}

/**
 * Region capture, staged as an attachment. Main copies the result to the clipboard and
 * hands the same bytes to the window that asked via `screenshot.captured`, so the
 * attachment does not depend on what the clipboard holds by the time this runs.
 */
const useScreenshotToolController = ({ launcher, couldAddImageFile, extensions, setFiles }: Props) => {
  const { t } = useTranslation()
  const [screenshotEnabled] = usePreference('feature.screenshot.enabled')
  const supported = couldAddImageFile && extensions.includes(getFileExtension(SCREENSHOT_FILE_NAME))

  const attachCapture = useCallback(
    async (pngBytes: Uint8Array) => {
      try {
        if (!(await attachImageBytes(SCREENSHOT_FILE_NAME, pngBytes, setFiles))) {
          throw new Error('Could not read the screenshot back from its temporary file')
        }
      } catch (error) {
        // The capture is still on the clipboard, so say so rather than letting the
        // button look like it did nothing.
        logger.error('Failed to attach the screenshot', error as Error)
        toast.error(t('chat.input.screenshot_attach_failed'))
      }
    },
    [setFiles, t]
  )

  useIpcOn('screenshot.captured', ({ pngBytes }) => void attachCapture(pngBytes))

  useEffect(() => {
    if (!screenshotEnabled) return
    return launcher.registerLaunchers([
      {
        ...SCREENSHOT_TOOLBAR_MANIFEST.toolbar,
        sources: ['popover'],
        label: t('chat.input.screenshot'),
        description: '',
        searchAliases: getQuickPanelSearchAliases(t, 'chat.input.screenshot', ['screenshot']),
        disabledReason: supported ? undefined : t('chat.input.upload.image_not_supported'),
        disabled: !supported,
        action: () => void ipcApi.request('screenshot.capture')
      }
    ])
  }, [launcher, screenshotEnabled, supported, t])
}

const ScreenshotComposerRuntime: FC<Props> = (props) => {
  useScreenshotToolController(props)
  return null
}

const screenshotTool = defineTool({
  key: 'screenshot',
  label: SCREENSHOT_TOOLBAR_MANIFEST.label,
  visibleInScopes: SCREENSHOT_TOOLBAR_MANIFEST.visibleInScopes,

  dependencies: {
    state: ['couldAddImageFile', 'extensions'] as const,
    actions: ['setFiles'] as const
  },

  composer: {
    runtime: ({ context }) => (
      <ScreenshotComposerRuntime
        launcher={context.launcher}
        couldAddImageFile={context.state.couldAddImageFile}
        extensions={context.state.extensions}
        setFiles={context.actions.setFiles}
      />
    )
  }
})

export default screenshotTool
