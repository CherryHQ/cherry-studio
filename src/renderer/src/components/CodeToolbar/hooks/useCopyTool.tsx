import { ActionTool, TOOL_SPECS, useToolManager } from '@renderer/components/ActionTools'
import { CopyIcon } from '@renderer/components/Icons'
import { BasicPreviewHandles } from '@renderer/components/Preview'
import { useTemporaryValue } from '@renderer/hooks/useTemporaryValue'
import { Check, Image } from 'lucide-react'
import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

interface UseCopyToolProps {
  showPreviewTools?: boolean
  previewRef: React.RefObject<BasicPreviewHandles | null>
  onCopySource: () => void
  setTools: React.Dispatch<React.SetStateAction<ActionTool[]>>
}

export const useCopyTool = ({ showPreviewTools, previewRef, onCopySource, setTools }: UseCopyToolProps) => {
  const [copied, setCopiedTemporarily] = useTemporaryValue(false)
  const [copiedImage, setCopiedImageTemporarily] = useTemporaryValue(false)
  const { t } = useTranslation()
  const { registerTool, removeTool } = useToolManager(setTools)

  const handleCopySource = useCallback(() => {
    try {
      onCopySource()
      setCopiedTemporarily(true)
    } catch (error) {
      setCopiedTemporarily(false)
      throw error
    }
  }, [onCopySource, setCopiedTemporarily])

  const handleCopyImage = useCallback(() => {
    try {
      previewRef.current?.copy()
      setCopiedImageTemporarily(true)
    } catch (error) {
      setCopiedImageTemporarily(false)
      throw error
    }
  }, [previewRef, setCopiedImageTemporarily])

  useEffect(() => {
    const includePreviewTools = showPreviewTools && previewRef.current !== null

    const baseTool = {
      ...TOOL_SPECS.copy,
      icon: copied ? (
        <Check className="tool-icon" color="var(--color-status-success)" />
      ) : (
        <CopyIcon className="tool-icon" />
      ),
      tooltip: t('code_block.copy.source'),
      onClick: handleCopySource
    }

    const copyImageTool = {
      ...TOOL_SPECS['copy-image'],
      icon: copiedImage ? (
        <Check className="tool-icon" color="var(--color-status-success)" />
      ) : (
        <Image className="tool-icon" />
      ),
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
  }, [
    onCopySource,
    registerTool,
    removeTool,
    t,
    copied,
    copiedImage,
    handleCopySource,
    handleCopyImage,
    showPreviewTools,
    previewRef
  ])
}
