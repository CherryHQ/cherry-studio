#!/usr/bin/env node
/**
 * Review-first automation: Codex reviews current git diff, then Claude fixes if FAIL;
 * repeat until PASS or --max-rounds reviews.
 *
 * Requires: `claude` (Claude Code CLI with -p) and `codex` (codex exec) on PATH,
 * or override with --claude-bin / --codex-bin or REVIEW_LOOP_CLAUDE_BIN / REVIEW_LOOP_CODEX_BIN.
 *
 * Usage:
 *   node scripts/dev/claude-codex-review-loop.mjs
 *   pnpm review-loop -- --base upstream --diff-mode full
 *   pnpm review-loop -- --task-file ./context.md --base origin/main --diff-mode commits
 */

import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'

const CODEX_REVIEW_PREAMBLE = `You are a code reviewer. Read the git diff below. Your reply MUST use this exact structure:

## BLOCKING
- List every MUST-fix issue with file path and brief reason. If there are none, write exactly: - none

## NON_BLOCKING
- Optional suggestions (or - none)

## SUMMARY
One line describing overall quality.

Finally on its own line:
VERDICT: PASS
or
VERDICT: FAIL

Rules: If any real BLOCKING issue exists (not "- none"), VERDICT must be FAIL.

--- GIT DIFF ---

`

function printHelp() {
  console.log(`claude-codex-review-loop.mjs

Each cycle: git diff → Codex review → if FAIL and rounds remain → Claude fix → repeat.
If the first review is PASS, Claude is not run.

Default scope: current branch vs its upstream (git diff @{upstream}...HEAD) plus any
uncommitted changes (git diff HEAD). No git add/commit unless you pass --commit.

Options:
  --repo <dir>           Repository root (default: cwd)
  --task-file <path>     Optional context for Claude when fixing (spec / intent)
  --base <ref>           Three-dot left side: upstream (default) | any ref e.g. origin/main
                         upstream: uses @{upstream} (set with git branch -u)
  --diff-mode <mode>     full | commits | working (default: full)
                         full: branch commits vs base + uncommitted (git diff HEAD)
                         commits: only base...HEAD
                         working: only git diff HEAD
  --max-rounds <n>       Max Codex review runs (default: 4)
  --timeout-ms <n>       Per CLI invocation timeout in ms (0 = none, default: 0)
  --dry-run              Print planned steps only
  --commit               After each Claude fix, git add -A && commit (off by default)
  --verify <cmd>         Shell command to run after PASS (e.g. pnpm exec biome check)
  --lenient              If no VERDICT/BLOCKING parseable, treat as PASS (risky)
  --skip-permissions     Pass --dangerously-skip-permissions to claude (trusted repos only)
  --max-turns <n>        Claude -p max turns (default: 15)
  --claude-bin <path>    Claude executable (env: REVIEW_LOOP_CLAUDE_BIN)
  --codex-bin <path>     Codex executable (env: REVIEW_LOOP_CODEX_BIN)
  --help                 This text

Environment:
  REVIEW_LOOP_CLAUDE_BIN, REVIEW_LOOP_CODEX_BIN
`)
}

function runSpawn(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: options.stdio ?? ['ignore', 'pipe', 'pipe']
    })
    const chunksOut = []
    const chunksErr = []
    if (child.stdout) {
      child.stdout.on('data', (c) => chunksOut.push(c))
    }
    if (child.stderr) {
      child.stderr.on('data', (c) => chunksErr.push(c))
    }
    let finished = false
    const timer =
      options.timeoutMs > 0
        ? setTimeout(() => {
            if (!finished) {
              child.kill('SIGTERM')
              reject(new Error(`Timeout after ${options.timeoutMs}ms: ${command} ${args.join(' ')}`))
            }
          }, options.timeoutMs)
        : null
    child.on('error', (err) => {
      finished = true
      if (timer) clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code, signal) => {
      finished = true
      if (timer) clearTimeout(timer)
      resolve({
        code: code ?? (signal ? 1 : 0),
        stdout: Buffer.concat(chunksOut).toString('utf8'),
        stderr: Buffer.concat(chunksErr).toString('utf8')
      })
    })
    if (options.stdinText != null && child.stdin) {
      child.stdin.write(options.stdinText, 'utf8')
      child.stdin.end()
    }
  })
}

function runExecFile(command, args, cwd) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(
          Object.assign(err, {
            stdout,
            stderr
          })
        )
        return
      }
      resolve({ stdout: stdout ?? '', stderr: stderr ?? '' })
    })
  })
}

async function assertUpstreamExists(repoRoot) {
  const res = await runSpawn('git', ['rev-parse', '--symbolic-full-name', '@{upstream}'], {
    cwd: repoRoot,
    timeoutMs: 0
  })
  if (res.code !== 0) {
    throw new Error(
      'No upstream for the current branch. Run: git branch -u origin/<branch>\n' +
        `git said: ${(res.stderr || '').trim() || res.stdout}`
    )
  }
}

/**
 * @param {'full' | 'commits' | 'working'} diffMode
 * @param {string} baseRef logical base: "upstream" or any git ref
 */
async function gitDiffForReview(repoRoot, baseRef, diffMode) {
  if (diffMode === 'working') {
    const res = await runSpawn('git', ['-c', 'core.quotepath=false', 'diff', 'HEAD'], {
      cwd: repoRoot,
      timeoutMs: 0
    })
    if (res.code !== 0) {
      throw new Error(`git diff HEAD failed: ${res.stderr || res.stdout}`)
    }
    return res.stdout
  }

  let tripleDotLeft = baseRef
  if (baseRef === 'upstream') {
    await assertUpstreamExists(repoRoot)
    tripleDotLeft = '@{upstream}'
  }

  const committed = await runSpawn('git', ['-c', 'core.quotepath=false', 'diff', `${tripleDotLeft}...HEAD`], {
    cwd: repoRoot,
    timeoutMs: 0
  })
  if (committed.code === 128) {
    throw new Error(`git diff ${tripleDotLeft}...HEAD failed. Check --base / upstream. ${committed.stderr || ''}`)
  }
  if (committed.code !== 0) {
    throw new Error(`git diff exited ${committed.code}: ${committed.stderr || committed.stdout}`)
  }

  if (diffMode === 'commits') {
    return committed.stdout
  }

  const working = await runSpawn('git', ['-c', 'core.quotepath=false', 'diff', 'HEAD'], {
    cwd: repoRoot,
    timeoutMs: 0
  })
  if (working.code !== 0) {
    throw new Error(`git diff HEAD failed: ${working.stderr || working.stdout}`)
  }

  return [
    '=== Committed on this branch (three-dot vs base) ===',
    committed.stdout || '(empty)',
    '',
    '=== Uncommitted changes (git diff HEAD; leave fixes unstaged — no commit in this loop) ===',
    working.stdout || '(empty)',
    ''
  ].join('\n')
}

function hashDiff(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16)
}

/**
 * @returns {{ pass: boolean, blockingBody: string, verdict: 'PASS' | 'FAIL' | 'UNKNOWN' }}
 */
function parseReviewResult(text, lenient) {
  const verdictMatch = text.match(/^VERDICT:\s*(PASS|FAIL)\s*$/im)
  const verdict = verdictMatch ? /** @type {'PASS' | 'FAIL'} */ (verdictMatch[1].toUpperCase()) : 'UNKNOWN'

  const blockingMatch = text.match(/##\s*BLOCKING\s*\n([\s\S]*?)(?=\n##\s|$)/i)
  let blockingBody = ''
  if (blockingMatch) {
    blockingBody = blockingMatch[1].trim()
  }

  const blockingIsEmpty =
    !blockingBody || /^-\s*none\s*$/im.test(blockingBody) || /^no\s+blocking\b/im.test(blockingBody)

  if (verdict === 'PASS') {
    return { pass: true, blockingBody, verdict }
  }
  if (verdict === 'FAIL') {
    return { pass: false, blockingBody, verdict }
  }

  if (!blockingMatch) {
    return lenient
      ? { pass: true, blockingBody: '', verdict: 'UNKNOWN' }
      : { pass: false, blockingBody: '', verdict: 'UNKNOWN' }
  }

  if (blockingIsEmpty) {
    return { pass: true, blockingBody, verdict: 'UNKNOWN' }
  }
  return { pass: false, blockingBody, verdict: 'UNKNOWN' }
}

async function runClaudeRound({ repoRoot, prompt, claudeBin, dryRun, timeoutMs, skipPermissions, maxTurns }) {
  const args = ['--max-turns', String(maxTurns)]
  if (skipPermissions) {
    args.push('--dangerously-skip-permissions')
  }
  args.push('-p', prompt)

  if (dryRun) {
    console.log(`[dry-run] ${claudeBin} ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`)
    return { code: 0, stdout: '', stderr: '' }
  }

  const res = await runSpawn(claudeBin, args, { cwd: repoRoot, timeoutMs })
  if (res.stderr) {
    process.stderr.write(res.stderr)
  }
  if (res.stdout) {
    process.stdout.write(res.stdout)
  }
  if (res.code !== 0) {
    throw new Error(`Claude exited with code ${res.code}`)
  }
  return res
}

async function runCodexReview({ repoRoot, fullPrompt, codexBin, outFile, dryRun, timeoutMs }) {
  const args = ['exec', '--full-auto', '--output-last-message', outFile, '-']

  if (dryRun) {
    console.log(`[dry-run] ${codexBin} ${args.join(' ')} <<PROMPT (${fullPrompt.length} chars)>>`)
    writeFileSync(outFile, 'VERDICT: PASS\n', 'utf8')
    return { code: 0, stdout: '', stderr: '', combinedText: 'VERDICT: PASS\n' }
  }

  const res = await runSpawn(codexBin, args, {
    cwd: repoRoot,
    timeoutMs,
    stdio: ['pipe', 'pipe', 'pipe'],
    stdinText: fullPrompt
  })
  if (res.stderr) {
    process.stderr.write(res.stderr)
  }
  let text = ''
  try {
    text = readFileSync(outFile, 'utf8')
  } catch {
    text = res.stdout
  }
  if (res.stdout && !text) {
    text = res.stdout
  }
  if (res.code !== 0) {
    throw new Error(`Codex exited with code ${res.code}\n${res.stderr}`)
  }
  return { ...res, combinedText: text }
}

async function maybeCommit(repoRoot, message, dryRun) {
  if (dryRun) {
    console.log(`[dry-run] git commit -m ${JSON.stringify(message)}`)
    return
  }
  const status = await runExecFile('git', ['status', '--porcelain'], repoRoot)
  if (!status.stdout.trim()) {
    return
  }
  await runExecFile('git', ['add', '-A'], repoRoot)
  try {
    await runExecFile('git', ['commit', '-m', message], repoRoot)
  } catch (e) {
    if (/nothing to commit/i.test(String(e.stderr || ''))) {
      return
    }
    throw e
  }
}

async function runVerify(command, repoRoot, dryRun) {
  if (!command) {
    return
  }
  if (dryRun) {
    console.log(`[dry-run] verify: ${command}`)
    return
  }
  await new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd: repoRoot,
      shell: true,
      stdio: 'inherit'
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`Verify command failed with code ${code}`))
      }
    })
  })
}

async function main() {
  const raw = process.argv.slice(2)
  if (raw.includes('--help') || raw.includes('-h')) {
    printHelp()
    process.exit(0)
  }

  let values
  try {
    ;({ values } = parseArgs({
      args: raw,
      options: {
        repo: { type: 'string', default: process.cwd() },
        'task-file': { type: 'string' },
        base: { type: 'string', default: 'upstream' },
        'diff-mode': { type: 'string', default: 'full' },
        'max-rounds': { type: 'string', default: '4' },
        'timeout-ms': { type: 'string', default: '0' },
        'dry-run': { type: 'boolean', default: false },
        commit: { type: 'boolean', default: false },
        verify: { type: 'string' },
        lenient: { type: 'boolean', default: false },
        'skip-permissions': { type: 'boolean', default: false },
        'max-turns': { type: 'string', default: '15' },
        'claude-bin': { type: 'string' },
        'codex-bin': { type: 'string' }
      }
    }))
  } catch (e) {
    console.error(e.message)
    printHelp()
    process.exit(1)
  }

  const repoRoot = path.resolve(values.repo)
  const taskFile = values['task-file']
  let baseTask = ''
  if (taskFile) {
    const taskPath = path.isAbsolute(taskFile) ? taskFile : path.join(repoRoot, taskFile)
    baseTask = readFileSync(taskPath, 'utf8')
  }

  const maxRounds = Math.max(1, Number.parseInt(values['max-rounds'], 10) || 4)
  const timeoutMs = Math.max(0, Number.parseInt(values['timeout-ms'], 10) || 0)
  const maxTurns = Math.max(1, Number.parseInt(values['max-turns'], 10) || 15)
  const dm = values['diff-mode']
  const diffMode = dm === 'working' ? 'working' : dm === 'commits' || dm === 'range' ? 'commits' : 'full'
  const dryRun = values['dry-run']
  const lenient = values.lenient
  const claudeBin = values['claude-bin'] || process.env.REVIEW_LOOP_CLAUDE_BIN || 'claude'
  const codexBin = values['codex-bin'] || process.env.REVIEW_LOOP_CODEX_BIN || 'codex'

  const artifactDir = path.join(repoRoot, '.review-loop')
  mkdirSync(artifactDir, { recursive: true })

  for (let round = 1; round <= maxRounds; round++) {
    console.log(`\n--- Review ${round} / ${maxRounds} ---\n`)

    const diffText = await gitDiffForReview(repoRoot, values.base, diffMode)
    const diffHashBefore = hashDiff(diffText)

    const reviewLogPath = path.join(artifactDir, `codex-review-${round}.log`)
    const codexOutFile = path.join(artifactDir, `codex-last-message-${round}.txt`)
    try {
      rmSync(codexOutFile, { force: true })
    } catch {
      /* ignore */
    }

    const fullCodexPrompt = `${CODEX_REVIEW_PREAMBLE}${diffText || '(empty diff)'}\n`

    const codexRes = await runCodexReview({
      repoRoot,
      fullPrompt: fullCodexPrompt,
      codexBin,
      outFile: codexOutFile,
      dryRun,
      timeoutMs
    })

    const reviewText = codexRes.combinedText || ''
    writeFileSync(reviewLogPath, `--- PROMPT ---\n${fullCodexPrompt}\n--- RESPONSE ---\n${reviewText}\n`, 'utf8')

    const parsed = parseReviewResult(reviewText, lenient)
    const blockingPath = path.join(artifactDir, 'REVIEW_BLOCKING.md')
    writeFileSync(
      blockingPath,
      parsed.blockingBody ? `## BLOCKING\n${parsed.blockingBody}\n` : '## BLOCKING\n- (see full log)\n',
      'utf8'
    )

    console.log(`\n[parse] verdict=${parsed.verdict} pass=${parsed.pass}\n`)

    if (parsed.pass) {
      await runVerify(values.verify, repoRoot, dryRun)
      console.log('Review automation completed: PASS')
      process.exit(0)
    }

    if (round === maxRounds) {
      console.error(`Exhausted ${maxRounds} review(s); last verdict=${parsed.verdict}`)
      process.exit(1)
    }

    const taskBlock = baseTask ? `Context (optional):\n${baseTask}\n\n` : ''
    const claudePrompt = `${taskBlock}Repository: ${repoRoot}\n\nCodex code review reported issues. Address BLOCKING items only; minimal focused changes.\nDo not run git add, git commit, or git stash; leave all edits unstaged in the working tree.\n\nFull review output:\n${reviewText}\n`

    console.log(`\n--- Fix after review ${round} (Claude) ---\n`)

    await runClaudeRound({
      repoRoot,
      prompt: claudePrompt,
      claudeBin,
      dryRun,
      timeoutMs,
      skipPermissions: values['skip-permissions'],
      maxTurns
    })

    if (values.commit) {
      await maybeCommit(repoRoot, `fix: address codex review (review ${round})`, dryRun)
    }

    if (!dryRun) {
      const diffAfter = await gitDiffForReview(repoRoot, values.base, diffMode)
      if (hashDiff(diffAfter) === diffHashBefore) {
        console.error('Git diff unchanged after Claude fix; stopping to avoid a loop.')
        process.exit(1)
      }
    }
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
