import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { useMessageParts, useMessagePartsScopeId } from '@renderer/components/chat/messages/blocks/MessagePartsContext'
import { useSideChats } from '@renderer/hooks/useSideChats'
import { locateSideChatSource } from '@renderer/utils/sideChatAnchor'

import { useSideChatContext } from './SideChatContext'

export function SideChatSourceText({ text }: { text: string }) {
  const context = useSideChatContext()
  const messageId = useMessagePartsScopeId()
  const parts = useMessageParts(messageId ?? '')
  const views = useSideChats(context?.sourceTopicId)
  const { t } = useTranslation()
  const current = parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
  const view =
    context &&
    views.find(
      (candidate) =>
        candidate.metadata.snapshot.messageId === messageId &&
        locateSideChatSource(current, candidate.metadata.snapshot) !== null &&
        text.includes(candidate.metadata.snapshot.selection)
    )
  if (!view) return text
  const quote = view.metadata.snapshot.selection
  const start = text.indexOf(quote)
  return (
    <>
      {text.slice(0, start)}
      <Button
        variant="link"
        className="inline h-auto whitespace-pre-wrap p-0 text-inherit underline decoration-dotted"
        title={t('side_chat.questions', { count: view.questionCount })}
        onClick={() => context.open(view.topicId)}>
        {quote}
      </Button>
      {text.slice(start + quote.length)}
    </>
  )
}
