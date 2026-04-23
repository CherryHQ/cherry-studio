import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { ResourceEditorOptions } from '../editorTypes'
import { useResourceEditorState } from '../useResourceEditorState'

interface Form {
  name: string
  count: number
}

function simpleDiff(form: Form, baseline: Form): Partial<Form> | null {
  const patch: Partial<Form> = {}
  let dirty = false
  if (form.name !== baseline.name) {
    patch.name = form.name
    dirty = true
  }
  if (form.count !== baseline.count) {
    patch.count = form.count
    dirty = true
  }
  return dirty ? patch : null
}

function setup(overrides: Partial<ResourceEditorOptions<Form, Partial<Form>>> = {}) {
  const onCommit = overrides.onCommit ?? vi.fn().mockResolvedValue(undefined)
  const initialForm: Form = overrides.initialForm ?? { name: 'a', count: 0 }
  return renderHook(
    ({ key }: { key: string | null }) =>
      useResourceEditorState<Form, Partial<Form>>({
        initialForm,
        baselineKey: key,
        diff: simpleDiff,
        onCommit,
        savedFlashMs: overrides.savedFlashMs ?? 20,
        ...overrides
      }),
    { initialProps: { key: 'k1' as string | null } }
  )
}

describe('useResourceEditorState', () => {
  it('starts clean with canSave=false and the initial form value', () => {
    const { result } = setup()
    expect(result.current.form).toEqual({ name: 'a', count: 0 })
    expect(result.current.canSave).toBe(false)
    expect(result.current.saving).toBe(false)
    expect(result.current.saved).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('flips canSave to true after an onChange patch that differs from baseline', () => {
    const { result } = setup()
    act(() => result.current.onChange({ name: 'b' }))
    expect(result.current.form).toEqual({ name: 'b', count: 0 })
    expect(result.current.canSave).toBe(true)
    expect(result.current.diffResult).toEqual({ name: 'b' })
  })

  it('runs onCommit with the diff and settles canSave back to false on success', async () => {
    const onCommit = vi.fn().mockResolvedValue(undefined)
    const { result } = setup({ onCommit })

    act(() => result.current.onChange({ count: 5 }))
    expect(result.current.canSave).toBe(true)

    await act(async () => {
      await result.current.handleSave()
    })

    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit.mock.calls[0][0]).toEqual({ count: 5 })
    expect(result.current.canSave).toBe(false)
    expect(result.current.saved).toBe(true)

    // saved flag clears after the flash window.
    await waitFor(() => expect(result.current.saved).toBe(false))
  })

  it('no-ops handleSave when diff is null', async () => {
    const onCommit = vi.fn().mockResolvedValue(undefined)
    const { result } = setup({ onCommit })
    await act(async () => {
      await result.current.handleSave()
    })
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('surfaces errors thrown by onCommit without leaving saving=true', async () => {
    const onCommit = vi.fn().mockRejectedValue(new Error('network down'))
    const { result } = setup({ onCommit })

    act(() => result.current.onChange({ name: 'b' }))
    await act(async () => {
      await result.current.handleSave()
    })

    expect(result.current.error).toBe('network down')
    expect(result.current.saving).toBe(false)
    // Still dirty — user hasn't resolved the failure yet.
    expect(result.current.canSave).toBe(true)
  })

  it('applies nextBaseline from onCommit when given', async () => {
    const onCommit = vi.fn().mockResolvedValue({ nextBaseline: { name: 'server', count: 99 } })
    const { result } = setup({ onCommit })

    act(() => result.current.onChange({ name: 'user-typed' }))
    await act(async () => {
      await result.current.handleSave()
    })

    // Form stays as the user's typed value; baseline jumps to the
    // server-authoritative snapshot, so canSave reflects "user-typed"
    // vs "server" — still dirty (they differ).
    expect(result.current.form).toEqual({ name: 'user-typed', count: 0 })
    expect(result.current.canSave).toBe(true)
  })

  it('replaces both form and baseline when nextForm is returned', async () => {
    const onCommit = vi.fn().mockResolvedValue({
      nextBaseline: { name: 'server', count: 99 },
      nextForm: { name: 'server', count: 99 }
    })
    const { result } = setup({ onCommit })

    act(() => result.current.onChange({ name: 'tmp' }))
    await act(async () => {
      await result.current.handleSave()
    })

    expect(result.current.form).toEqual({ name: 'server', count: 99 })
    expect(result.current.canSave).toBe(false)
  })

  it('resets form and baseline to the latest initialForm when baselineKey changes', () => {
    // Re-render with a new initialForm each call so we can verify the
    // reset picks up the most recent props, not the mount snapshot.
    const onCommit = vi.fn().mockResolvedValue(undefined)
    const { result, rerender } = renderHook(
      ({ key, initialForm }: { key: string | null; initialForm: Form }) =>
        useResourceEditorState<Form, Partial<Form>>({
          initialForm,
          baselineKey: key,
          diff: simpleDiff,
          onCommit
        }),
      { initialProps: { key: 'k1' as string | null, initialForm: { name: 'a', count: 0 } } }
    )

    act(() => result.current.onChange({ name: 'user-edit' }))
    expect(result.current.canSave).toBe(true)

    rerender({ key: 'k2', initialForm: { name: 'fresh', count: 7 } })

    expect(result.current.form).toEqual({ name: 'fresh', count: 7 })
    expect(result.current.canSave).toBe(false)
  })

  it('uses the fallback error message when thrown errors are non-Error', async () => {
    const onCommit = vi.fn().mockRejectedValue('string error')
    const { result } = setup({ onCommit, fallbackErrorMessage: 'save failed' })

    act(() => result.current.onChange({ name: 'b' }))
    await act(async () => {
      await result.current.handleSave()
    })

    expect(result.current.error).toBe('save failed')
  })
})
