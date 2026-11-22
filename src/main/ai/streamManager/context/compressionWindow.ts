function roundStart<T extends { role: string }>(messages: T[], rounds: number): number {
  let seen = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user' && ++seen === rounds) return i
  }
  return 0
}

/** A round starts at a user row and includes every following continuation until the next user row. */
export function splitCompressionWindow<T extends { role: string }>(
  messages: T[],
  recentRounds: number | null | undefined,
  totalRounds: number | null | undefined
): { window: T[]; middle: T[]; recent: T[] } | null {
  if (
    recentRounds == null ||
    totalRounds == null ||
    !Number.isSafeInteger(recentRounds) ||
    !Number.isSafeInteger(totalRounds) ||
    recentRounds < 1 ||
    totalRounds <= recentRounds
  ) {
    return null
  }
  const start = roundStart(messages, totalRounds)
  const recent = roundStart(messages, recentRounds)
  return { window: messages.slice(start), middle: messages.slice(start, recent), recent: messages.slice(recent) }
}
