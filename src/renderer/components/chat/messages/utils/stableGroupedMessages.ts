import type { MessageListItem } from '../types'
import { groupMessageListItems } from './messageGroupKey'

type GroupedEntry = [string, MessageListItem[]]
interface MessageGroups {
  entries: GroupedEntry[]
  indexByKey: ReadonlyMap<string, number>
}

/** Keep unchanged groups mounted while live replies or multi-model siblings enter and leave the list. */
export function stableGroupedMessages(messages: MessageListItem[], previous?: MessageGroups): MessageGroups {
  const entries = Object.entries(groupMessageListItems(messages)).map(([key, group]): GroupedEntry => {
    const index = previous?.indexByKey.get(key)
    const entry = index === undefined ? undefined : previous?.entries[index]
    if (entry && group.length === entry[1].length && group.every((row, i) => row === entry[1][i])) return entry
    return [key, group]
  })
  if (
    previous &&
    entries.length === previous.entries.length &&
    entries.every((entry, i) => entry === previous.entries[i])
  ) {
    return previous
  }
  return { entries, indexByKey: new Map(entries.map(([key], index) => [key, index])) }
}
