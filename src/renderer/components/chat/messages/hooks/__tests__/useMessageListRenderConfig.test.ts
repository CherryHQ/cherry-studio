import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, expect, it } from 'vitest'

import { useMessageListRenderConfig } from '../useMessageListRenderConfig'

beforeEach(() => MockUsePreferenceUtils.resetMocks())

it('shares saved fold display changes with other and remounted message lists', () => {
  MockUsePreferenceUtils.setPreferenceValue('chat.message.multi_model.fold_display_mode', 'compact')
  const first = renderHook(() => useMessageListRenderConfig())
  const second = renderHook(() => useMessageListRenderConfig())
  expect(first.result.current.renderConfig.multiModelFoldDisplayMode).toBe('compact')

  act(() => first.result.current.updateRenderConfig({ multiModelFoldDisplayMode: 'expanded' }))
  second.rerender()
  expect(second.result.current.renderConfig.multiModelFoldDisplayMode).toBe('expanded')
  expect(MockUsePreferenceUtils.getPreferenceValue('chat.message.multi_model.fold_display_mode')).toBe('expanded')

  first.unmount()
  const remounted = renderHook(() => useMessageListRenderConfig())
  expect(remounted.result.current.renderConfig.multiModelFoldDisplayMode).toBe('expanded')
})

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
