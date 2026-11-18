#!/usr/bin/env node
/**
 * Official-directory submission gate for a Cherry Studio Mini App.
 *
 * Usage:
 *   node scripts/check-directory-submission.mjs --files <changed-file>...
 *   node scripts/check-directory-submission.mjs --base <git-ref> [--repo <dir>]
 *   (either mode) [--app-id <id> --readmes <enReadme> <zhReadme>]
 *
 * A submission to the official directory changes ONLY the bilingual app
 * entries: README.md and README.zh-CN.md, both together, and nothing else —
 * no packages, no build output. With --app-id and the two README paths the
 * gate also rejects a duplicate listing (the app id already appears in an
 * existing entry), which the workflow requires checking BEFORE submitting.
 *
 * Exit 0 when the submission is a clean entry-only change; exit 1 with every
 * finding on failure. "published", "submitted" and "merged" remain three
 * separate states — this gate verifies the `submitted` shape only; it cannot
 * and does not report a listing as merged.
 *
 * Zero dependencies, plain node >= 18.
 */
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const ENTRY_FILES = new Set(['README.md', 'README.zh-CN.md'])

/**
 * Validate the changed-file list of a directory submission.
 * Returns { ok, issues } — every problem is reported, not just the first.
 */
export function checkSubmissionFiles(changedFiles) {
  const issues = []
  const normalized = changedFiles.map((f) => f.split(path.sep).join('/'))
  const basenames = normalized.map((f) => f.split('/').pop())
  const set = new Set(basenames)

  for (const file of normalized) {
    if (!ENTRY_FILES.has(file.split('/').pop())) {
      issues.push(`${file}: a directory submission changes only README.md and README.zh-CN.md entries`)
    }
  }
  // Nested READMEs (docs/README.md, packages/x/README.md) are not the
  // directory listing — only the repository-root files count.
  for (const file of normalized) {
    if (ENTRY_FILES.has(file.split('/').pop()) && file.includes('/')) {
      issues.push(`${file}: only the repository-root README entries may change`)
    }
  }
  if (!set.has('README.md')) issues.push('README.md: the English entry is missing from the submission')
  if (!set.has('README.zh-CN.md')) issues.push('README.zh-CN.md: the Chinese entry is missing from the submission')
  return { ok: issues.length === 0, issues }
}

/** Reject submitting an app id that an existing README entry already lists. */
export async function checkDuplicateEntry(appId, readmePaths) {
  const issues = []
  for (const readmePath of readmePaths) {
    const content = await fs.readFile(readmePath, 'utf8').catch(() => null)
    if (content === null) {
      issues.push(`${readmePath}: unreadable`)
      continue
    }
    // Complete-ID match: com.example.timer must not be "found" inside the distinct
    // com.example.timer2. Ids are dot/underscore/hyphen separated, so any of those
    // (or a word char) on either side means the match is part of a LONGER id.
    const pattern = new RegExp(`(?<![A-Za-z0-9._-])${appId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9._-])`)
    if (pattern.test(content)) {
      issues.push(`${path.basename(readmePath)}: an existing entry already lists ${appId}`)
    }
  }
  return { ok: issues.length === 0, issues }
}

// argv[1] is a raw filesystem path, import.meta.url a file URL: comparing them
// directly skips the CLI entirely on Windows or in a directory with spaces.
// Normalize the argv side to a URL so the documented `node <script>` invocation
// always enters (and importing the module never does).
const isCliEntry = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (isCliEntry) {
  const args = process.argv.slice(2)
  const take = (flag) => {
    const index = args.indexOf(flag)
    return index >= 0 ? args[index + 1] : undefined
  }
  try {
    const issues = []
    let changedFiles
    const base = take('--base')
    if (base) {
      const repo = take('--repo') ?? process.cwd()
      const { stdout } = await execFileAsync('git', ['diff', '--name-only', `${base}...HEAD`], { cwd: repo })
      changedFiles = stdout.split('\n').filter(Boolean)
    } else {
      const filesIndex = args.indexOf('--files')
      if (filesIndex < 0) {
        console.error('Usage: node scripts/check-directory-submission.mjs --files <changed-file>... | --base <git-ref>')
        process.exit(2)
      }
      // Positional: the file list is the values between --files and the NEXT flag.
      // Filtering by value would silently drop a changed file that happens to equal
      // another flag's value (e.g. README.md repeated under --readmes).
      const rest = args.slice(filesIndex + 1)
      const end = rest.findIndex((a) => a.startsWith('--'))
      changedFiles = end < 0 ? rest : rest.slice(0, end)
    }

    const filesResult = checkSubmissionFiles(changedFiles)
    issues.push(...filesResult.issues)

    const appId = take('--app-id')
    const readmesIndex = args.indexOf('--readmes')
    if (appId && readmesIndex >= 0) {
      const readmes = [args[readmesIndex + 1], args[readmesIndex + 2]].filter(Boolean)
      const dupResult = await checkDuplicateEntry(appId, readmes)
      issues.push(...dupResult.issues)
    }

    if (issues.length > 0) {
      console.error(`directory submission gate failed:\n${issues.map((i) => `  - ${i}`).join('\n')}`)
      process.exit(1)
    }
    process.stdout.write(
      `${JSON.stringify({ ok: true, changedFiles, states: ['published', 'submitted', 'merged'] })}\n`
    )
  } catch (error) {
    console.error(`check-directory-submission.mjs: ${error.message}`)
    process.exit(1)
  }
}
