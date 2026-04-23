import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { ResourceEditorOptions, ResourceEditorState } from './editorTypes'

const DEFAULT_SAVED_FLASH_MS = 2000
const DEFAULT_FALLBACK_ERROR = 'Save failed'

/**
 * Shared state machine for resource editors (`AgentConfigPage`,
 * `AssistantConfigPage`). Owns `form` / `baseline` / `saving` / `saved`
 * / `error`; the resource-specific mutation chain lives in the
 * consumer's `onCommit` closure.
 *
 * Baseline lifecycle:
 * - Mount → `baseline = initialForm`.
 * - `baselineKey` changes → reset both `form` and `baseline` to the
 *   latest `initialForm` (captures scenarios like Agent "create →
 *   edit" transition where the parent swaps the resource prop after a
 *   successful POST).
 * - Successful `handleSave` → `baseline = nextBaseline ?? form`; form
 *   optionally replaced via `nextForm` (used when the server response
 *   brings canonical values the user should see).
 */
export function useResourceEditorState<TForm, TDiff>(
  options: ResourceEditorOptions<TForm, TDiff>
): ResourceEditorState<TForm, TDiff> {
  const { initialForm, baselineKey, diff, onCommit, fallbackErrorMessage, savedFlashMs } = options

  // Keep the latest lambdas in refs so `handleSave` doesn't re-create on
  // every render and consumers can pass inline arrow functions without
  // triggering dependency churn.
  const diffRef = useRef(diff)
  diffRef.current = diff
  const onCommitRef = useRef(onCommit)
  onCommitRef.current = onCommit
  const initialFormRef = useRef(initialForm)
  initialFormRef.current = initialForm

  const [form, setForm] = useState<TForm>(initialForm)
  const [baseline, setBaseline] = useState<TForm>(initialForm)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset on `baselineKey` transitions — mount captures `initialForm`
  // once, subsequent transitions pick up whatever the parent is passing
  // at that moment via `initialFormRef`.
  const keyRef = useRef<typeof baselineKey>(baselineKey)
  useEffect(() => {
    if (keyRef.current === baselineKey) return
    keyRef.current = baselineKey
    setForm(initialFormRef.current)
    setBaseline(initialFormRef.current)
    setError(null)
  }, [baselineKey])

  const diffResult = useMemo(() => diff(form, baseline), [diff, form, baseline])
  const canSave = diffResult !== null

  const onChange = useCallback((patch: Partial<TForm>) => {
    setForm((prev) => ({ ...prev, ...patch }))
  }, [])

  const resetBaseline = useCallback((next: TForm) => {
    setBaseline(next)
  }, [])

  const handleSave = useCallback(async () => {
    if (saving) return
    const pending = diffRef.current(form, baseline)
    if (pending === null) return

    setSaving(true)
    setError(null)
    try {
      const result = await onCommitRef.current(pending, form)
      const nextBaseline = result?.nextBaseline ?? form
      setBaseline(nextBaseline)
      if (result?.nextForm !== undefined) {
        setForm(result.nextForm)
      }
      setSaved(true)
      const flash = savedFlashMs ?? DEFAULT_SAVED_FLASH_MS
      setTimeout(() => setSaved(false), flash)
    } catch (e) {
      const message = e instanceof Error && e.message ? e.message : (fallbackErrorMessage ?? DEFAULT_FALLBACK_ERROR)
      setError(message)
    } finally {
      setSaving(false)
    }
  }, [saving, form, baseline, fallbackErrorMessage, savedFlashMs])

  return {
    form,
    setForm,
    onChange,
    diffResult,
    canSave,
    saving,
    saved,
    error,
    handleSave,
    resetBaseline
  }
}
