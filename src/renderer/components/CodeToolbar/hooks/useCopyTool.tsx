import type { ActionTool } from '@renderer/components/ActionTools'
import { TOOL_SPECS } from '@renderer/components/ActionTools'
import { CopyIcon } from '@renderer/components/Icons'
import type { BasicPreviewHandles } from '@renderer/components/Preview'
import { useTemporaryValue } from '@renderer/hooks/useTemporaryValue'
import { Check, Image } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

interface UseCopyToolProps {
  showPreviewTools?: boolean
  previewRef: React.RefObject<BasicPreviewHandles | null>
  onCopySource: () => void
}

export const useCopyTool = ({ showPreviewTools, previewRef, onCopySource }: UseCopyToolProps) => {
  const [copied, setCopiedTemporarily] = useTemporaryValue(false)
  const [copiedImage, setCopiedImageTemporarily] = useTemporaryValue(false)
  const { t } = useTranslation()

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
      void previewRef.current?.copy()
      setCopiedImageTemporarily(true)
    } catch (error) {
      setCopiedImageTemporarily(false)
      throw error
    }
  }, [previewRef, setCopiedImageTemporarily])

  return useMemo<ActionTool[]>(() => {
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

    return showPreviewTools ? [baseTool, copyImageTool] : [baseTool]
  }, [copied, copiedImage, handleCopySource, handleCopyImage, showPreviewTools, t])
}
