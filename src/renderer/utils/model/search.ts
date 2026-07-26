export type ModelSearchField = {
  value?: string | null
  /**
   * The weight multiplier for this field.
   * Match score = tier_offset + field.weight * 100 + match_offset.
   *
   * RELATIONSHIP WITH TIER OFFSET:
   * Score tiers are: raw substring (0) -> normalized substring (1000) -> token initials (1500) -> abbreviation (2000).
   * Since lower scores are ranked higher (better relevance), setting a large weight (e.g. 30) for a field
   * will shift its match score by weight * 100 (e.g. +3000), effectively deprioritizing even its exact, raw matches
   * to rank below weaker match types (like abbreviations) of fields with lower weight (e.g. weight 0).
   * This is useful for flagging fields (like 'description') as weak signals.
   */
  weight: number
  allowAbbreviation?: boolean
}

function normalizeSearchSegment(value: string) {
  return value.toLowerCase().replace(/[\s._:/\\-]+/g, '')
}

function getSearchTokens(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/)
    .flatMap((segment) => segment.match(/[a-zA-Z]+|\d+/g) ?? [])
    .map((segment) => segment.toLowerCase())
}

function getTokenInitials(value: string) {
  return getSearchTokens(value)
    .map((token) => token[0])
    .join('')
}

function getOrderedCharacterMatchSpan(keyword: string, text: string) {
  if (!keyword) {
    return null
  }

  let keywordIndex = 0
  let startIndex = -1

  for (let textIndex = 0; textIndex < text.length; textIndex += 1) {
    const char = text[textIndex]
    if (char === keyword[keywordIndex]) {
      if (startIndex === -1) {
        startIndex = textIndex
      }

      keywordIndex += 1
    }

    if (keywordIndex === keyword.length) {
      return textIndex - startIndex + 1
    }
  }

  return null
}

function getKeywordMatchScore(keyword: string, fields: ModelSearchField[]) {
  const normalizedKeyword = normalizeSearchSegment(keyword)
  if (!normalizedKeyword) {
    return null
  }

  let bestScore: number | null = null

  for (const field of fields) {
    if (!field.value) {
      continue
    }

    const text = field.value.toLowerCase()
    const textIndex = text.indexOf(keyword)
    if (textIndex !== -1) {
      const score = field.weight * 100 + textIndex
      bestScore = bestScore === null ? score : Math.min(bestScore, score)
    }

    const normalizedText = normalizeSearchSegment(field.value)
    const normalizedIndex = normalizedText.indexOf(normalizedKeyword)
    if (normalizedIndex !== -1) {
      const score = 1000 + field.weight * 100 + normalizedIndex
      bestScore = bestScore === null ? score : Math.min(bestScore, score)
    }

    if (field.allowAbbreviation) {
      const tokenInitials = getTokenInitials(field.value)
      const tokenInitialsIndex = tokenInitials.indexOf(normalizedKeyword)
      if (tokenInitialsIndex !== -1) {
        const score = 1500 + field.weight * 100 + tokenInitialsIndex
        bestScore = bestScore === null ? score : Math.min(bestScore, score)
      }

      const abbreviationSpan = getOrderedCharacterMatchSpan(normalizedKeyword, normalizedText)
      if (abbreviationSpan !== null) {
        const score = 2000 + field.weight * 100 + abbreviationSpan
        bestScore = bestScore === null ? score : Math.min(bestScore, score)
      }
    }
  }

  return bestScore
}

export function getSearchMatchScore(keywords: string, fields: ModelSearchField[]) {
  const normalizedKeywords = keywords.toLowerCase().split(/\s+/).filter(Boolean)
  if (normalizedKeywords.length === 0) {
    return 0
  }

  let totalScore = 0

  for (const keyword of normalizedKeywords) {
    const keywordScore = getKeywordMatchScore(keyword, fields)
    if (keywordScore === null) {
      return null
    }

    totalScore += keywordScore
  }

  return totalScore
}
