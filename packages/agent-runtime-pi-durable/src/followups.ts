import type { Context } from '@earendil-works/chord/context'
import {
  InboxDoc,
  type ConversationId,
  type Harness,
  type InboxItem,
  type InboxState,
  type JsonObject
} from '@earendil-works/pi-durable'

import { productInputId } from './inputLookup'

export interface DurableFollowup {
  inputId: string
  submissionId: InboxItem['id']
  revision: number
  textPart?: string
}

export type DurableFollowupChange =
  | { type: 'edit'; inputId: string; revision: number; content: string; textPart: string }
  | { type: 'reorder'; before: string[]; after: string[] }
  | { type: 'withdraw'; inputId: string }

export function followupEdit(data: unknown): Pick<DurableFollowup, 'revision' | 'textPart'> {
  if (data && typeof data === 'object' && 'queueEdit' in data) {
    const edit = data.queueEdit
    if (
      edit &&
      typeof edit === 'object' &&
      'revision' in edit &&
      'textPart' in edit &&
      typeof edit.revision === 'number' &&
      typeof edit.textPart === 'string'
    ) {
      return { revision: edit.revision, textPart: edit.textPart }
    }
  }
  return { revision: 0 }
}

function followupId(item: InboxItem): string | undefined {
  return item.mode === 'followUp' && item.entry?.kind === 'cherry.user-input'
    ? productInputId(item.entry.data)
    : undefined
}

export function readFollowups(inbox: InboxState | undefined): DurableFollowup[] {
  return (inbox?.items ?? []).flatMap((item) => {
    const inputId = followupId(item)
    return inputId && item.mode === 'followUp'
      ? [{ inputId, submissionId: item.id, ...followupEdit(item.entry?.data) }]
      : []
  })
}

export async function changeFollowups(
  harness: Pick<Harness, 'commit' | 'abortSubmission'>,
  conversationId: ConversationId,
  change: DurableFollowupChange,
  context: Context
): Promise<boolean> {
  if (change.type === 'withdraw') {
    const item = await harness.commit(async (tx) => {
      const inbox = await tx.doc(InboxDoc, conversationId)
      return inbox.items.find((item) => followupId(item) === change.inputId)?.id
    }, context)
    return item !== undefined && (await harness.abortSubmission(item, context, conversationId)) === 'aborted'
  }
  return harness.commit(async (tx) => {
    const inbox = await tx.doc(InboxDoc, conversationId)
    if (change.type === 'edit') {
      const item = inbox.items.find((item) => followupId(item) === change.inputId)
      if (item?.mode !== 'followUp' || !item.entry || followupEdit(item.entry.data).revision !== change.revision)
        return false
      item.content = change.content
      item.entry = {
        ...item.entry,
        data: {
          ...(item.entry.data as JsonObject),
          queueEdit: { revision: change.revision + 1, textPart: change.textPart }
        }
      }
      return true
    }

    const ordered = new Map<string, InboxItem>()
    for (const item of inbox.items) {
      const id = followupId(item)
      if (id) ordered.set(id, item)
    }
    const current = [...ordered.keys()]
    if (change.before.length !== current.length || current.some((id, index) => id !== change.before[index]))
      return false
    if (
      new Set(change.after).size !== current.length ||
      change.after.length !== current.length ||
      change.after.some((id) => !ordered.has(id))
    )
      return false
    const replacement = change.after.map((id) => ordered.get(id)!)
    let index = 0
    inbox.items = inbox.items.map((item) => (followupId(item) ? replacement[index++] : item))
    return true
  }, context)
}
