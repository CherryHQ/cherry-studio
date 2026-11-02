/** Report committed and worktree paths against an explicit Git base. */
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs, TextDecoder } from 'node:util'

const FORMAT_VERSION = 1
const MAX_GIT_OUTPUT = 64 * 1024 * 1024
const UTF8 = new TextDecoder('utf-8', { fatal: true })

function runGitBytes(cwd, args) {
  const result = spawnSync('git', ['-C', cwd, '-c', 'core.fsmonitor=false', ...args], {
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', LANG: 'C', LC_ALL: 'C' },
    maxBuffer: MAX_GIT_OUTPUT
  })
  return { ...result, stdout: result.stdout ?? Buffer.alloc(0), stderr: result.stderr ?? Buffer.alloc(0) }
}

function decode(output, context) {
  try {
    return UTF8.decode(output)
  } catch {
    throw new Error(`${context}: Git output is not valid UTF-8`)
  }
}

function requireGit(cwd, args, context) {
  const result = runGitBytes(cwd, args)
  if (result.status !== 0) {
    const detail = result.error?.message ?? decode(result.stderr, context).trim() ?? `status ${String(result.status)}`
    throw new Error(`${context}: ${detail}`)
  }
  return result.stdout
}

function parsePathSet(output, context) {
  const paths = []
  let start = 0
  for (let end = 0; end < output.length; end += 1) {
    if (output[end] !== 0) continue
    if (end > start) {
      try {
        paths.push(UTF8.decode(output.subarray(start, end)))
      } catch {
        throw new Error(`${context}: Git path is not valid UTF-8`)
      }
    }
    start = end + 1
  }
  return [...new Set(paths)].sort()
}

function resolveCommit(root, label, ref) {
  const output = decode(
    requireGit(
      root,
      ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`],
      `cannot resolve ${label} ${JSON.stringify(ref)}`
    ),
    `cannot resolve ${label}`
  ).trim()
  if (!/^[0-9a-f]{40}$/u.test(output)) throw new Error(`${label} ${JSON.stringify(ref)} did not resolve to one commit`)
  return output
}

function diffPaths(root, args, context) {
  return parsePathSet(
    requireGit(
      root,
      [
        'diff',
        '--no-ext-diff',
        '--no-textconv',
        '--no-renames',
        '--ignore-submodules=none',
        '--name-only',
        '-z',
        ...args,
        '--'
      ],
      context
    ),
    context
  )
}

export function collectChangeScope({ base, head = 'HEAD' }, cwd = process.cwd()) {
  if (!base) throw new Error('missing required --base <ref>')
  const root = decode(
    requireGit(cwd, ['rev-parse', '--show-toplevel'], 'cannot locate a Git worktree'),
    'repository root'
  ).trim()
  const baseSha = resolveCommit(root, 'base', base)
  const headSha = resolveCommit(root, 'head', head)
  const mergeBases = decode(
    requireGit(root, ['merge-base', '--all', baseSha, headSha], 'cannot resolve merge base'),
    'merge base'
  )
    .trim()
    .split(/\r?\n/u)
    .filter(Boolean)
  if (mergeBases.length !== 1)
    throw new Error(`base and head do not have a unique merge base; found ${mergeBases.length}`)
  const mergeBaseSha = mergeBases[0]

  return {
    formatVersion: FORMAT_VERSION,
    repositoryRoot: root,
    input: { base, head },
    resolved: { baseSha, headSha, mergeBaseSha },
    paths: {
      committed: diffPaths(root, [mergeBaseSha, headSha], 'cannot inspect committed paths'),
      staged: diffPaths(root, ['--cached'], 'cannot inspect staged paths'),
      unstaged: diffPaths(root, [], 'cannot inspect unstaged paths'),
      untracked: parsePathSet(
        requireGit(root, ['ls-files', '--others', '--exclude-standard', '-z', '--'], 'cannot inspect untracked paths'),
        'cannot inspect untracked paths'
      )
    }
  }
}

export function renderChangeScope(args, cwd = process.cwd()) {
  const { values } = parseArgs({
    args,
    allowPositionals: false,
    strict: true,
    options: {
      base: { type: 'string' },
      head: { type: 'string', default: 'HEAD' }
    }
  })
  return `${JSON.stringify(collectChangeScope({ base: values.base, head: values.head }, cwd), null, 2)}\n`
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(renderChangeScope(process.argv.slice(2)))
  } catch (error) {
    process.stderr.write(`change:scope: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
