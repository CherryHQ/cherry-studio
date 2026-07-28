import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { act, renderHook } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { useComposerKnowledgeBaseScope } from '../useComposerKnowledgeBaseScope'

const kb = (id: string, name = id): KnowledgeBase => ({ id, name }) as KnowledgeBase

interface HarnessProps {
  configuredKnowledgeBaseIds?: readonly string[]
  allKnowledgeBases: KnowledgeBase[]
  isKnowledgeBasesLoading: boolean
  knowledgeBasesError?: unknown
  scopeKey: string
}

/** Drives the hook with real selection state so pruning and restore effects actually settle. */
function useScopeHarness(props: HarnessProps) {
  const [selectedKnowledgeBases, setSelectedKnowledgeBases] = useState<KnowledgeBase[]>([])
  const scope = useComposerKnowledgeBaseScope({
    configuredKnowledgeBaseIds: props.configuredKnowledgeBaseIds,
    allKnowledgeBases: props.allKnowledgeBases,
    isKnowledgeBasesLoading: props.isKnowledgeBasesLoading,
    knowledgeBasesError: props.knowledgeBasesError,
    scopeKey: props.scopeKey,
    selectedKnowledgeBases,
    setSelectedKnowledgeBases
  })
  return { ...scope, selectedKnowledgeBases }
}

const SCOPE_KEY = 'topic-1:agent-1'

describe('useComposerKnowledgeBaseScope', () => {
  it('treats an empty configured knowledge-base list as all loaded bases selectable', () => {
    const bases = [kb('kb-1', 'Knowledge One'), kb('kb-2', 'Knowledge Two')]

    const { result, rerender } = renderHook(() =>
      useComposerKnowledgeBaseScope({
        configuredKnowledgeBaseIds: [],
        allKnowledgeBases: bases,
        isKnowledgeBasesLoading: false,
        scopeKey: SCOPE_KEY,
        selectedKnowledgeBases: [bases[0]],
        setSelectedKnowledgeBases: vi.fn()
      })
    )

    expect(result.current.selectableKnowledgeBases).toEqual(bases)
    rerender()
    expect(result.current.selectedKnowledgeBasesInScope).toEqual([bases[0]])
    expect(result.current.resolveKnowledgeBaseMarker('Knowledge Two')).toMatchObject({
      id: 'knowledge:kb-2',
      kind: 'knowledge'
    })
  })

  describe('restoreKnowledgeBaseSelection', () => {
    const bases = [kb('kb-1'), kb('kb-2')]

    it('re-selects the persisted ids once the bases have loaded', () => {
      const { result } = renderHook(useScopeHarness, {
        initialProps: { allKnowledgeBases: bases, isKnowledgeBasesLoading: false, scopeKey: SCOPE_KEY }
      })

      act(() => result.current.restoreKnowledgeBaseSelection(['kb-2']))

      expect(result.current.selectedKnowledgeBases).toEqual([bases[1]])
    })

    it('defers a restore that lands inside the load window instead of dropping the scope', () => {
      // The follow-up queue is persisted, so editing a queued message right after a reload can restore
      // before the bases resolve. Mapping ids through the then-empty list would lose the whole scope,
      // and the queue entry is discarded immediately after — the loss would be unrecoverable.
      const { result, rerender } = renderHook(useScopeHarness, {
        initialProps: {
          allKnowledgeBases: [] as KnowledgeBase[],
          isKnowledgeBasesLoading: true,
          scopeKey: SCOPE_KEY
        }
      })

      act(() => result.current.restoreKnowledgeBaseSelection(['kb-1']))
      expect(result.current.selectedKnowledgeBases).toEqual([])

      rerender({ allKnowledgeBases: bases, isKnowledgeBasesLoading: false, scopeKey: SCOPE_KEY })

      expect(result.current.selectedKnowledgeBases).toEqual([bases[0]])
    })

    it('defers a restore when the knowledge-base query failed rather than resolving it to nothing', () => {
      // A failed load does not look like one: the query runs with `shouldRetryOnError: false`, so it
      // settles at isLoading=false with an empty list and never retries — identical in shape to "the
      // user has no knowledge bases". Guarding on loading alone would apply the restore against `[]`,
      // silently zeroing the scope just as the queue entry that carried it is discarded.
      const { result, rerender } = renderHook(useScopeHarness, {
        initialProps: {
          allKnowledgeBases: [] as KnowledgeBase[],
          isKnowledgeBasesLoading: false,
          knowledgeBasesError: new Error('knowledge bases unavailable') as Error | undefined,
          scopeKey: SCOPE_KEY
        }
      })

      act(() => result.current.restoreKnowledgeBaseSelection(['kb-1']))
      expect(result.current.selectedKnowledgeBases).toEqual([])

      // A later successful load (another query path revalidating the key) still applies the scope.
      rerender({
        allKnowledgeBases: bases,
        isKnowledgeBasesLoading: false,
        knowledgeBasesError: undefined,
        scopeKey: SCOPE_KEY
      })

      expect(result.current.selectedKnowledgeBases).toEqual([bases[0]])
    })

    it('restores only ids the send path would accept', () => {
      // `selectableKnowledgeBases`, not the raw list: a queued payload naming a base the agent no
      // longer configures must not come back as a checked-but-unsendable pick.
      const { result } = renderHook(useScopeHarness, {
        initialProps: {
          configuredKnowledgeBaseIds: ['kb-1'],
          allKnowledgeBases: bases,
          isKnowledgeBasesLoading: false,
          scopeKey: SCOPE_KEY
        }
      })

      act(() => result.current.restoreKnowledgeBaseSelection(['kb-1', 'kb-2']))

      expect(result.current.selectedKnowledgeBases).toEqual([bases[0]])
    })

    it('drops a still-pending restore when the composer scope changes', () => {
      const { result, rerender } = renderHook(useScopeHarness, {
        initialProps: {
          allKnowledgeBases: [] as KnowledgeBase[],
          isKnowledgeBasesLoading: true,
          scopeKey: SCOPE_KEY
        }
      })

      act(() => result.current.restoreKnowledgeBaseSelection(['kb-1']))
      rerender({ allKnowledgeBases: bases, isKnowledgeBasesLoading: false, scopeKey: 'topic-2:agent-1' })

      expect(result.current.selectedKnowledgeBases).toEqual([])
    })
  })

  it('clears the selection when the composer scope key changes', () => {
    const bases = [kb('kb-1'), kb('kb-2')]
    const { result, rerender } = renderHook(useScopeHarness, {
      initialProps: { allKnowledgeBases: bases, isKnowledgeBasesLoading: false, scopeKey: SCOPE_KEY }
    })
    act(() => result.current.restoreKnowledgeBaseSelection(['kb-1']))
    expect(result.current.selectedKnowledgeBases).toEqual([bases[0]])

    // Switching topic or agent must not carry one conversation's knowledge scope into the next.
    rerender({ allKnowledgeBases: bases, isKnowledgeBasesLoading: false, scopeKey: 'topic-2:agent-1' })

    expect(result.current.selectedKnowledgeBases).toEqual([])
  })
})
