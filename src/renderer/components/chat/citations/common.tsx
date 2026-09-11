import { Check, Copy } from 'lucide-react'
import React from 'react'
import { useTranslation } from 'react-i18next'

import { useTemporaryValue } from '@renderer/hooks/useTemporaryValue'
import type { Citation } from '@renderer/types/message'

import { useOptionalMessageListActions } from '../messages/MessageListProvider'
import type { MessageListActions } from '../messages/types'

export type CitationCopyActions = Pick<MessageListActions, 'copyText' | 'notifyError'>
export type CitationPanelActions = CitationCopyActions & {
  openPath?: (path: string) => void | Promise<void>
  openExternalUrl?: (url: string) => void | Promise<void>
}

export const truncateText = (text: string, maxLength = 100) =>
  text.length > maxLength ? `${text.slice(0, maxLength)}...` : text

export const getCitationHostname = (citation: Citation) => {
  if (!citation.url) return undefined
  try {
    return new URL(citation.url).hostname
  } catch {
    return undefined
  }
}

export const handleLinkClick = (
  url: string,
  event: React.MouseEvent,
  actions?: {
    openPath?: (path: string) => void | Promise<void>
    openExternalUrl?: (url: string) => void | Promise<void>
  }
) => {
  if (!url) return
  if (url.startsWith('http')) {
    if (!actions?.openExternalUrl) return
    event.preventDefault()
    void actions.openExternalUrl(url)
    return
  }

  if (!actions?.openPath) return
  event.preventDefault()
  void actions.openPath(url)
}

export const CopyButton: React.FC<{ content: string; actions?: CitationCopyActions }> = ({
  content,
  actions: injectedActions
}) => {
  const [copied, setCopied] = useTemporaryValue(false, 2000)
  const { t } = useTranslation()
  const actions = useOptionalMessageListActions()
  const copyText = injectedActions?.copyText ?? actions?.copyText
  const notifyError = injectedActions?.notifyError ?? actions?.notifyError

  const handleCopy = () => {
    if (!content || !copyText) return
    Promise.resolve(copyText(content, { successMessage: t('common.copied') }))
      .then(() => setCopied(true))
      .catch(() => {
        notifyError?.(t('message.copy.failed'))
      })
  }

  if (!copyText) return null

  return (
    <div
      className="absolute top-1/2 right-0 flex -translate-y-1/2 cursor-pointer items-center justify-center rounded p-1 text-muted-foreground opacity-0 transition-opacity duration-300 group-hover:opacity-100 hover:bg-muted hover:opacity-100"
      onClick={handleCopy}>
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </div>
  )
}
