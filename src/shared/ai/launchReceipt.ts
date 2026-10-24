/**
 * dsh acknowledges a continuable launch with exactly `started subagent <childId>` and no other
 * prose; the whole output must match, or a child's own answer naming the phrase would register.
 */
const DSH_LAUNCH = /^started subagent[ \t]+([A-Za-z0-9_-]+)$/

/**
 * The receipt opens with the SDK's launch prefix and names the id in the same breath — on the same
 * line, or on the next one — with the current SDK printing its parenthetical metadata between the
 * two. The prefix names the id in its own breath: the only thing the SDK may print between them is
 * its one parenthetical metadata, so an id quoted by later prose cannot bind the flow to it.
 */
const START_ANCHORED =
  /^(?:Async agent launched successfully|done)\.(?:\s*\([^\n]*\))?(?:\n\s*|\s+)(?:agent_?[Ii]d|Internal id)\s*:\s*([a-zA-Z0-9_-]+)/

/**
 * The SDK also appends this trailer to a foreground subagent's own answer so a later send can
 * continue it; the id repeats in the send parenthetical and a usage block closes the output.
 */
const FOREGROUND_TRAILER =
  /(?:\n|^)agentId: ([A-Za-z0-9_-]+) \([Uu]se SendMessage with to: '\1'[^\r\n]*\)\r?\n<usage>(?:(?!<\/usage>)[\s\S])*<\/usage>\s*$/

/**
 * The launched agent id a launch receipt reports, read from its native text form.
 */
export function parseLaunchReceiptText(output: string): string | undefined {
  const text = output.trim()
  const dshLaunch = DSH_LAUNCH.exec(text)?.[1]
  if (dshLaunch) return dshLaunch
  const anchored = START_ANCHORED.exec(text)?.[1]
  if (anchored) return anchored
  return FOREGROUND_TRAILER.exec(text)?.[1]
}

/**
 * The report body a foreground answer carries before the SDK's trailing receipt: `''` when the
 * answer is only that trailer, `undefined` when no trailer is present (a background
 * acknowledgement, dsh's launch line, or plain prose). A launch acknowledgement is never
 * reclassified as an answer, even if a future SDK closes one with a usage block.
 */
export function stripForegroundLaunchTrailer(output: string): string | undefined {
  const text = output.trim()
  if (DSH_LAUNCH.test(text) || START_ANCHORED.test(text)) return undefined
  const match = FOREGROUND_TRAILER.exec(text)
  return match ? text.slice(0, match.index).trim() : undefined
}
