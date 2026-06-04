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

  it('offers the trace button in the agent (Session) scope', () => {
    expect(getMessageMenubarConfig(TopicType.Session).buttonIds).toContain('trace')
  })

  it('still offers the translate button in the chat scope', () => {
    expect(getMessageMenubarConfig(TopicType.Chat).buttonIds).toContain('translate')
  })
})
