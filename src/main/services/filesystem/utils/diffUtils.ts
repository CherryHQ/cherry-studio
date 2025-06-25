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
  threshold: number = 0.8
): { start: number; end: number; match: string } | null {
  const searchLines = searchText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  const contentLines = content.split('\n')

  // Try to find a sequence of lines that match with some flexibility
  for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
    let matchScore = 0
    const matchedLines: string[] = []

    for (let j = 0; j < searchLines.length; j++) {
      const contentLine = contentLines[i + j].trim()
      const searchLine = searchLines[j]

      // Calculate similarity score
      const similarity = calculateSimilarity(contentLine, searchLine)
      if (similarity > threshold) {
        matchScore += similarity
        matchedLines.push(contentLines[i + j])
      } else {
        break
      }
    }

    if (matchedLines.length === searchLines.length) {
      const averageScore = matchScore / searchLines.length
      if (averageScore > threshold) {
        // Calculate the actual character positions
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

        return {
          start,
          end,
          match: matchedLines.join('\n')
        }
      }
    }
  }

  return null
}

function calculateSimilarity(str1: string, str2: string): number {
  if (str1 === str2) return 1
  if (str1.length === 0 || str2.length === 0) return 0

  // Simple character-based similarity
  const longer = str1.length > str2.length ? str1 : str2
  const shorter = str1.length > str2.length ? str2 : str1

  let matches = 0
  for (let i = 0; i < shorter.length; i++) {
    if (longer[i] === shorter[i]) {
      matches++
    }
  }

  return matches / longer.length
}
