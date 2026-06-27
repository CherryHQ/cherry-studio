import type { ActionTool } from '@renderer/components/ActionTools'
import { TOOL_SPECS } from '@renderer/components/ActionTools'
import { FilePngIcon, FileSvgIcon } from '@renderer/components/Icons'
import type { BasicPreviewHandles } from '@renderer/components/Preview'
import { Download, FileCode } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

interface UseDownloadToolProps {
  showPreviewTools?: boolean
  previewRef: React.RefObject<BasicPreviewHandles | null>
  onDownloadSource: () => void
}

export const useDownloadTool = ({ showPreviewTools, previewRef, onDownloadSource }: UseDownloadToolProps) => {
  const { t } = useTranslation()

  return useMemo<ActionTool>(() => {
    const baseTool = {
      ...TOOL_SPECS.download,
      icon: <Download className="tool-icon" />,
      tooltip: showPreviewTools ? undefined : t('code_block.download.source')
    }

    if (showPreviewTools) {
      return {
        ...baseTool,
        children: [
          {
            ...TOOL_SPECS.download,
            icon: <FileCode size={'1rem'} />,
            tooltip: t('code_block.download.source'),
            onClick: onDownloadSource
          },
          {
            ...TOOL_SPECS['download-svg'],
            icon: <FileSvgIcon size={'1rem'} className="lucide" />,
            tooltip: t('code_block.download.svg'),
            onClick: () => previewRef.current?.download('svg')
          },
          {
            ...TOOL_SPECS['download-png'],
            icon: <FilePngIcon size={'1rem'} className="lucide" />,
            tooltip: t('code_block.download.png'),
            onClick: () => previewRef.current?.download('png')
          }
        ]
      }
    }

    return {
      ...baseTool,
      onClick: onDownloadSource
    }
  }, [onDownloadSource, previewRef, showPreviewTools, t])
}
