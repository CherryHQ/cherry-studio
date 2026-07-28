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
  scopeKey: string
  initialSelection?: KnowledgeBase[]
  remountsOnScopeChange?: boolean
}

/** Drives the hook with real selection state so pruning and restore effects actually settle. */
function useScopeHarness(props: HarnessProps) {
  const [selectedKnowledgeBases, setSelectedKnowledgeBases] = useState<KnowledgeBase[]>(props.initialSelection ?? [])
  const scope = useComposerKnowledgeBaseScope({
    configuredKnowledgeBaseIds: props.configuredKnowledgeBaseIds,
    allKnowledgeBases: props.allKnowledgeBases,
    isKnowledgeBasesLoading: props.isKnowledgeBasesLoading,
    scopeKey: props.scopeKey,
    selectedKnowledgeBases,
    setSelectedKnowledgeBases,
    remountsOnScopeChange: props.remountsOnScopeChange
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
  })

  describe('remountsOnScopeChange', () => {
    const bases = [kb('kb-1'), kb('kb-2')]

    it('keeps a selection seeded at mount when the caller remounts per scope', () => {
      // The Agent composer restores its knowledge chips from the draft cache and must seed the pick
      // synchronously, or the surface's managed-token sync strips the chip as unselected. Its tool
      // provider is keyed by agent + session, so that seed can only belong to the current scope.
      const { result } = renderHook(useScopeHarness, {
        initialProps: {
          allKnowledgeBases: bases,
          isKnowledgeBasesLoading: false,
          scopeKey: SCOPE_KEY,
          initialSelection: [bases[0]],
          remountsOnScopeChange: true
        }
      })

      expect(result.current.selectedKnowledgeBases).toEqual([bases[0]])
      expect(result.current.selectedKnowledgeBasesInScope).toEqual([bases[0]])
    })

    it('still prunes a seeded pick the assistant no longer configures', () => {
      const { result } = renderHook(useScopeHarness, {
        initialProps: {
          configuredKnowledgeBaseIds: ['kb-2'],
          allKnowledgeBases: bases,
          isKnowledgeBasesLoading: false,
          scopeKey: SCOPE_KEY,
          initialSelection: [bases[0]],
          remountsOnScopeChange: true
        }
      })

      expect(result.current.selectedKnowledgeBases).toEqual([])
    })

    it('clears a mount selection when the caller shares one hook across scopes', () => {
      // Chat keeps a single tool provider across topics, so a selection present at mount predates the
      // current scope and must not survive into it.
      const { result } = renderHook(useScopeHarness, {
        initialProps: {
          allKnowledgeBases: bases,
          isKnowledgeBasesLoading: false,
          scopeKey: SCOPE_KEY,
          initialSelection: [bases[0]]
        }
      })

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
