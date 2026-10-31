/**
 * The launched agent id a launch receipt reports, read from its native text form. The receipt
 * opens with the SDK's launch prefix and names the id in the same breath — on the same line, or on
 * the next one — with the current SDK printing its parenthetical metadata between the two.
 */
export function parseLaunchReceiptText(output: string): string | undefined {
  const text = output.trim()
  // dsh acknowledges a continuable launch with exactly `started subagent <childId>` and no other
  // prose; the whole output must match, or a child's own answer naming the phrase would register.
  const dshLaunch = /^started subagent[ \t]+([A-Za-z0-9_-]+)$/.exec(text)?.[1]
  if (dshLaunch) return dshLaunch
  // The id trailer alone is spoofable, and so is a trailer that merely appears somewhere after the
  // prefix: a foreground launch's result is the child's own answer, and prose that quotes an id
  // must not bind the flow to it. The prefix names the id in its own breath — the only thing the
  // SDK may print between them is its one parenthetical metadata.
  const anchored =
    /^(?:Async agent launched successfully|done)\.(?:\s*\([^\n]*\))?(?:\n\s*|\s+)(?:agent_?[Ii]d|Internal id)\s*:\s*([a-zA-Z0-9_-]+)/.exec(
      text
    )?.[1]
  if (anchored) return anchored
  // The SDK also appends this trailer to a foreground subagent's own answer so a later send can
  // continue it; the id repeats in the send parenthetical and a usage block closes the output.
  return /(?:\n|^)agentId: ([A-Za-z0-9_-]+) \([Uu]se SendMessage with to: '\1'[^\r\n]*\)\r?\n<usage>(?:(?!<\/usage>)[\s\S])*<\/usage>\s*$/.exec(
    text
  )?.[1]
}
