import { describe, expect, it } from 'vitest'

import { AssistantMigrator } from '../AssistantMigrator'
import { ChatMigrator } from '../ChatMigrator'
import { getAllMigrators } from '../index'
import { PromptMigrator } from '../PromptMigrator'
import { TranslateMigrator } from '../TranslateMigrator'

describe('migrator reset contract', () => {
  it('requires every registered migrator to define reset explicitly', () => {
    const missingResetOverrides = getAllMigrators()
      .filter((migrator) => !Object.prototype.hasOwnProperty.call(Object.getPrototypeOf(migrator), 'reset'))
      .map((migrator) => migrator.constructor.name)

    expect(missingResetOverrides).toStrictEqual([])
  })

  it('clears all attempt-local state in ChatMigrator', () => {
    const migrator = new ChatMigrator()
    const state = migrator as any

    state.topicCount = 3
    state.messageCount = 7
    state.blockLookup = new Map([['block-1', { id: 'block-1' }]])
    state.assistantLookup = new Map([['assistant-1', { id: 'assistant-1' }]])
    state.topicMetaLookup = new Map([['topic-1', { id: 'topic-1' }]])
    state.topicAssistantLookup = new Map([['topic-1', 'assistant-1']])
    state.skippedTopics = 2
    state.skippedMessages = 5
    // seenMessageIds is now a local variable inside insertStagedTopics(), not a class field.
    state.blockStats = {
      requested: 9,
      resolved: 8,
      messagesWithMissingBlocks: 1,
      messagesWithEmptyBlocks: 2
    }
    state.promotedToRootCount = 3
    state.validAssistantIds = new Set(['ast-1'])
    state.validModelIds = new Set(['provider::model'])
    state.orphanedAssistantTopics = 4
    state.stagedTopics = [{ topic: { id: 't' }, messages: [], pinned: false }]

    migrator.reset()

    expect(state.topicCount).toBe(0)
    expect(state.messageCount).toBe(0)
    expect(state.blockLookup.size).toBe(0)
    expect(state.assistantLookup.size).toBe(0)
    expect(state.topicMetaLookup.size).toBe(0)
    expect(state.topicAssistantLookup.size).toBe(0)
    expect(state.skippedTopics).toBe(0)
    expect(state.skippedMessages).toBe(0)
    expect(state.blockStats).toStrictEqual({
      requested: 0,
      resolved: 0,
      messagesWithMissingBlocks: 0,
      messagesWithEmptyBlocks: 0
    })
    expect(state.promotedToRootCount).toBe(0)
    expect(state.validAssistantIds).toBeNull()
    expect(state.validModelIds).toBeNull()
    expect(state.orphanedAssistantTopics).toBe(0)
    expect(state.stagedTopics).toStrictEqual([])
  })

  it('clears all attempt-local state in AssistantMigrator', () => {
    const migrator = new AssistantMigrator()
    const state = migrator as any

    state.preparedResults = [{ id: 'ast-1' }]
    state.skippedCount = 3
    state.validAssistantIds = new Set(['ast-1', 'ast-2'])

    migrator.reset()

    expect(state.preparedResults).toStrictEqual([])
    expect(state.skippedCount).toBe(0)
    expect(state.validAssistantIds.size).toBe(0)
  })

  it('clears cached source data and counters in PromptMigrator', () => {
    const migrator = new PromptMigrator()
    const state = migrator as any

    state.promptCount = 5
    state.skippedCount = 2
    state.preparedPhrases = [{ id: 'phrase-1' }]

    migrator.reset()

    expect(state.promptCount).toBe(0)
    expect(state.skippedCount).toBe(0)
    expect(state.preparedPhrases).toStrictEqual([])
  })

  it('clears cached source data and counters in TranslateMigrator', () => {
    const migrator = new TranslateMigrator()
    const state = migrator as any

    state.historySourceCount = 4
    state.historySkippedCount = 1
    state.cachedHistoryRecords = [{ id: 'history-1' }]
    state.languageSourceCount = 2
    state.languageSkippedCount = 3
    state.cachedLanguageRecords = [{ id: 'language-1' }]

    migrator.reset()

    expect(state.historySourceCount).toBe(0)
    expect(state.historySkippedCount).toBe(0)
    expect(state.cachedHistoryRecords).toStrictEqual([])
    expect(state.languageSourceCount).toBe(0)
    expect(state.languageSkippedCount).toBe(0)
    expect(state.cachedLanguageRecords).toStrictEqual([])
  })
})
