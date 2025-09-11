import { ActionTool, TOOL_SPECS, useToolManager } from '@renderer/components/ActionTools'
import { FilePngIcon, FileSvgIcon } from '@renderer/components/Icons'
import { BasicPreviewHandles } from '@renderer/components/Preview'
import { Download, FileCode } from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

interface UseDownloadToolProps {
  showPreviewTools?: boolean
  previewRef: React.RefObject<BasicPreviewHandles | null>
  onDownloadSource: () => void
  setTools: React.Dispatch<React.SetStateAction<ActionTool[]>>
}

export const useDownloadTool = ({ showPreviewTools, previewRef, onDownloadSource, setTools }: UseDownloadToolProps) => {
  const { t } = useTranslation()
  const { registerTool, removeTool } = useToolManager(setTools)

  useEffect(() => {
    const includePreviewTools = showPreviewTools && previewRef.current !== null

    const baseTool = {
      ...TOOL_SPECS.download,
      icon: <Download className="tool-icon" />,
      tooltip: includePreviewTools ? undefined : t('code_block.download.source')
    }

    if (includePreviewTools) {
      registerTool({
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
      })
    } else {
      registerTool({
        ...baseTool,
        onClick: onDownloadSource
      })
    }

    return () => removeTool(TOOL_SPECS.download.id)
  }, [onDownloadSource, registerTool, removeTool, t, showPreviewTools, previewRef])
}
