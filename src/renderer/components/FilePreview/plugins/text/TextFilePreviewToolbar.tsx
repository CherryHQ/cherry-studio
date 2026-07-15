import WrapText from 'lucide-react/dist/esm/icons/wrap-text'
import { useTranslation } from 'react-i18next'

import { FilePreviewToolbar } from '../../FilePreviewToolbar'
import { FilePreviewToolbarButton } from '../../FilePreviewToolbarButton'

interface TextFilePreviewToolbarProps {
  disabled: boolean
  onWrappedChange: (wrapped: boolean) => void
  wrapped: boolean
}

export function TextFilePreviewToolbar({ disabled, onWrappedChange, wrapped }: TextFilePreviewToolbarProps) {
  const { t } = useTranslation()

  return (
    <FilePreviewToolbar aria-label={t('preview.label')}>
      <FilePreviewToolbarButton
        label={t(wrapped ? 'code_block.wrap.off' : 'code_block.wrap.on')}
        disabled={disabled}
        onClick={() => onWrappedChange(!wrapped)}
        pressed={wrapped}>
        <WrapText aria-hidden />
      </FilePreviewToolbarButton>
    </FilePreviewToolbar>
  )
}
