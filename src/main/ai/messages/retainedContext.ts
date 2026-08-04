/**
 * Context that must survive durable compaction.
 *
 * Compaction folds old rows into a summary row, so anything derived from the
 * SERVED message view silently loses what was folded. Capability state is
 * therefore computed here as a pure function of the RAW path (compaction only
 * sets a column, never deletes rows) and travels with the request — main
 * process only, never over IPC.
 *
 * Three layers, three homes:
 * - capability state (this struct): raw-path pure function, request-carried,
 *   never rendered into the prompt;
 * - affordance hints (summary-row manifest, `<persisted-output>` markers):
 *   byte-stable mechanical rendering of stored/boundary fields — never
 *   entrusted to the summarizer;
 * - the content itself: durable storage (FileManager blobs, DB rows) behind a
 *   read-back tool (read_file / fs_read).
 *
 * Extension contract — a new kind of surviving context is added by:
 * 1. adding a field here and extending {@link collectRetainedContext};
 * 2. if the model needs a hint, extending the summary-row manifest with an
 *    append-only section that renders nothing when the kind is absent (so
 *    existing conversations keep their exact bytes);
 * 3. making sure a read-back tool covers it — without one it does not survive,
 *    and that should be a decision, not an accident.
 * Consumers must clone any mutable projection per model run (see
 * `buildAgentParams`' Set clone) — one RetainedContext instance serves every
 * model of a multi-model send.
 */

import type { UIMessage } from 'ai'

import { collectFileAttachments } from './attachmentRouting'
import type { FileAttachmentRef } from './attachmentTypes'
import { collectPersistedOutputPaths } from './persistedOutputRendering'

export interface RetainedContext {
  /** ALL conversation attachments (folded + live) — read_file registration
   *  and handle→entry resolution. */
  fileAttachments: FileAttachmentRef[]
  /** Physical paths of ALL persisted tool-output blobs (folded + live) — the
   *  fs_read allow-list seed. Readonly: the in-flight offload adapter appends
   *  to a per-model clone, never to this shared instance. */
  persistedOutputPaths: ReadonlySet<string>
}

/** Collect every kind of surviving context in one pass over `messages`. */
export function collectRetainedContext(messages: UIMessage[]): RetainedContext {
  return {
    fileAttachments: collectFileAttachments(messages),
    persistedOutputPaths: collectPersistedOutputPaths(messages)
  }
}
