import type { Topic } from '@renderer/types'

import type { BranchHlColorKey } from './constants'

/**
 * BranchAnchor carries the context needed to open a branch from a text
 * selection inside a `MainTextBlock`. `findBlockContext` resolves
 * `{messageId, blockId}` (T-006B); `captureSelectionOffsets` resolves the
 * char range; the caller (SelectionContextMenu) attaches the raw
 * `selectedText`.
 *
 * P1-S1: this stays as the SelectionContextMenu → Chat.tsx hand-off shape.
 * Chat.tsx wraps each incoming anchor into a Branch (see below) before
 * storing; `useBranchFork.fork()` still takes a BranchAnchor unchanged.
 */
export interface BranchAnchor {
  messageId: string
  blockId: string
  selectedText: string
  /**
   * Char offsets of the selection within the source block's text content,
   * for the S6' precise-range highlight. Captured on a completed
   * (non-streaming) message so they stay stable. `0/0` means "not captured"
   * — the highlight then resolves to nothing rather than the whole block.
   */
  selectionStart: number
  selectionEnd: number
}

/**
 * Branch — generalized N-branch state shape (P1-S1, zero-behavior-change
 * foundation; S2 lifts the length cap, S3 adds disposition).
 *
 * S1 invariant: Chat.tsx holds `branches: Branch[]` with `branches.length ≤ 1`.
 * The list shape is the state foundation for multi-branch UI; at length ≤ 1
 * every downstream derivation (highlight anchors, synthetic assistant.topics,
 * BranchPane composer/conversation props) collapses to bit-for-bit the same
 * runtime values the single-anchor shape produced.
 *
 * `id` is a client-generated stable key — NOT the same as `topic.id`, because
 * the Branch exists in the UI BEFORE POST /topics returns (compose state has
 * `topic === null`), and as the React list key for future multi-branch
 * rendering. Generated via `uuid` (repo convention; see messageUtils/create.ts).
 *
 * `source` is the precise location the branch was opened from — same five
 * fields BranchAnchor carries, grouped under one nested object so future
 * additions (e.g. anchor-color, disposition) can sit at the top level
 * without re-naming source fields.
 */
export interface Branch {
  id: string
  source: {
    messageId: string
    blockId: string
    selectedText: string
    offsets: { start: number; end: number }
  }
  /** The forked topic, or null while POST /topics is in flight / never started. */
  topic: Topic | null
  /** Wall-clock millis when the branch was opened (for ordering / debug). */
  createdAt: number
  /**
   * Palette key driving the source-passage highlight color (P1-S2a). Stamped
   * onto each injected `<span class="branch-anchor-highlight">` as
   * `data-hl="cN"`; CSS maps each key to a `--branch-hl-cN` custom property.
   * S2a assigns `BRANCH_HL_DEFAULT_COLOR` ('c1') unconditionally; S2b cycles
   * through the palette as multiple branches open.
   */
  color: BranchHlColorKey
  /**
   * Close-time disposition (P1-S3). `pending` (default on create) → closing
   * silently DELETES the fork topic (absorbs the orphan). `kept` (opt-in via
   * the Keep button) → closing leaves the fork topic in the DB. See
   * `branchDisposition.ts`.
   */
  disposition: BranchDisposition
}

/** P1-S3 close-time disposition for a branch. */
export type BranchDisposition = 'pending' | 'kept'
