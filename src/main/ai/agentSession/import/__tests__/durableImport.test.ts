import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context'
import { createModels, fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai'
import { createSession, createRegistry, Harness, type ConversationId } from '@earendil-works/pi-durable'
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node'
import { expect, it } from 'vitest'

import { importDurableHistory } from '../durableImport'

it('retains branch-specific context across native close/reopen and continues without replaying imports', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'deepseek-native-'))
  const file = join(directory, 'history.sqlite')
  const messages = [
    { id: 'u', parentId: null, model: { role: 'user' as const, content: 'Remember mango', timestamp: 1 } },
    { id: 'a', parentId: 'u', model: fauxAssistantMessage('Mango recorded') },
    { id: 'b', parentId: 'u', model: fauxAssistantMessage('Sibling banana') }
  ]
  try {
    const session = createSession(await openNodeSqliteStorage(file))
    const id = randomUUID()
    const nodes = await importDurableHistory(session, id, messages)
    expect(await importDurableHistory(session, id, messages)).toEqual(nodes)
    await session.close(context)
    for (const [branch, expected, excluded] of [
      ['a', 'Mango recorded', 'Sibling banana'],
      ['b', 'Sibling banana', 'Mango recorded']
    ]) {
      const models = createModels()
      const faux = fauxProvider()
      models.setProvider(faux.provider)
      const seen: string[] = []
      faux.setResponses([
        (request) => {
          seen.push(JSON.stringify(request.messages))
          return fauxAssistantMessage('Continued')
        }
      ])
      const native = await Harness.open(
        await openNodeSqliteStorage(file),
        { models, registry: createRegistry(), settings: { compaction: { enabled: false } } },
        context
      )
      try {
        const conversation = (await native.conversation(
          Number(nodes[branch].conversationId) as ConversationId,
          context
        ))!
        const before = JSON.stringify(await conversation.context(context))
        expect(before).toContain('Remember mango')
        expect(before).toContain(expected)
        expect(before).not.toContain(excluded)
        expect(seen).toEqual([])
        await conversation.configure(
          { model: { provider: faux.getModel().provider, modelId: faux.getModel().id } },
          context
        )
        await conversation.submit({ type: 'input', content: 'Continue' }, context)
        await conversation.waitForIdle(context)
        expect(seen).toHaveLength(1)
        expect(seen[0]).toContain('Remember mango')
        expect(seen[0]).toContain(expected)
        expect(seen[0]).not.toContain(excluded)
      } finally {
        await native.close(context)
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
