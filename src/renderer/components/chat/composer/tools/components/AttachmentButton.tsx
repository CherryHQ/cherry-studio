import type { ToolLauncherApi } from '@renderer/components/chat/composer/tools/types'
import type { FileMetadata } from '@renderer/types'
import { filterSupportedFiles } from '@renderer/utils/file'
import { withComposerFileTokenSourceIds } from '@renderer/utils/messageUtils/composerFileTokenSource'
import { Paperclip } from 'lucide-react'
import type { Dispatch, FC, SetStateAction } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  launcher: ToolLauncherApi
  couldAddImageFile: boolean
  extensions: string[]
  files: FileMetadata[]
  setFiles: Dispatch<SetStateAction<FileMetadata[]>>
  disabled?: boolean
}

const useAttachmentToolController = ({ launcher, couldAddImageFile, extensions, files, setFiles, disabled }: Props) => {
  const { t } = useTranslation()
  const [selecting, setSelecting] = useState<boolean>(false)

  const openFileSelectDialog = useCallback(async () => {
    if (selecting) {
      return
    }
    // when the number of extensions is greater than 20, use *.* to avoid selecting window lag
    const useAllFiles = extensions.length > 20

    setSelecting(true)
    const _files = await window.api.file.select({
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Files',
          extensions: useAllFiles ? ['*'] : extensions.map((i) => i.replace('.', ''))
        }
      ]
    })
    setSelecting(false)

    if (_files) {
      if (!useAllFiles) {
        setFiles([...files, ...withComposerFileTokenSourceIds(_files)])
        return
      }
      const supportedFiles = await filterSupportedFiles(_files, extensions)
      if (supportedFiles.length > 0) {
        setFiles([...files, ...withComposerFileTokenSourceIds(supportedFiles)])
      }

      if (supportedFiles.length !== _files.length) {
        window.toast.info(
          t('chat.input.file_not_supported_count', {
            count: _files.length - supportedFiles.length
          })
        )
      }
    }
  }, [extensions, files, selecting, setFiles, t])

  useEffect(() => {
    const isDocumentOnly = !couldAddImageFile
    const disposeLauncher = launcher.registerLaunchers([
      {
        id: 'attachment',
        kind: 'dialog',
        sources: ['popover'],
        order: 10,
        label: t('chat.input.upload.attachment'),
        description: '',
        tooltip: isDocumentOnly ? t('chat.input.upload.image_not_supported') : undefined,
        icon: <Paperclip />,
        suffix: isDocumentOnly ? t('chat.input.upload.document_only') : undefined,
        disabled,
        action: () => {
          void openFileSelectDialog()
        }
      }
    ])

    return () => {
      disposeLauncher()
    }
  }, [couldAddImageFile, disabled, launcher, openFileSelectDialog, t])
}

export const AttachmentToolRuntime: FC<Props> = (props) => {
  useAttachmentToolController(props)
  return null
}
