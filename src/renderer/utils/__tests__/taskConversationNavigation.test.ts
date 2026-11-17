import { afterEach, expect, it } from 'vitest'

import { cacheService } from '@renderer/data/CacheService'
import type { Tab } from '@shared/data/cache/cacheValueTypes'

import { findConversationTab } from '../conversationNavigation'

const target = { conversationType: 'agent' as const, conversationId: 'session' }
const tab = { id: 'tasks-tab', type: 'route', url: '/app/scheduled-tasks?taskId=task' } as Tab
const key = 'scheduled-task.conversation.tasks-tab'
afterEach(() => {
  cacheService.deleteCasual(key)
})

it('does not claim a task conversation from an arbitrary URL sessionId', () => {
  expect(findConversationTab([{ ...tab, url: `${tab.url}&sessionId=session` }], target)).toBeUndefined()
})

it('claims only the validated selection and rejects it immediately after a task or run change', () => {
  cacheService.setCasual(key, { taskId: 'task', sessionId: 'session' })
  expect(findConversationTab([tab], target)).toBe(tab)
  expect(findConversationTab([{ ...tab, url: '/app/scheduled-tasks?taskId=other' }], target)).toBeUndefined()
  expect(findConversationTab([{ ...tab, url: `${tab.url}&runId=other` }], target)).toBeUndefined()
  cacheService.deleteCasual(key)
  expect(findConversationTab([tab], target)).toBeUndefined()
})
