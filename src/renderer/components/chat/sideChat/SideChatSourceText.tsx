import { useMessageParts, useMessagePartsScopeId } from '@renderer/components/chat/messages/blocks/MessagePartsContext'
import { useSideChats } from '@renderer/hooks/useSideChats'
import { locateSideChatSource } from '@renderer/utils/sideChatAnchor'

import { useSideChatContext } from './SideChatContext'

export function SideChatSourceText({ text }: { text: string }) {
  const context = useSideChatContext()
  const messageId = useMessagePartsScopeId()
  const parts = useMessageParts(messageId ?? '')
  const views = useSideChats(context?.sourceTopicId)
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
      <mark className="bg-transparent text-inherit underline decoration-dotted">{quote}</mark>
      {text.slice(start + quote.length)}
    </>
  )
}
