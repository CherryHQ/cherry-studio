import { type MemoryRevision } from './entries'
import { extractContextCandidates, type MemoryModel, type ConversationWindow } from './extraction'
import { MEMORY_ENTRY, utf8Length } from './files'
import type { MemoryAccess, MemoryStore, MemoryRead, MemoryMutation, MemoryApproval } from './store'
import { anchorMemoryTime } from './time'

export async function prepareExtraction(
  store: MemoryStore,
  access: MemoryAccess,
  source: ConversationWindow & { kind: 'chat' | 'agent'; conversationId: string },
  model: MemoryModel,
  signal: AbortSignal,
  validate: () => Promise<void>,
  applied: readonly { path: string; after: string | null }[] = []
) {
  const timeZone = source.timeZone
  const existingPaths = await store.list(access)
  const paths = existingPaths.includes(MEMORY_ENTRY) ? existingPaths : [MEMORY_ENTRY, ...existingPaths]
  if (paths.length > 40) throw new Error('Memory input exceeds the file limit')
  const references = source.messages
    .filter((m) => m.role === 'user')
    .map((m) => ({
      kind: source.kind,
      conversationId: source.conversationId,
      messageId: m.id,
      sourceVersion: m.version
    }))
  const earliest = Math.min(...source.messages.map((m) => m.createdAt))
  const files = await Promise.all(
    paths.map((path) => store.modelRead(access, path, 'extraction', references, true, earliest))
  )
  if (applied.some((f) => files.find((read) => read.path === f.path)?.hash !== f.after))
    throw Error('Previously committed memory changed')
  const entry = files.find((f) => f.path === MEMORY_ENTRY)!
  if (files.some((f) => !f.receipt) || files.reduce((n, f) => n + utf8Length(f.content ?? ''), 0) > 32000)
    throw new Error('Memory input is protected or exceeds the byte limit')
  async function current() {
    signal.throwIfAborted()
    await validate()
    for (const file of files) await file.validate()
  }
  const proposal = await extractContextCandidates(source, files, signal, current, model)
  proposal.candidates = proposal.candidates.map((candidate) => ({
    ...candidate,
    text: anchorMemoryTime(candidate, source.messages, timeZone)
  }))
  return { proposal, files, entry, existingPaths, current }
}

export async function extractAndSave(
  store: MemoryStore,
  access: MemoryAccess,
  source: ConversationWindow & { kind: 'chat' | 'agent'; conversationId: string },
  model: MemoryModel,
  signal: AbortSignal,
  validate: () => Promise<void>,
  approve: MemoryApproval,
  applied: readonly { path: string; after: string | null }[] = []
) {
  const { proposal, files, entry, existingPaths, current } = await prepareExtraction(
    store,
    access,
    source,
    model,
    signal,
    validate,
    applied
  )
  const additions = [
    ...new Set(
      proposal.candidates
        .filter((candidate) => candidate.action === 'add' && candidate.scope === 'personal')
        .map((candidate) => candidate.text)
    )
  ].filter(
    (text) => !files.some((file) => file.content?.includes(text) || file.content?.includes(JSON.stringify(text)))
  )
  const original = entry.content ?? ''
  const content = additions.length
    ? `${original}${original.endsWith('\n') || !original ? '' : '\n'}${additions.map((text) => `- ${JSON.stringify(text)}`).join('\n')}\n`
    : original
  const corrections = proposal.candidates.filter(
    (candidate) => candidate.action === 'correct' && candidate.scope === 'personal'
  )
  const planned: Array<{ file: MemoryRead; mutation: MemoryMutation & { content: string } }> = []
  for (const file of files) {
    const revisions = new Map<string, MemoryRevision>()
    for (const candidate of corrections) {
      for (const reference of candidate.existing.filter((reference) => reference.path === file.path)) {
        const previous = revisions.get(reference.quote)
        if (previous && previous.text !== candidate.text) throw new Error('Invalid correction')
        revisions.set(reference.quote, {
          quote: reference.quote,
          text: candidate.text,
          reason: candidate.correction!,
          recordedAt: new Date(
            Math.max(
              ...candidate.evidence.map(
                (evidence) => source.messages.find((message) => message.id === evidence.messageId)!.createdAt
              )
            )
          ).toISOString(),
          sources: candidate.evidence.map((evidence) => ({
            kind: source.kind,
            conversationId: source.conversationId,
            messageId: evidence.messageId,
            sourceVersion: evidence.version
          }))
        })
      }
    }
    if (revisions.size)
      planned.push({
        file,
        mutation: await store.prepareRevisions(
          access,
          file.receipt,
          [...revisions.values()],
          file.path === MEMORY_ENTRY ? additions : []
        )
      })
    else if (file.path === MEMORY_ENTRY && content !== original)
      planned.push({ file, mutation: { kind: 'write', receipt: file.receipt, content } })
  }

  await current()
  if (!planned.length) return { proposal, result: undefined }
  const result = await store.commit(
    access,
    planned.map((item) => item.mutation),
    'extraction',
    async (changes) => {
      await current()
      const approved = await approve(changes)
      await current()
      return () => {
        signal.throwIfAborted()
        return approved()
      }
    },
    { readReceipts: files.map((file) => file.receipt), clearTargets: existingPaths }
  )
  return { proposal, result }
}
