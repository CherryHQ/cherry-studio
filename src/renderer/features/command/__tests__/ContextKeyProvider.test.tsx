import type { ContextValue } from '@shared/command'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { preferenceValues } = vi.hoisted(() => ({
  preferenceValues: {} as Record<string, unknown>
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: (key: string) => [preferenceValues[key] ?? false, vi.fn()]
}))

import {
  ContextKeyProvider,
  type RendererCommandContextKey,
  useCommandContextKey,
  useCommandContextSnapshot
} from '../ContextKeyProvider'

function SnapshotView({ testId = 'snapshot' }: { testId?: string }) {
  const snapshot = useCommandContextSnapshot()
  return <pre data-testid={testId}>{JSON.stringify(Object.fromEntries(snapshot))}</pre>
}

function ScopedContextKey({ contextKey, value }: { contextKey: RendererCommandContextKey; value: ContextValue }) {
  useCommandContextKey(contextKey, value)
  return null
}

const readSnapshot = (testId = 'snapshot') => JSON.parse(screen.getByTestId(testId).textContent ?? '{}')

describe('ContextKeyProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const key of Object.keys(preferenceValues)) {
      delete preferenceValues[key]
    }
  })

  afterEach(() => {
    cleanup()
  })

  it('initializes platform and feature flags', () => {
    preferenceValues['feature.quick_assistant.enabled'] = true
    preferenceValues['feature.selection.enabled'] = false

    render(
      <ContextKeyProvider>
        <SnapshotView />
      </ContextKeyProvider>
    )

    expect(readSnapshot()).toMatchObject({
      platform: expect.any(String),
      'feature.quick_assistant.enabled': true,
      'feature.selection.enabled': false
    })
  })

  it('updates snapshot when feature preferences change', async () => {
    preferenceValues['feature.quick_assistant.enabled'] = false
    const { rerender } = render(
      <ContextKeyProvider>
        <SnapshotView />
      </ContextKeyProvider>
    )

    expect(readSnapshot()['feature.quick_assistant.enabled']).toBe(false)

    preferenceValues['feature.quick_assistant.enabled'] = true
    rerender(
      <ContextKeyProvider>
        <SnapshotView />
      </ContextKeyProvider>
    )

    await waitFor(() => {
      expect(readSnapshot()['feature.quick_assistant.enabled']).toBe(true)
    })
  })

  it('registers scoped keys and removes them on unmount', async () => {
    const { rerender } = render(
      <ContextKeyProvider>
        <ScopedContextKey contextKey="chat.active" value />
        <SnapshotView />
      </ContextKeyProvider>
    )

    await waitFor(() => {
      expect(readSnapshot()['chat.active']).toBe(true)
    })

    rerender(
      <ContextKeyProvider>
        <SnapshotView />
      </ContextKeyProvider>
    )

    await waitFor(() => {
      expect(readSnapshot()['chat.active']).toBeUndefined()
    })
  })

  it('uses stack priority for duplicate scoped keys', async () => {
    const { rerender } = render(
      <ContextKeyProvider>
        <ScopedContextKey key="first" contextKey="topic.exists" value />
        <SnapshotView />
      </ContextKeyProvider>
    )

    await waitFor(() => {
      expect(readSnapshot()['topic.exists']).toBe(true)
    })

    rerender(
      <ContextKeyProvider>
        <ScopedContextKey key="first" contextKey="topic.exists" value />
        <ScopedContextKey key="second" contextKey="topic.exists" value={false} />
        <SnapshotView />
      </ContextKeyProvider>
    )

    await waitFor(() => {
      expect(readSnapshot()['topic.exists']).toBe(false)
    })

    rerender(
      <ContextKeyProvider>
        <ScopedContextKey key="first" contextKey="topic.exists" value />
        <SnapshotView />
      </ContextKeyProvider>
    )

    await waitFor(() => {
      expect(readSnapshot()['topic.exists']).toBe(true)
    })
  })

  it('keeps provider instances isolated', async () => {
    render(
      <>
        <ContextKeyProvider>
          <ScopedContextKey contextKey="chat.active" value />
          <SnapshotView testId="first" />
        </ContextKeyProvider>
        <ContextKeyProvider>
          <ScopedContextKey contextKey="chat.active" value={false} />
          <SnapshotView testId="second" />
        </ContextKeyProvider>
      </>
    )

    await waitFor(() => {
      expect(readSnapshot('first')['chat.active']).toBe(true)
      expect(readSnapshot('second')['chat.active']).toBe(false)
    })
  })
})
