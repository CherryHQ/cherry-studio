import type { ScriptedReply } from '../contract/harness'

export const SCRIPT_EXHAUSTED = 'script exhausted'

/** The reply at `cursor`; past the end a failed request, so a forgotten script fails its run instead of hanging. */
export function replyAt(script: readonly ScriptedReply[], cursor: number): ScriptedReply {
  return cursor < script.length ? script[cursor] : { error: SCRIPT_EXHAUSTED }
}
