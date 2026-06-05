import { TopicType } from '@renderer/types'
import { describe, expect, it } from 'vitest'

import { getMessageMenubarConfig } from '../messageMenubar'

describe('messageMenubar registry', () => {
  // Regression: agent sessions don't mount the translation-overlay provider,
  // so the Session scope must NOT offer the translate button (rendering it
  // would mount `useTranslateMessage` and crash). See `useTranslateMessage` /
  // `useOptionalTranslationOverlaySetter`.
  it('excludes the translate button from the agent (Session) scope', () => {
    expect(getMessageMenubarConfig(TopicType.Session).buttonIds).not.toContain('translate')
  })

  it('still offers the translate button in the chat scope', () => {
    expect(getMessageMenubarConfig(TopicType.Chat).buttonIds).toContain('translate')
  })

  // Regression: the standalone trace window was removed, so the trace button
  // (its only entry point) must no longer be registered in any scope.
  it('excludes the trace button from the agent (Session) scope', () => {
    expect(getMessageMenubarConfig(TopicType.Session).buttonIds).not.toContain('trace')
  })
})
