/**
 * The attribution a model gets when the user rejects a tool call. Fixed English on purpose: it is
 * the anchor that separates "the user said this" from "the tool returned this", so it must read
 * the same for every model regardless of UI language. Renderers reuse it to show what the model saw.
 */
const REJECTED_HEADER =
  "The user doesn't want to proceed with this tool use. The tool use was rejected (it did not run)."

/** Renders the rejection reason — or the no-reason wording — for the model-facing tool result. */
export function withUserDenialFeedback(reason?: string): string {
  const said = reason?.trim()
  return said
    ? `${REJECTED_HEADER} To tell you how to proceed, the user said:\n${said}`
    : `${REJECTED_HEADER} Wait for the user's instructions instead of retrying it.`
}
