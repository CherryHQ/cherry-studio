import { Check, Image } from 'lucide-react'
import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import type { ActionTool } from '@renderer/components/ActionTools'
import { TOOL_SPECS, useToolManager } from '@renderer/components/ActionTools'
import CopyIcon from '@renderer/components/icons/CopyIcon'
import type { BasicPreviewHandles } from '@renderer/components/Preview/types'
import { useTemporaryValue } from '@renderer/hooks/useTemporaryValue'

interface UseCopyToolProps {
  showPreviewTools?: boolean
  previewRef: React.RefObject<BasicPreviewHandles | null>
  onCopySource: () => Promise<boolean>
  setTools: React.Dispatch<React.SetStateAction<ActionTool[]>>
}

export const useCopyTool = ({ showPreviewTools, previewRef, onCopySource, setTools }: UseCopyToolProps) => {
  const [copied, setCopiedTemporarily] = useTemporaryValue(false)
  const [copiedImage, setCopiedImageTemporarily] = useTemporaryValue(false)
  const { t } = useTranslation()
  const { registerTool, removeTool } = useToolManager(setTools)

  const handleCopySource = useCallback(async () => {
    setCopiedTemporarily(await onCopySource())
  }, [onCopySource, setCopiedTemporarily])

  const handleCopyImage = useCallback(async () => {
    const preview = previewRef.current
    if (!preview) return

    setCopiedImageTemporarily(await preview.copy())
  }, [previewRef, setCopiedImageTemporarily])

  useEffect(() => {
    const includePreviewTools = showPreviewTools === true

    const baseTool = {
      ...TOOL_SPECS.copy,
      icon: copied ? <Check className="tool-icon" color="var(--success)" /> : <CopyIcon className="tool-icon" />,
      tooltip: t('code_block.copy.source'),
      onClick: handleCopySource
    }

    const copyImageTool = {
      ...TOOL_SPECS['copy-image'],
      icon: copiedImage ? <Check className="tool-icon" color="var(--success)" /> : <Image className="tool-icon" />,
      tooltip: t('preview.copy.image'),
      onClick: handleCopyImage
    }

    registerTool(baseTool)

    if (includePreviewTools) {
      registerTool(copyImageTool)
    }

    return () => {
      removeTool(TOOL_SPECS.copy.id)
      removeTool(TOOL_SPECS['copy-image'].id)
    }
  }, [registerTool, removeTool, t, copied, copiedImage, handleCopySource, handleCopyImage, showPreviewTools])
}
