import fs from 'fs/promises'

import { EditOperation, EditResult, ServiceResult } from '../types'
import { createUnifiedDiff, findFuzzyMatch, formatDiff, normalizeLineEndings } from '../utils/diffUtils'

export async function applyFileEdits(
  filePath: string,
  edits: EditOperation[],
  dryRun = false
): Promise<ServiceResult<string>> {
  try {
    // Read file content and normalize line endings
    const content = normalizeLineEndings(await fs.readFile(filePath, 'utf-8'))

    if (edits.length === 0) {
      return { success: true, data: 'No edits to apply' }
    }

    // Validate that all oldText exists before applying any edits
    for (const [index, edit] of edits.entries()) {
      const normalizedOld = normalizeLineEndings(edit.oldText)
      if (!content.includes(normalizedOld)) {
        // Check if we can find it with whitespace flexibility
        const found = findTextWithWhitespaceFlexibility(content, normalizedOld)
        if (!found) {
          return {
            success: false,
            error: `Edit ${index + 1}: Could not find text to replace:\n${edit.oldText}`
          }
        }
      }
    }

    // Apply edits sequentially
    let modifiedContent = content
    for (const [index, edit] of edits.entries()) {
      const normalizedOld = normalizeLineEndings(edit.oldText)
      const normalizedNew = normalizeLineEndings(edit.newText)

      // If exact match exists, use it
      if (modifiedContent.includes(normalizedOld)) {
        // Only replace the first occurrence to avoid unintended replacements
        const replaceIndex = modifiedContent.indexOf(normalizedOld)
        modifiedContent =
          modifiedContent.substring(0, replaceIndex) +
          normalizedNew +
          modifiedContent.substring(replaceIndex + normalizedOld.length)
        continue
      }

      // Otherwise, try line-by-line matching with flexibility for whitespace
      const oldLines = normalizedOld.split('\n')
      const contentLines = modifiedContent.split('\n')
      let matchFound = false

      for (let i = 0; i <= contentLines.length - oldLines.length; i++) {
        const potentialMatch = contentLines.slice(i, i + oldLines.length)

        // Compare lines with normalized whitespace
        const isMatch = oldLines.every((oldLine, j) => {
          const contentLine = potentialMatch[j]
          return oldLine.trim() === contentLine.trim()
        })

        if (isMatch) {
          // Preserve original indentation more intelligently
          const originalIndent = contentLines[i].match(/^\s*/)?.[0] || ''
          const newLines = normalizedNew.split('\n').map((line, j) => {
            if (j === 0) {
              // For the first line, preserve the original indentation
              return originalIndent + line.trimStart()
            }

            // For subsequent lines, calculate relative indentation
            const oldIndent = oldLines[j]?.match(/^\s*/)?.[0] || ''
            const newIndent = line.match(/^\s*/)?.[0] || ''

            if (oldIndent && newIndent) {
              // Calculate the difference in indentation
              const oldIndentSize = oldIndent.length
              const newIndentSize = newIndent.length
              const indentDifference = newIndentSize - oldIndentSize

              // Apply the same indentation pattern but relative to original
              const baseIndent = originalIndent
              const additionalIndent = ' '.repeat(Math.max(0, indentDifference))
              return baseIndent + additionalIndent + line.trimStart()
            }

            // If we can't determine indentation, preserve the line as-is but with base indent
            return line.trim() ? originalIndent + line.trimStart() : line
          })

          contentLines.splice(i, oldLines.length, ...newLines)
          modifiedContent = contentLines.join('\n')
          matchFound = true
          break
        }
      }

      if (!matchFound) {
        return {
          success: false,
          error: `Edit ${index + 1}: Could not find exact match for edit:\n${edit.oldText}\n\nTip: Check for whitespace differences or use fuzzy matching.`
        }
      }
    }

    // Create unified diff
    const diff = createUnifiedDiff(content, modifiedContent, filePath)
    const formattedDiff = formatDiff(diff)

    if (!dryRun) {
      await fs.writeFile(filePath, modifiedContent, 'utf-8')
    }

    return { success: true, data: formattedDiff }
  } catch (error) {
    return {
      success: false,
      error: `Failed to apply edits: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

export async function editBlock(
  filePath: string,
  searchText: string,
  replaceText: string,
  options: { fuzzy?: boolean; dryRun?: boolean } = {}
): Promise<ServiceResult<EditResult>> {
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    const normalizedContent = normalizeLineEndings(content)
    const normalizedSearch = normalizeLineEndings(searchText)
    const normalizedReplace = normalizeLineEndings(replaceText)

    let modifiedContent: string
    let matchFound = false

    // First try exact match
    if (normalizedContent.includes(normalizedSearch)) {
      modifiedContent = normalizedContent.replace(normalizedSearch, normalizedReplace)
      matchFound = true
    } else if (options.fuzzy) {
      // Try fuzzy matching
      const fuzzyResult = findFuzzyMatch(normalizedContent, normalizedSearch)
      if (fuzzyResult) {
        modifiedContent =
          normalizedContent.substring(0, fuzzyResult.start) +
          normalizedReplace +
          normalizedContent.substring(fuzzyResult.end)
        matchFound = true
      }
    }

    if (!matchFound) {
      return {
        success: true,
        data: {
          success: false,
          error: 'No match found for the search text'
        }
      }
    }

    // Create diff
    const diff = createUnifiedDiff(content, modifiedContent, filePath)
    const formattedDiff = formatDiff(diff)

    if (!options.dryRun) {
      await fs.writeFile(filePath, modifiedContent, 'utf-8')
    }

    return {
      success: true,
      data: {
        success: true,
        diff: formattedDiff
      }
    }
  } catch (error) {
    return {
      success: false,
      error: `Failed to edit block: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

// Helper function to find text with whitespace flexibility
function findTextWithWhitespaceFlexibility(content: string, searchText: string): boolean {
  const searchLines = searchText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  const contentLines = content.split('\n')

  // Try to find a sequence of lines that match when trimmed
  for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
    let allMatch = true

    for (let j = 0; j < searchLines.length; j++) {
      const contentLine = contentLines[i + j]?.trim() || ''
      const searchLine = searchLines[j]

      if (contentLine !== searchLine) {
        allMatch = false
        break
      }
    }

    if (allMatch) {
      return true
    }
  }

  return false
}
