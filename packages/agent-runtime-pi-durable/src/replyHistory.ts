import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { UserEntry, type Cursor, type EntryId, type Storage } from '@earendil-works/pi-durable'

import type { InputId, NativeInputId, Thread, ThreadId } from '@cherrystudio/agent-runtime'

import { conversationId } from './behavior/history'
import { ContentProjection } from './content'
import { lookupSubmission, productInputId, submissionState } from './inputLookup'
import { nonterminalTaskStates } from './recovery'

/** Reads the committed response to one product Run without opening a Harness. */
export async function readDurableReply(
  storage: Storage,
  thread: Thread,
  inputs: readonly { inputId: InputId; nativeInputId?: NativeInputId }[]
) {
  const ctx = BACKGROUND_CONTEXT
  const records = []
  for (const input of inputs) {
    const result = await lookupSubmission(storage, thread, input.inputId, input.nativeInputId)
    const record = result?.record
    if (!record || (record.status !== 'done' && record.status !== 'unanswered')) return
    records.push(record)
  }
  const primary = records.find((record) => record.status === 'done') ?? records[0]
  if (!primary || records.some((record) => record.runId !== primary.runId || record.answer !== primary.answer)) return
  const id = conversationId(thread.id)
  const answer = primary.answer && (await storage.entry(id, primary.answer, ctx))?.entry
  if (primary.answer && (!answer || answer.conversationId !== id)) return
  const outcome = submissionState(thread, primary, answer || undefined)
  if (!outcome.outcome) return
  const anchors = new Set(records.flatMap((record) => (record.entry === undefined ? [] : [record.entry])))
  if (primary.status === 'done' && (!anchors.size || !answer)) return
  const content = ContentProjection.empty()
  if (anchors.size) {
    const minEntryId = Math.min(...anchors) as EntryId
    let cursor: Cursor | undefined
    let nextInput = false
    do {
      const page = await storage.scanEntries(
        { conversationId: id, minEntryId, maxEntryId: primary.answer, order: 'ascending' },
        128,
        cursor,
        ctx
      )
      for (const entry of page.items) {
        if (entry.conversationId !== id) continue
        const entryRun =
          entry.data && typeof entry.data === 'object' && 'runId' in entry.data ? entry.data.runId : undefined
        if (
          ((entry.kind === 'cherry.user-input' || UserEntry.is(entry)) && !anchors.has(entry.id)) ||
          (entryRun !== undefined && primary.runId !== undefined && entryRun !== primary.runId)
        ) {
          if (primary.answer !== undefined) return
          nextInput = true
          break
        }
        content.entry(entry)
      }
      cursor = page.next
    } while (cursor && !nextInput)
  }
  return { outcome, messages: content.seal().filter((message) => message.role === 'assistant') }
}

/** A pre-submit crash is recoverable only when every input can be ruled out on its idle root. */
export async function areDurableInputsAbsent(storage: Storage, threadId: ThreadId, inputs: ReadonlySet<string>) {
  const ctx = BACKGROUND_CONTEXT
  const id = conversationId(threadId)
  const thread = await storage.conversation(id, ctx)
  if (!thread || thread.owner || !inputs.size) return false
  for (const status of nonterminalTaskStates)
    if ((await storage.scanTasks({ conversationId: id, status }, 1, undefined, ctx)).items.length) return false
  let cursor: Cursor | undefined
  do {
    const page = await storage.scanSubmissions({ conversationId: id }, 128, cursor, ctx)
    for (const record of page.items) {
      if (record.status === 'queued' || record.status === 'placed') return false
      if (record.requestId) {
        if (inputs.has(record.requestId)) return false
        continue
      }
      if (record.type !== 'input') continue
      // Before native request keys, only a placed entry could identify its product input.
      const entry = record.entry && (await storage.entry(id, record.entry, ctx))?.entry
      const inputId = entry && entry.conversationId === id && productInputId(entry.data)
      if (!inputId || inputs.has(inputId)) return false
    }
    cursor = page.next
  } while (cursor)
  return true
}
