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

    // Apply edits sequentially
    let modifiedContent = content
    for (const edit of edits) {
      const normalizedOld = normalizeLineEndings(edit.oldText)
      const normalizedNew = normalizeLineEndings(edit.newText)

      // If exact match exists, use it
      if (modifiedContent.includes(normalizedOld)) {
        modifiedContent = modifiedContent.replace(normalizedOld, normalizedNew)
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
          // Preserve original indentation of first line
          const originalIndent = contentLines[i].match(/^\s*/)?.[0] || ''
          const newLines = normalizedNew.split('\n').map((line, j) => {
            if (j === 0) return originalIndent + line.trimStart()
            // For subsequent lines, try to preserve relative indentation
            const oldIndent = oldLines[j]?.match(/^\s*/)?.[0] || ''
            const newIndent = line.match(/^\s*/)?.[0] || ''
            if (oldIndent && newIndent) {
              const relativeIndent = newIndent.length - oldIndent.length
              return originalIndent + ' '.repeat(Math.max(0, relativeIndent)) + line.trimStart()
            }
            return line
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
          error: `Could not find exact match for edit:\n${edit.oldText}`
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
