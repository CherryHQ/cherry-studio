import { FileMetadata } from '@renderer/types'
import { filterSupportedFiles } from '@renderer/utils'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

type Props = {
  /** 支持选择的扩展名 */
  extensions?: string[]
  multipleSelections?: boolean
}

export const useFiles = ({ extensions, multipleSelections = true }: Props) => {
  const { t } = useTranslation()

  const [files, setFiles] = useState<FileMetadata[]>([])
  const [selecting, setSelecting] = useState<boolean>(false)

  const selectProps: Electron.OpenDialogOptions['properties'] = useMemo(
    () => (multipleSelections ? ['openFile', 'multiSelections'] : ['openFile']),
    [multipleSelections]
  )

  const onSelectFile = useCallback(async () => {
    if (selecting) {
      return
    }
    const supportedExtensions = extensions ?? ['*']

    // when the number of extensions is greater than 20, use *.* to avoid selecting window lag
    const useAllFiles = supportedExtensions.length > 20

    setSelecting(true)
    const _files: FileMetadata[] = await window.api.file.select({
      properties: selectProps,
      filters: [
        {
          name: 'Files',
          extensions: useAllFiles ? ['*'] : supportedExtensions.map((i) => i.replace('.', ''))
        }
      ]
    })
    setSelecting(false)

    if (_files) {
      if (!useAllFiles) {
        setFiles([...files, ..._files])
        return
      }
      const supportedFiles = await filterSupportedFiles(_files, supportedExtensions)
      if (supportedFiles.length > 0) {
        setFiles([...files, ...supportedFiles])
      }

      if (supportedFiles.length !== _files.length) {
        window.message.info({
          key: 'file_not_supported',
          content: t('chat.input.file_not_supported_count', {
            count: _files.length - supportedFiles.length
          })
        })
      }
    }
  }, [extensions, files, selectProps, selecting, t])

  return {
    files,
    setFiles,
    onSelectFile
  }
}
