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
