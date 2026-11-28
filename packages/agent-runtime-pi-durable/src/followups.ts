import type { Context } from '@earendil-works/chord/context'
import {
  LiveDoc,
  type Conversation,
  type InboxItem,
  type InboxState,
  type JsonObject,
  type TaskId
} from '@earendil-works/pi-durable'

import { productInputId } from './inputLookup'
import { registerFollowupProjection } from './recovery'

export interface DurableFollowup {
  inputId: string
  submissionId: InboxItem['id']
  revision: number
  parts?: string
  textPart?: string
  steering?: true
  editing?: true
}

type EditHold = { token: string; owner: string }

export type DurableFollowupChange =
  | { type: 'begin-edit'; inputId: string; revision: number; hold: EditHold; isOwnerLive: (owner: string) => boolean }
  | { type: 'cancel-edit'; inputId: string; hold: EditHold }
  | { type: 'edit'; inputId: string; revision: number; hold: EditHold; content: string; parts: string }
  | { type: 'reorder'; before: string[]; after: string[] }
  | { type: 'withdraw'; inputId: string }
  | { type: 'steer'; inputId: string; activeInputId: string; replyId: string }

export function followupSteerPlacement(data: unknown, runId?: TaskId): { replyId?: string } | undefined {
  if (!data || typeof data !== 'object' || !('steer' in data)) return
  const steer = data.steer
  if (
    !steer ||
    typeof steer !== 'object' ||
    !('runId' in steer) ||
    typeof steer.runId !== 'number' ||
    !('replyId' in steer) ||
    typeof steer.replyId !== 'string'
  )
    return
  return steer.runId === runId ? { replyId: steer.replyId } : {}
}

export type DurableFollowupEdit = Pick<DurableFollowup, 'revision' | 'parts' | 'textPart'>

export function followupEdit(data: unknown): DurableFollowupEdit {
  if (data && typeof data === 'object' && 'queueEdit' in data) {
    const edit = data.queueEdit
    if (edit && typeof edit === 'object' && 'revision' in edit && typeof edit.revision === 'number') {
      if ('parts' in edit && typeof edit.parts === 'string') return { revision: edit.revision, parts: edit.parts }
      if ('textPart' in edit && typeof edit.textPart === 'string')
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
    if (item.mode === 'write' || item.entry?.kind !== 'cherry.user-input') return []
    const inputId = productInputId(item.entry.data)
    const steering = item.mode === 'steer' && followupSteerPlacement(item.entry.data) ? true : undefined
    if (!inputId || (item.mode === 'steer' && !steering)) return []
    return [
      {
        inputId,
        submissionId: item.id,
        ...followupEdit(item.entry.data),
        ...(steering && { steering }),
        ...(item.editHold && { editing: true as const })
      }
    ]
  })
}

export async function changeFollowups(
  conversation: Pick<Conversation, 'id' | 'changeFollowUps'>,
  change: DurableFollowupChange,
  context: Context
): Promise<boolean> {
  const conversationId = conversation.id
  return conversation.changeFollowUps(async (tx, inbox) => {
    if (change.type === 'withdraw') {
      const index = inbox.items.findIndex((item) => followupId(item) === change.inputId)
      if (index < 0) return false
      const [item] = inbox.items.splice(index, 1)
      if (inbox.followUpsPaused && !inbox.items.some((item) => item.mode === 'followUp')) delete inbox.followUpsPaused
      tx.settleSubmission(item.id, { status: 'unanswered', reason: 'withdrawn' })
      await registerFollowupProjection(tx, { threadId: String(conversationId), inputId: change.inputId })
      return true
    }
    if (change.type === 'steer') {
      const { run } = await tx.doc(LiveDoc, conversationId)
      const item = inbox.items.find((item) => followupId(item) === change.inputId)
      if (!run || run.afterRun || item?.mode !== 'followUp' || !item.entry || item.editHold) return false
      const runId = run.id ?? run.taskId
      const active = await tx.submissionByRequest(conversationId, change.activeInputId)
      if (active?.type !== 'input' || active.runId !== runId || active.status !== 'placed') return false
      item.mode = 'steer'
      if (inbox.followUpsPaused && !inbox.items.some((item) => item.mode === 'followUp')) delete inbox.followUpsPaused
      item.entry = {
        ...item.entry,
        data: { ...(item.entry.data as JsonObject), steer: { runId, replyId: change.replyId } }
      }
      await registerFollowupProjection(tx, { threadId: String(conversationId), inputId: change.inputId })
      return true
    }
    if (change.type === 'begin-edit' || change.type === 'cancel-edit' || change.type === 'edit') {
      const item = inbox.items.find((item) => followupId(item) === change.inputId)
      if (item?.mode !== 'followUp' || !item.entry) return false
      if (change.type === 'begin-edit') {
        if (followupEdit(item.entry.data).revision !== change.revision || !change.isOwnerLive(change.hold.owner))
          return false
        if (item.editHold && item.editHold.owner !== change.hold.owner && change.isOwnerLive(item.editHold.owner))
          return false
        item.editHold = change.hold
        return true
      }
      if (item.editHold?.token !== change.hold.token || item.editHold.owner !== change.hold.owner) return false
      if (change.type === 'cancel-edit') {
        delete item.editHold
        return true
      }
      if (followupEdit(item.entry.data).revision !== change.revision) return false
      item.content = change.content
      item.entry = {
        ...item.entry,
        data: {
          ...(item.entry.data as JsonObject),
          queueEdit: { revision: change.revision + 1, parts: change.parts }
        }
      }
      delete item.editHold
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
