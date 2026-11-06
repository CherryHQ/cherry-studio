import { act, renderHook } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { KnowledgeBase } from '@shared/data/types/knowledge'

import { useComposerKnowledgeBaseScope } from '../useComposerKnowledgeBaseScope'

const kb = (id: string, name = id): KnowledgeBase => ({ id, name }) as KnowledgeBase

interface HarnessProps {
  configuredKnowledgeBaseIds?: readonly string[]
  allKnowledgeBases: KnowledgeBase[]
  isKnowledgeBasesLoading: boolean
  scopeKey: string
  initialSelection?: KnowledgeBase[]
  initialKnowledgeBaseIds?: readonly string[]
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
    initialKnowledgeBaseIds: props.initialKnowledgeBaseIds ?? [],
    remountsOnScopeChange: props.remountsOnScopeChange
  })
  return { ...scope, selectedKnowledgeBases, setSelectedKnowledgeBases }
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
        setSelectedKnowledgeBases: vi.fn(),
        initialKnowledgeBaseIds: []
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
      const { result } = renderHook((props: HarnessProps) => useScopeHarness(props), {
        initialProps: { allKnowledgeBases: bases, isKnowledgeBasesLoading: false, scopeKey: SCOPE_KEY }
      })

      act(() => result.current.restoreKnowledgeBaseSelection(['kb-2']))

      expect(result.current.selectedKnowledgeBases).toEqual([bases[1]])
    })

    it('restores only ids the send path would accept', () => {
      // `selectableKnowledgeBases`, not the raw list: a queued payload naming a base the agent no
      // longer configures must not come back as a checked-but-unsendable pick.
      const { result } = renderHook((props: HarnessProps) => useScopeHarness(props), {
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

    it('keeps ids pending until the catalog offers them, then selects them', () => {
      const base = kb('kb-1')
      const { result, rerender } = renderHook((props: HarnessProps) => useScopeHarness(props), {
        initialProps: { allKnowledgeBases: [], isKnowledgeBasesLoading: false, scopeKey: SCOPE_KEY }
      })

      act(() => result.current.restoreKnowledgeBaseSelection(['kb-1'], { retryUnavailable: true }))
      expect(result.current.selectedKnowledgeBases).toEqual([])
      expect(result.current.knowledgeBaseIdsRef.current).toContain('kb-1')

      // The catalog becomes available after the restore (knowledge loading is disabled in an
      // empty composer until a restored draft needs it).
      rerender({ allKnowledgeBases: [base], isKnowledgeBasesLoading: false, scopeKey: SCOPE_KEY })
      expect(result.current.selectedKnowledgeBases).toEqual([base])
    })

    it('never selects a pending id the catalog keeps not offering', () => {
      const { result, rerender } = renderHook((props: HarnessProps) => useScopeHarness(props), {
        initialProps: { allKnowledgeBases: [], isKnowledgeBasesLoading: false, scopeKey: SCOPE_KEY }
      })

      act(() => result.current.restoreKnowledgeBaseSelection(['deleted-base'], { retryUnavailable: true }))

      rerender({ allKnowledgeBases: [kb('other')], isKnowledgeBasesLoading: false, scopeKey: SCOPE_KEY })
      expect(result.current.selectedKnowledgeBases).toEqual([])
      expect(result.current.selectedKnowledgeBasesInScope).toEqual([])
    })

    it('reports a pending restore only while the catalog is still loading', () => {
      const base = kb('kb-1')
      const { result, rerender } = renderHook((props: HarnessProps) => useScopeHarness(props), {
        initialProps: { allKnowledgeBases: [], isKnowledgeBasesLoading: true, scopeKey: SCOPE_KEY }
      })

      act(() => result.current.restoreKnowledgeBaseSelection(['kb-1'], { retryUnavailable: true }))
      expect(result.current.hasPendingKnowledgeBaseRestore).toBe(true)

      rerender({ allKnowledgeBases: [base], isKnowledgeBasesLoading: false, scopeKey: SCOPE_KEY })
      expect(result.current.selectedKnowledgeBases).toEqual([base])
      expect(result.current.hasPendingKnowledgeBaseRestore).toBe(false)
    })

    it('does not report a pending restore for ids the loaded catalog cannot offer', () => {
      const { result } = renderHook((props: HarnessProps) => useScopeHarness(props), {
        initialProps: { allKnowledgeBases: [], isKnowledgeBasesLoading: false, scopeKey: SCOPE_KEY }
      })

      act(() => result.current.restoreKnowledgeBaseSelection(['deleted-base'], { retryUnavailable: true }))
      expect(result.current.hasPendingKnowledgeBaseRestore).toBe(false)
    })

    it('drops a pending restore when the scope changes', () => {
      const { result, rerender } = renderHook((props: HarnessProps) => useScopeHarness(props), {
        initialProps: { allKnowledgeBases: [], isKnowledgeBasesLoading: true, scopeKey: SCOPE_KEY }
      })

      act(() => result.current.restoreKnowledgeBaseSelection(['kb-1'], { retryUnavailable: true }))
      expect(result.current.hasPendingKnowledgeBaseRestore).toBe(true)

      // Switching the assistant inside the same topic changes the scope without a remount.
      rerender({ allKnowledgeBases: [], isKnowledgeBasesLoading: true, scopeKey: 'topic-1:agent-2' })
      expect(result.current.hasPendingKnowledgeBaseRestore).toBe(false)

      // The old scope's pending id must not merge into the new scope's selection later.
      rerender({ allKnowledgeBases: [kb('kb-1')], isKnowledgeBasesLoading: false, scopeKey: 'topic-1:agent-2' })
      expect(result.current.selectedKnowledgeBases).toEqual([])
      expect(result.current.hasPendingKnowledgeBaseRestore).toBe(false)
    })

    it('keeps an existing selection while retrying pending ids', () => {
      const [first, second] = [kb('kb-1'), kb('kb-2')]
      const { result, rerender } = renderHook((props: HarnessProps) => useScopeHarness(props), {
        initialProps: {
          allKnowledgeBases: [first],
          isKnowledgeBasesLoading: false,
          scopeKey: SCOPE_KEY,
          initialSelection: [first]
        }
      })

      act(() => result.current.restoreKnowledgeBaseSelection(['kb-2'], { retryUnavailable: true }))
      expect(result.current.selectedKnowledgeBases).toEqual([])

      // While the retry is pending the user re-selects the first base; the retry must merge,
      // not replace.
      act(() => result.current.setSelectedKnowledgeBases([first]))
      rerender({ allKnowledgeBases: [first, second], isKnowledgeBasesLoading: false, scopeKey: SCOPE_KEY })
      expect(result.current.selectedKnowledgeBases).toEqual([first, second])
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

  describe('draft knowledge bases', () => {
    const one = kb('kb-1')
    const two = kb('kb-2')
    const loaded = { allKnowledgeBases: [one, two], isKnowledgeBasesLoading: false, scopeKey: SCOPE_KEY }

    it('is ready immediately when the draft saved no knowledge bases', () => {
      const { result } = renderHook(() => useScopeHarness(loaded))

      expect(result.current.isKnowledgeBaseDraftHydrated).toBe(true)
    })

    it('waits for the bases to load before restoring the saved selection', () => {
      const initialProps: HarnessProps = {
        ...loaded,
        allKnowledgeBases: [],
        isKnowledgeBasesLoading: true,
        initialKnowledgeBaseIds: [one.id]
      }
      const { result, rerender } = renderHook((props: HarnessProps) => useScopeHarness(props), { initialProps })

      expect(result.current.isKnowledgeBaseDraftHydrated).toBe(false)

      rerender({ ...loaded, initialKnowledgeBaseIds: [one.id] })

      expect(result.current.isKnowledgeBaseDraftHydrated).toBe(true)
      expect(result.current.selectedKnowledgeBases).toEqual([one])
    })

    it('keeps a saved id through unrelated draft writes when its base becomes available', () => {
      const late = kb('kb-late')
      const saved = [late.id, one.id]
      const { result, rerender } = renderHook((props: HarnessProps) => useScopeHarness(props), {
        initialProps: { ...loaded, initialKnowledgeBaseIds: saved }
      })

      rerender({ ...loaded, allKnowledgeBases: [one, two, late], initialKnowledgeBaseIds: saved })
      act(() => result.current.syncKnowledgeBaseIds())

      expect(result.current.knowledgeBaseIdsRef.current).toEqual(saved)
    })

    it('keeps a saved id that is unavailable when the selection changes', () => {
      const { result } = renderHook(() => useScopeHarness({ ...loaded, initialKnowledgeBaseIds: ['kb-gone', one.id] }))

      act(() => result.current.setSelectedKnowledgeBases([one, two]))
      act(() => result.current.syncKnowledgeBaseIds())

      expect(result.current.knowledgeBaseIdsRef.current).toEqual(['kb-gone', one.id, two.id])
    })

    it('drops a saved id once it is selectable and no longer selected', () => {
      const { result } = renderHook(() => useScopeHarness({ ...loaded, initialKnowledgeBaseIds: ['kb-gone', one.id] }))

      act(() => result.current.setSelectedKnowledgeBases([]))
      act(() => result.current.syncKnowledgeBaseIds())

      expect(result.current.knowledgeBaseIdsRef.current).toEqual(['kb-gone'])
    })
  })
})
