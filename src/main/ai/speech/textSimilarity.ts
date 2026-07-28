const WORD_PATTERN = /[\p{L}\p{N}']+/gu

export function tokenizeSpeechText(text: string): string[] {
  return (text.toLocaleLowerCase().match(WORD_PATTERN) ?? [])
    .map((token) => token.replace(/^'+|'+$/g, ''))
    .filter(Boolean)
}

function longestCommonSubsequence(left: string[], right: string[]): string[] {
  const lengths = Array.from({ length: left.length + 1 }, () => Array<number>(right.length + 1).fill(0))
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      lengths[i][j] =
        left[i - 1] === right[j - 1] ? lengths[i - 1][j - 1] + 1 : Math.max(lengths[i - 1][j], lengths[i][j - 1])
    }
  }

  const common: string[] = []
  let i = left.length
  let j = right.length
  while (i > 0 && j > 0) {
    if (left[i - 1] === right[j - 1]) {
      common.unshift(left[i - 1])
      i -= 1
      j -= 1
    } else if (lengths[i - 1][j] >= lengths[i][j - 1]) {
      i -= 1
    } else {
      j -= 1
    }
  }
  return common
}

export function compareSpeechText(target: string, transcript: string) {
  const targetTokens = tokenizeSpeechText(target)
  const transcriptTokens = tokenizeSpeechText(transcript)
  const common = longestCommonSubsequence(targetTokens, transcriptTokens)
  const remaining = new Map<string, number>()
  for (const token of common) remaining.set(token, (remaining.get(token) ?? 0) + 1)

  const subtractCommon = (tokens: string[]) => {
    const counts = new Map(remaining)
    return tokens.filter((token) => {
      const count = counts.get(token) ?? 0
      if (count === 0) return true
      counts.set(token, count - 1)
      return false
    })
  }

  const denominator = targetTokens.length + transcriptTokens.length
  return {
    similarity: denominator === 0 ? 1 : (2 * common.length) / denominator,
    omissions: subtractCommon(targetTokens),
    additions: subtractCommon(transcriptTokens)
  }
}
