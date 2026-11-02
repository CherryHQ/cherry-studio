import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { renderHook } from '@testing-library/react'
import { beforeEach, expect, it } from 'vitest'

import { useMessageListRenderConfig } from '../useMessageListRenderConfig'

beforeEach(() => MockUsePreferenceUtils.resetMocks())

it('updates message rendering when the saved default expansion preference changes', () => {
  MockUsePreferenceUtils.setPreferenceValue('chat.message.user_content.default_expanded', false)
  const { result, rerender } = renderHook(() => useMessageListRenderConfig())
  expect(result.current.renderConfig.userMessageDefaultExpanded).toBe(false)

  MockUsePreferenceUtils.setPreferenceValue('chat.message.user_content.default_expanded', true)
  rerender()
  expect(result.current.renderConfig.userMessageDefaultExpanded).toBe(true)

  MockUsePreferenceUtils.setPreferenceValue('chat.message.user_content.default_expanded', false)
  rerender()
  expect(result.current.renderConfig.userMessageDefaultExpanded).toBe(false)
})

it('derives the process render booleans from the tool-call density preference', () => {
  const { result, rerender } = renderHook(() => useMessageListRenderConfig())

  // compact is the default and preserves the shipped look: one collapsible
  // process group per message.
  expect(result.current.renderConfig.toolDensity).toBe('compact')
  expect(result.current.renderConfig.thoughtAutoCollapse).toBe(true)
  expect(result.current.renderConfig.collapseCompletedToolHistory).toBe(true)

  MockUsePreferenceUtils.setPreferenceValue('chat.message.density', 'balanced')
  rerender()
  expect(result.current.renderConfig.toolDensity).toBe('balanced')
  expect(result.current.renderConfig.thoughtAutoCollapse).toBe(true)
  expect(result.current.renderConfig.collapseCompletedToolHistory).toBe(false)

  MockUsePreferenceUtils.setPreferenceValue('chat.message.density', 'detailed')
  rerender()
  expect(result.current.renderConfig.toolDensity).toBe('detailed')
  expect(result.current.renderConfig.thoughtAutoCollapse).toBe(false)
  expect(result.current.renderConfig.collapseCompletedToolHistory).toBe(false)
})
