import { render, waitFor } from '@testing-library/react'
import { Activity } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const subscriptionMocks = vi.hoisted(() => {
  const instances: Array<{ topicId: string; listen: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }> = []

  class MockTopicStreamSubscription {
    readonly listen = vi.fn()
    readonly dispose = vi.fn()

    constructor(readonly topicId: string) {
      instances.push(this)
    }
  }

  return { instances, MockTopicStreamSubscription }
})

vi.mock('@renderer/services/aiTransport', () => ({
  TopicStreamSubscription: subscriptionMocks.MockTopicStreamSubscription
}))

import { useTopicStreamSubscription } from '../useTopicStreamSubscription'

function Harness({ active, topicId }: { active: boolean; topicId: string }) {
  return (
    <Activity mode={active ? 'visible' : 'hidden'}>
      <SubscriptionConsumer topicId={topicId} />
    </Activity>
  )
}

function SubscriptionConsumer({ topicId }: { topicId: string }) {
  useTopicStreamSubscription(topicId)
  return null
}

describe('useTopicStreamSubscription', () => {
  beforeEach(() => {
    subscriptionMocks.instances.length = 0
  })

  it('recreates the subscription after Activity hides and shows the tab again', async () => {
    const view = render(<Harness active topicId="topic-1" />)

    await waitFor(() => expect(subscriptionMocks.instances[0]?.listen).toHaveBeenCalledTimes(1))

    view.rerender(<Harness active={false} topicId="topic-1" />)
    await waitFor(() => expect(subscriptionMocks.instances[0]?.dispose).toHaveBeenCalledTimes(1))

    view.rerender(<Harness active topicId="topic-1" />)

    await waitFor(() => expect(subscriptionMocks.instances).toHaveLength(2))
    expect(subscriptionMocks.instances[1]?.topicId).toBe('topic-1')
    expect(subscriptionMocks.instances[1]?.listen).toHaveBeenCalledTimes(1)
  })

  it('does not listen until the stable owner has a topic', async () => {
    const view = render(<SubscriptionConsumer topicId="" />)

    await waitFor(() => expect(subscriptionMocks.instances).toHaveLength(1))
    expect(subscriptionMocks.instances[0]?.listen).not.toHaveBeenCalled()

    view.rerender(<SubscriptionConsumer topicId="topic-1" />)

    await waitFor(() => expect(subscriptionMocks.instances).toHaveLength(2))
    expect(subscriptionMocks.instances[1]?.listen).toHaveBeenCalledTimes(1)
  })
})
