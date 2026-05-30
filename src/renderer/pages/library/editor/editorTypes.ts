import type { Dispatch, SetStateAction } from 'react'

/**
 * Optional overrides the consumer can return from `onCommit` to control
 * how the editor's baseline/form update after a successful save.
 *
 * - Default (return nothing): `baseline = form` — canSave falls back to
 *   false for pure updates.
 * - `nextBaseline`: explicit baseline override — use when the server
 *   response carries fields the form didn't send (e.g. backend-filled
 *   ids / timestamps) so subsequent diffs stay accurate.
 * - `nextForm`: also reset the form. Needed after Agent create, where
 *   the server-assigned id / normalized fields should replace the
 *   user's pre-save values.
 */
export interface CommitResult<TForm> {
  nextBaseline?: TForm
  nextForm?: TForm
}

export interface ResourceEditorOptions<TForm, TDiff> {
  /** Initial form value, also used as the baseline when `baselineKey` flips. */
  initialForm: TForm
  /**
   * Identity of the edited resource. When it changes (e.g. Agent create
   * → edit transition, or the parent swaps to a different row), form &
   * baseline reset to `initialForm`.
   */
  baselineKey?: string | number | null
  /** Return `null` to mark "nothing to save" (disables Save). */
  diff: (form: TForm, baseline: TForm) => TDiff | null
  /**
   * Apply the diff via whatever DataApi mutation / side-effect chain
   * fits the resource. Throw to surface an error through `state.error`.
   */
  onCommit: (diff: TDiff, form: TForm) => Promise<CommitResult<TForm> | void>
  /** Fallback `state.error` text when a thrown error has no `message`. */
  fallbackErrorMessage?: string
  /** How long the `saved` flag stays true after a successful commit. */
  savedFlashMs?: number
}

export interface ResourceEditorState<TForm, TDiff> {
  form: TForm
  setForm: Dispatch<SetStateAction<TForm>>
  onChange: (patch: Partial<TForm>) => void
  diffResult: TDiff | null
  canSave: boolean
  saving: boolean
  saved: boolean
  error: string | null
  handleSave: () => Promise<void>
  resetBaseline: (next: TForm) => void
}
