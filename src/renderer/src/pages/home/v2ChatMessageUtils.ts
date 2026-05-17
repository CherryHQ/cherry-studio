import type { Message, MessageBlock } from '@renderer/types/newMessage'
import type { CherryUIMessage } from '@shared/data/types/message'
import type { CherryMessagePart } from '@shared/data/types/message'

export function findPrecedingUserMessage(
  messages: CherryUIMessage[],
  assistantMessageId: string
): CherryUIMessage | undefined {
  const assistantIndex = messages.findIndex((message) => message.id === assistantMessageId)

  if (assistantIndex <= 0) {
    return undefined
  }

  const candidate = messages[assistantIndex - 1]
  return candidate.role === 'user' ? candidate : undefined
}

export function mergeHistoryAndLiveMessages(historyMessages: Message[], liveMessages: Message[]): Message[] {
  if (liveMessages.length === 0) {
    return historyMessages
  }

  return [...historyMessages, ...liveMessages]
}

export function mergeHistoryAndLiveBlockMaps(
  historyBlockMap: Record<string, MessageBlock>,
  liveBlockMap: Record<string, MessageBlock>
): Record<string, MessageBlock> {
  if (Object.keys(liveBlockMap).length === 0) {
    return historyBlockMap
  }

  return { ...historyBlockMap, ...liveBlockMap }
}

export function buildPartsMap(
  historyPartsMap: Record<string, CherryMessagePart[]>,
  liveMessages: CherryUIMessage[]
): Record<string, CherryMessagePart[]> {
  if (liveMessages.length === 0) {
    return historyPartsMap
  }

  const partsMap: Record<string, CherryMessagePart[]> = { ...historyPartsMap }

  for (const message of liveMessages) {
    partsMap[message.id] = message.parts as CherryMessagePart[]
  }

  return partsMap
}

export function findRootMessage(messages: Message[]): Message | undefined {
  return messages.find((message) => !message.askId)
}
