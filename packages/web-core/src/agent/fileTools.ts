// The agent's file tools on the account's ZenFS mount, with Pi's native names and input shapes so tool
// cards, approvals and stored tool rows read the same as the desktop's Pi. `ls`, `find` and `grep`
// stand in for Pi's `bash`; there is no shell in the browser.
import { glob, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { dynamicTool, type ToolSet } from 'ai'
import * as z from 'zod'

import { REPORT_ARTIFACTS_DESCRIPTION, reportArtifactsInputSchema } from '@shared/ai/builtinTools'

/** Pi's name for the bridged `cherry-tools` report tool, which the agent prompt asks for. */
export const REPORT_ARTIFACTS_TOOL = 'mcp__cherry_tools__report_artifacts'

const MAX_LINES = 2000
const MAX_BYTES = 50 * 1024
const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules'])

/** Pi's tool result shape: model-facing text plus details for the tool card. */
function textResult(text: string, details?: Record<string, unknown>) {
  return { content: [{ type: 'text' as const, text }], ...(details && { details }) }
}

/** Mirrors Pi's `resolveToCwd`: a leading `@` is dropped and relative paths join the workspace. */
export function resolveToolPath(cwd: string, raw: string | undefined): string {
  return path.resolve(cwd, (raw || '.').replace(/^@/, ''))
}

function truncate(text: string): { text: string; truncated: boolean } {
  const lines = text.split('\n')
  let kept = lines.slice(0, MAX_LINES).join('\n')
  if (kept.length > MAX_BYTES) kept = kept.slice(0, MAX_BYTES)
  return { text: kept, truncated: kept.length < text.length }
}

/** Glob patterns without a directory match a file name anywhere below the search root, as Pi's `fd` does. */
async function findFiles(root: string, pattern: string, limit: number): Promise<string[]> {
  const patterns = pattern.includes('/') ? [pattern] : [pattern, `**/${pattern}`]
  const found: string[] = []
  const exclude = (relative: string) => relative.split('/').some((segment) => SKIPPED_DIRECTORIES.has(segment))
  for await (const relative of glob(patterns, { cwd: root, exclude })) {
    found.push(relative)
    if (found.length >= limit) break
  }
  return found.sort()
}

export function createFileTools(cwd: string): ToolSet {
  return {
    read: dynamicTool({
      description: `Read the contents of a file. Output is truncated to ${MAX_LINES} lines or ${MAX_BYTES / 1024}KB; use offset/limit for large files.`,
      inputSchema: z.object({
        path: z.string().describe('Path to the file to read (relative or absolute)'),
        offset: z.number().optional().describe('Line number to start reading from (1-indexed)'),
        limit: z.number().optional().describe('Maximum number of lines to read')
      }),
      execute: async (input) => {
        const { path: target, offset = 1, limit } = input as { path: string; offset?: number; limit?: number }
        const lines = (await readFile(resolveToolPath(cwd, target), 'utf8')).split('\n')
        const start = Math.max(0, offset - 1)
        const selected = lines.slice(start, limit ? start + limit : undefined).join('\n')
        const { text, truncated } = truncate(selected)
        const shown = text.split('\n').length
        const end = start + shown
        return textResult(
          end < lines.length || truncated
            ? `${text}\n\n[Showing lines ${start + 1}-${end} of ${lines.length}. Use offset=${end + 1} to continue.]`
            : text
        )
      }
    }),
    write: dynamicTool({
      description:
        "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Creates parent directories.",
      inputSchema: z.object({
        path: z.string().describe('Path to the file to write (relative or absolute)'),
        content: z.string().describe('Content to write to the file')
      }),
      execute: async (input) => {
        const { path: target, content } = input as { path: string; content: string }
        const absolute = resolveToolPath(cwd, target)
        await mkdir(path.dirname(absolute), { recursive: true })
        await writeFile(absolute, content)
        return textResult(`Successfully wrote ${new TextEncoder().encode(content).length} bytes to ${target}`)
      }
    }),
    edit: dynamicTool({
      description:
        'Edit a file by replacing exact text. Each edits[].oldText must match a unique, non-overlapping region of the original file.',
      inputSchema: z.object({
        path: z.string().describe('Path to the file to edit (relative or absolute)'),
        edits: z
          .array(
            z.object({
              oldText: z.string().describe('Exact text for one targeted replacement'),
              newText: z.string().describe('Replacement text for this targeted edit')
            })
          )
          .describe('One or more targeted replacements, each matched against the original file')
      }),
      execute: async (input) => {
        const { path: target, edits } = input as { path: string; edits: Array<{ oldText: string; newText: string }> }
        const absolute = resolveToolPath(cwd, target)
        const original = await readFile(absolute, 'utf8')
        const ranges = edits.map(({ oldText, newText }, index) => {
          const start = original.indexOf(oldText)
          if (!oldText || start < 0) throw new Error(`edits[${index}].oldText was not found in ${target}`)
          if (original.indexOf(oldText, start + 1) >= 0) {
            throw new Error(`edits[${index}].oldText matches more than once in ${target}; add surrounding context`)
          }
          return { start, end: start + oldText.length, newText }
        })
        ranges.sort((a, b) => a.start - b.start)
        for (let index = 1; index < ranges.length; index++) {
          if (ranges[index].start < ranges[index - 1].end) throw new Error(`Edits overlap in ${target}`)
        }
        let updated = original
        for (const { start, end, newText } of ranges.reverse()) {
          updated = updated.slice(0, start) + newText + updated.slice(end)
        }
        await writeFile(absolute, updated)
        return textResult(`Successfully replaced ${edits.length} block(s) in ${target}.`)
      }
    }),
    ls: dynamicTool({
      description: 'List directory contents. Directories end with "/". Includes dotfiles.',
      inputSchema: z.object({
        path: z.string().optional().describe('Directory to list (default: current directory)'),
        limit: z.number().optional().describe('Maximum number of entries to return (default: 500)')
      }),
      execute: async (input) => {
        const { path: target, limit = 500 } = input as { path?: string; limit?: number }
        const entries = await readdir(resolveToolPath(cwd, target), { withFileTypes: true })
        const names = entries
          .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
          .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
        if (!names.length) return textResult('(empty directory)')
        const shown = names.slice(0, limit)
        return textResult(
          names.length > limit
            ? `${shown.join('\n')}\n\n[${limit} entries limit reached. Use limit=${limit * 2} for more.]`
            : shown.join('\n')
        )
      }
    }),
    find: dynamicTool({
      description: 'Search for files by glob pattern. Returns matching file paths relative to the search directory.',
      inputSchema: z.object({
        pattern: z.string().describe("Glob pattern to match files, e.g. '*.ts', '**/*.json', or 'src/**/*.spec.ts'"),
        path: z.string().optional().describe('Directory to search in (default: current directory)'),
        limit: z.number().optional().describe('Maximum number of results (default: 1000)')
      }),
      execute: async (input) => {
        const { pattern, path: target, limit = 1000 } = input as { pattern: string; path?: string; limit?: number }
        const found = await findFiles(resolveToolPath(cwd, target), pattern, limit)
        return textResult(found.length ? found.join('\n') : 'No files found matching pattern')
      }
    }),
    grep: dynamicTool({
      description: 'Search file contents for a pattern. Returns matching lines with file paths and line numbers.',
      inputSchema: z.object({
        pattern: z.string().describe('Search pattern (regex or literal string)'),
        path: z.string().optional().describe('Directory or file to search (default: current directory)'),
        glob: z.string().optional().describe("Filter files by glob pattern, e.g. '*.ts' or '**/*.spec.ts'"),
        ignoreCase: z.boolean().optional().describe('Case-insensitive search (default: false)'),
        literal: z.boolean().optional().describe('Treat pattern as literal string instead of regex (default: false)'),
        context: z.number().optional().describe('Number of lines to show before and after each match (default: 0)'),
        limit: z.number().optional().describe('Maximum number of matches to return (default: 100)')
      }),
      execute: async (input) => {
        const options = input as {
          pattern: string
          path?: string
          glob?: string
          ignoreCase?: boolean
          literal?: boolean
          context?: number
          limit?: number
        }
        const { context = 0, limit = 100 } = options
        const source = options.literal ? options.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : options.pattern
        const regex = new RegExp(source, options.ignoreCase ? 'i' : '')
        const target = resolveToolPath(cwd, options.path)
        const isDirectory = (await stat(target)).isDirectory()
        const files = isDirectory
          ? (await findFiles(target, options.glob ?? '*', Number.MAX_SAFE_INTEGER)).map((file) =>
              path.join(target, file)
            )
          : [target]
        const output: string[] = []
        let matches = 0
        for (const file of files) {
          if (!(await stat(file)).isFile()) continue
          const lines = (await readFile(file, 'utf8')).split('\n')
          const label = isDirectory ? path.relative(target, file) : path.basename(file)
          for (let index = 0; index < lines.length && matches < limit; index++) {
            if (!regex.test(lines[index])) continue
            matches++
            for (let line = Math.max(0, index - context); line <= Math.min(lines.length - 1, index + context); line++) {
              output.push(
                `${label}${line === index ? ':' : '-'}${line + 1}${line === index ? ':' : '-'} ${lines[line]}`
              )
            }
          }
          if (matches >= limit) break
        }
        if (!matches) return textResult('No matches found')
        const { text } = truncate(output.join('\n'))
        return textResult(matches >= limit ? `${text}\n\n[${limit} matches limit reached.]` : text)
      }
    }),
    [REPORT_ARTIFACTS_TOOL]: dynamicTool({
      description: REPORT_ARTIFACTS_DESCRIPTION,
      inputSchema: reportArtifactsInputSchema,
      execute: async (input) =>
        textResult(`Recorded ${(input as z.infer<typeof reportArtifactsInputSchema>).artifacts.length} artifact(s).`)
    })
  }
}
