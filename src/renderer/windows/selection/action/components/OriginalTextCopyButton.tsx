import { Tooltip } from '@cherrystudio/ui'
import { useTemporaryValue } from '@renderer/hooks/useTemporaryValue'
import { toast } from '@renderer/services/toast'
import { Check, Copy } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  textToCopy: string
  tooltip: string
}

const OriginalTextCopyButton: FC<Props> = ({ textToCopy, tooltip }) => {
  const { t } = useTranslation()
  const [copied, setCopied] = useTemporaryValue(false)

  const handleCopy = () => {
    navigator.clipboard
      .writeText(textToCopy)
      .then(() => setCopied(true))
      .catch(() => toast.error(t('message.copy.failed')))
  }

  return (
    <Tooltip content={tooltip}>
      <button
        type="button"
        className="flex cursor-pointer items-center text-icon transition-colors hover:text-foreground"
        aria-label={tooltip}
        onClick={handleCopy}>
        {copied ? <Check className="size-3 text-success" /> : <Copy className="size-3" />}
      </button>
    </Tooltip>
  )
}

export default OriginalTextCopyButton
