import type { Tab } from '@shared/data/cache/cacheValueTypes'
import { describe, expect, it } from 'vitest'

import { migrateLegacyConversationTabs } from '../tabMigration'

describe('migrateLegacyConversationTabs', () => {
  it('moves legacy chat and agent identities into URLs while preserving unrelated metadata', () => {
    const tabs: Tab[] = [
      {
        id: 'chat',
        type: 'route',
        url: '/app/chat',
        title: 'Chat',
        metadata: {
          instanceAppId: 'assistants',
          instanceKey: 'topic-1',
          filePreviewRefreshKey: 3
        }
      },
      {
        id: 'agent',
        type: 'route',
        url: '/app/agents',
        title: 'Agent',
        metadata: {
          instanceAppId: 'agents',
          instanceKey: 'session-1'
        }
      }
    ]

    expect(migrateLegacyConversationTabs(tabs)).toEqual({
      changed: true,
      tabs: [
        {
          ...tabs[0],
          url: '/app/chat?topicId=topic-1',
          metadata: { filePreviewRefreshKey: 3 }
        },
        {
          ...tabs[1],
          url: '/app/agents?sessionId=session-1',
          metadata: undefined
        }
      ]
    })
  })

  it('keeps an explicit URL target authoritative while removing stale legacy identity fields', () => {
    const tab: Tab = {
      id: 'chat',
      type: 'route',
      url: '/app/chat?topicId=url-topic',
      title: 'Chat',
      metadata: {
        instanceAppId: 'assistants',
        instanceKey: 'metadata-topic',
        retained: true
      }
    }

    expect(migrateLegacyConversationTabs([tab])).toEqual({
      changed: true,
      tabs: [
        {
          ...tab,
          metadata: { retained: true }
        }
      ]
    })
  })
})
