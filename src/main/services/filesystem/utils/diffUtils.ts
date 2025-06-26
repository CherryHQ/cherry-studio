import { createTwoFilesPatch } from 'diff'

export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n')
}

export function createUnifiedDiff(originalContent: string, newContent: string, filepath: string = 'file'): string {
  // Ensure consistent line endings for diff
  const normalizedOriginal = normalizeLineEndings(originalContent)
  const normalizedNew = normalizeLineEndings(newContent)

  return createTwoFilesPatch(filepath, filepath, normalizedOriginal, normalizedNew, 'original', 'modified')
}

export function formatDiff(diff: string): string {
  // Format diff with appropriate number of backticks
  let numBackticks = 3
  while (diff.includes('`'.repeat(numBackticks))) {
    numBackticks++
  }
  return `${'`'.repeat(numBackticks)}diff\n${diff}${'`'.repeat(numBackticks)}\n\n`
}

// Fuzzy matching utilities for edit_block
export function findFuzzyMatch(
  content: string,
  searchText: string,
  threshold: number = 0.75
): { start: number; end: number; match: string; score: number } | null {
  const searchLines = searchText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  const contentLines = content.split('\n')

  let bestMatch: { start: number; end: number; match: string; score: number } | null = null

  // Try to find a sequence of lines that match with some flexibility
  for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
    const candidates = []
    let totalScore = 0
    let validMatches = 0

    // Try exact length match first
    for (let j = 0; j < searchLines.length && i + j < contentLines.length; j++) {
      const contentLine = contentLines[i + j].trim()
      const searchLine = searchLines[j]
      const similarity = calculateSimilarity(contentLine, searchLine)

      candidates.push({
        line: contentLines[i + j],
        similarity,
        valid: similarity > threshold
      })

      if (similarity > threshold) {
        totalScore += similarity
        validMatches++
      }
    }

    // Check if we have enough valid matches
    const matchRatio = validMatches / searchLines.length
    if (matchRatio >= 0.7) {
      // At least 70% of lines should match
      const averageScore = totalScore / searchLines.length

      if (averageScore > threshold && (!bestMatch || averageScore > bestMatch.score)) {
        // Calculate character positions
        const startLineIndex = i
        const endLineIndex = i + searchLines.length - 1

        let start = 0
        for (let k = 0; k < startLineIndex; k++) {
          start += contentLines[k].length + 1 // +1 for newline
        }

        let end = start
        for (let k = startLineIndex; k <= endLineIndex; k++) {
          end += contentLines[k].length + (k < endLineIndex ? 1 : 0)
        }

        bestMatch = {
          start,
          end,
          match: candidates.map((c) => c.line).join('\n'),
          score: averageScore
        }
      }
    }
  }

  return bestMatch
}

function calculateSimilarity(str1: string, str2: string): number {
  if (str1 === str2) return 1
  if (str1.length === 0 || str2.length === 0) return 0

  // Use Levenshtein distance for better similarity calculation
  const distance = levenshteinDistance(str1, str2)
  const maxLength = Math.max(str1.length, str2.length)
  return 1 - distance / maxLength
}

function levenshteinDistance(str1: string, str2: string): number {
  const matrix: number[][] = []
  const len1 = str1.length
  const len2 = str2.length

  // Initialize matrix
  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i]
  }
  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j
  }

  // Fill matrix
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1, // deletion
        matrix[i][j - 1] + 1, // insertion
        matrix[i - 1][j - 1] + cost // substitution
      )
    }
  }

  return matrix[len1][len2]
}
