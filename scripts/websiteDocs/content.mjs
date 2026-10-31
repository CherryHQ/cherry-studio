import { execFileSync, spawnSync } from 'node:child_process'
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

export const repositories = { desktop: 'CherryHQ/cherry-studio', website: 'CherryHQ/cherry-studio-website' }
export const roots = { desktop: 'website-docs', website: 'docs-site' }
export const contentNames = ['content', 'locales.json', 'page-aliases.json', 'shadowed-baseline.json']
export const planPath = '.github/website-docs-sync-plan.json'

export function git(repo, args, input) {
  return execFileSync('git', ['-C', repo, ...args], { input, maxBuffer: 256 * 1024 * 1024 })
}

export function sha(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{40}$/.test(value)) throw new Error('Expected a full Git SHA')
  return value
}

export function scratch() {
  const repo = mkdtempSync(path.join(tmpdir(), 'cherry-website-docs-'))
  git(repo, ['init', '--quiet'])
  return { repo, close: () => rmSync(repo, { recursive: true, force: true }) }
}

export function fetchRevision(repo, remote, revision) {
  git(repo, ['fetch', '--quiet', '--no-tags', '--depth=1', remote, revision])
  return git(repo, ['rev-parse', 'FETCH_HEAD']).toString().trim()
}

export function entries(repo, tree) {
  return git(repo, ['ls-tree', '-rz', sha(tree)])
    .toString()
    .split('\0')
    .filter(Boolean)
    .map((record) => {
      const tab = record.indexOf('\t')
      const [mode, type, oid] = record.slice(0, tab).split(' ')
      const name = record.slice(tab + 1)
      if (type !== 'blob' || mode !== '100644') throw new Error(`Unsupported content type: ${name} (${mode})`)
      return { name, oid, mode }
    })
}

export function contentTree(repo, revision, side) {
  if (!Object.hasOwn(roots, side)) throw new Error('Unknown documentation side')
  const records = contentNames.flatMap((name) => {
    const raw = git(repo, ['ls-tree', '-z', sha(revision), '--', `${roots[side]}/${name}`]).toString()
    if (!raw) return []
    return [raw.slice(0, raw.indexOf('\t') + 1) + name + '\0']
  })
  const tree = git(repo, ['mktree', '-z'], records.join('')).toString().trim()
  const files = entries(repo, tree)
  for (const required of ['content/SUMMARY.md', 'locales.json', 'page-aliases.json']) {
    if (!files.some((file) => file.name === required)) throw new Error(`Missing documentation source: ${required}`)
  }
  return tree
}

export function mergeContent(repo, base, desktop, website) {
  const result = spawnSync(
    'git',
    [
      '-C',
      repo,
      'merge-tree',
      '--write-tree',
      `--merge-base=${sha(base)}`,
      '--name-only',
      '-z',
      '--no-messages',
      '-Xno-renames',
      sha(desktop),
      sha(website)
    ],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
  )
  if (result.error) throw result.error
  if (result.status !== 0 && result.status !== 1) throw new Error(result.stderr || 'Git merge-tree failed')
  const [tree, ...paths] = result.stdout.trimEnd().split('\0')
  return { tree: sha(tree), conflicts: result.status === 1 ? paths.filter(Boolean) : [] }
}

export function changedFiles(repo, before, after) {
  const original = new Map(entries(repo, before).map((file) => [file.name, file.oid]))
  const next = new Map(entries(repo, after).map((file) => [file.name, file.oid]))
  return [...new Set([...original.keys(), ...next.keys()])]
    .sort()
    .filter((name) => original.get(name) !== next.get(name))
    .map((name) => ({ name, oid: next.get(name) ?? null }))
}

export function filesForCommit(repo, changes, side) {
  return {
    additions: changes
      .filter((file) => file.oid)
      .map((file) => ({
        path: `${roots[side]}/${file.name}`,
        contents: git(repo, ['cat-file', 'blob', file.oid]).toString('base64')
      })),
    deletions: changes.filter((file) => !file.oid).map((file) => ({ path: `${roots[side]}/${file.name}` }))
  }
}

export function overlayContent(source, destination) {
  if (!lstatSync(source).isDirectory() || lstatSync(source).isSymbolicLink())
    throw new Error('Content root must be a real directory')
  for (const name of contentNames) {
    const target = path.join(destination, name)
    rmSync(target, { recursive: true, force: true })
    const copy = (from, to) => {
      mkdirSync(to, { recursive: true })
      for (const entry of readdirSync(from, { withFileTypes: true })) {
        const input = path.join(from, entry.name)
        const output = path.join(to, entry.name)
        if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory()))
          throw new Error(`Unsupported content type: ${input}`)
        if (entry.isDirectory()) copy(input, output)
        else writeFileSync(output, readFileSync(input))
      }
    }
    const item = readdirSync(source, { withFileTypes: true }).find((entry) => entry.name === name)
    if (!item) {
      if (name !== 'shadowed-baseline.json') throw new Error(`Missing documentation source: ${name}`)
      continue
    }
    if (item.isDirectory()) copy(path.join(source, name), target)
    else if (item.isFile()) writeFileSync(target, readFileSync(path.join(source, name)))
    else throw new Error(`Unsupported content type: ${name}`)
  }
}

export function validatePlan(plan) {
  if (plan?.version !== 1 || !Object.hasOwn(roots, plan.destination)) throw new Error('Invalid synchronization plan')
  sha(plan.result)
  sha(plan.baseline)
  for (const side of Object.keys(roots)) {
    sha(plan.heads?.[side])
    sha(plan.trees?.[side])
  }
  return plan
}

export function assertCurrentPlan(plan, current) {
  validatePlan(plan)
  for (const side of Object.keys(roots)) {
    if (current[side] !== plan.trees[side] && current[side] !== plan.result)
      throw new Error(`Stale documentation plan: ${side} changed; reconcile again`)
  }
}

export function prAction(pr, trackedHead, resume) {
  if (!pr) return 'create'
  if (pr.state === 'closed' && !pr.merged_at && !resume && !pr.body?.startsWith('Closed by the coordinator:'))
    return 'paused'
  if (pr.state === 'open' && pr.head.sha !== trackedHead) return 'manual'
  return pr.state === 'open' ? 'update' : 'create'
}
