import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const workflow = parse(
  readFileSync(path.resolve(import.meta.dirname, '../../.github/workflows/release-packages.yml'), 'utf8')
)
const steps = workflow.jobs.release.steps
let root: string
let remote: string
let checkout: string

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function commit(message: string) {
  git(remote, 'add', '.')
  git(
    remote,
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.com',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-m',
    message
  )
}

function checkFreshness() {
  const guard = steps.find((step: { id?: string }) => step.id === 'release-head')
  expect(guard, 'the release action must check the live main ref').toBeDefined()
  const output = path.join(root, 'output')
  writeFileSync(output, '')
  const result = spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', guard.run], {
    cwd: checkout,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_OUTPUT: output }
  })
  return { ...result, output: readFileSync(output, 'utf8') }
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'package-release-freshness-'))
  remote = path.join(root, 'remote')
  checkout = path.join(root, 'checkout')
  mkdirSync(remote)
  git(remote, 'init', '-b', 'main')
  mkdirSync(path.join(remote, '.changeset'))
  writeFileSync(path.join(remote, '.changeset/fix.md'), '---\n"fixture": patch\n---\n\nFix.\n')
  writeFileSync(path.join(remote, 'package.json'), '{"name":"fixture","version":"1.0.0"}')
  commit('Add package fix')
  git(root, 'clone', remote, checkout)
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('package release freshness', () => {
  it('allows versioning or publishing from the current main commit', () => {
    const result = checkFreshness()
    expect(result.status).toBe(0)
    expect(result.output).toBe('current=true\n')
  })

  it('skips a queued run after another version PR consumes its changeset', () => {
    rmSync(path.join(remote, '.changeset/fix.md'))
    writeFileSync(path.join(remote, 'package.json'), '{"name":"fixture","version":"1.0.1"}')
    commit('Merge version PR')

    const stale = checkFreshness()
    expect(stale.status).toBe(0)
    expect(stale.output).toBe('current=false\n')
    expect(readFileSync(path.join(checkout, 'package.json'), 'utf8')).toContain('1.0.0')

    git(checkout, 'fetch', 'origin', 'main')
    git(checkout, 'reset', '--hard', 'origin/main')
    const nextRun = checkFreshness()
    expect(nextRun.status).toBe(0)
    expect(nextRun.output).toBe('current=true\n')
  })

  it('fails closed when the remote cannot be read', () => {
    git(checkout, 'remote', 'set-url', 'origin', path.join(root, 'missing'))
    const result = checkFreshness()
    expect(result.status).not.toBe(0)
    expect(result.output).not.toContain('current=true')
  })

  it('fails closed when the remote main branch is missing', () => {
    git(remote, 'branch', '-m', 'other')
    const result = checkFreshness()
    expect(result.status).not.toBe(0)
    expect(result.output).not.toContain('current=true')
  })

  it('gates the action immediately before mutation without cancelling npm publication', () => {
    const actionIndex = steps.findIndex((step: { id?: string }) => step.id === 'changesets')
    expect(steps[actionIndex - 1].id).toBe('release-head')
    expect(steps[actionIndex].if).toBe("steps.release-head.outputs.current == 'true'")
    const checkoutStep = steps.find((step: { uses?: string }) => step.uses?.startsWith('actions/checkout@'))
    expect(checkoutStep.with.ref).toBe('${{ github.sha }}')
    expect(workflow.concurrency).toEqual({
      group: '${{ github.workflow }}-${{ github.ref }}',
      'cancel-in-progress': false
    })
  })
})
