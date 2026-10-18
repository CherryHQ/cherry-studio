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
  // must not bind the flow to it. Every real receipt names the id within the prefix's own breath.
  return /^(?:Async agent launched successfully|done)\.[^\n]{0,240}(?:\n\s*|\s+)(?:agent_?[Ii]d|Internal id)\s*:\s*([a-zA-Z0-9_-]+)/.exec(
    text
  )?.[1]
}
