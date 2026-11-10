import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { expect, it } from 'vitest'
import { parse } from 'yaml'

const workflow = parse(
  readFileSync(path.resolve(import.meta.dirname, '../../.github/workflows/backport-release-fixes.yml'), 'utf8')
)

it('uses the trusted event checkout for merged fork hotfixes without disabling the fork guard', () => {
  const checkout = workflow.jobs.backport.steps[0]
  expect(workflow.on).toHaveProperty('pull_request_target')
  expect(workflow.jobs.backport.if).toContain("github.event.pull_request.base.ref == 'main'")
  expect(workflow.jobs.backport.if).toContain('github.event.pull_request.merged == true')
  expect(checkout.uses).toBe('actions/checkout@v7')
  expect(checkout.with.ref).toBeUndefined()
  expect(checkout.with.repository).toBeUndefined()
  expect(checkout.with['allow-unsafe-pr-checkout']).not.toBe(true)
  expect(checkout.with['persist-credentials']).toBe(false)
})

it.each([true, false])('only executes backport scripts from the workflow commit (matching: %s)', (matches) => {
  const guard = workflow.jobs.backport.steps[1]
  expect(guard.env?.WORKFLOW_SHA).toBe('${{ github.workflow_sha }}')
  const cwd = path.resolve(import.meta.dirname, '../..')
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim()
  const result = spawnSync('bash', ['-e', '-c', guard.run], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, WORKFLOW_SHA: matches ? sha : '0'.repeat(40) }
  })
  expect(result.status).toBe(matches ? 0 : 1)
  if (!matches) expect(result.stderr).toContain('Checked-out scripts do not match the trusted workflow commit')
})

it('grants the backport token push access to discover drafts and write access to report its result', () => {
  const permissions = workflow.jobs.backport.permissions ?? workflow.permissions
  expect(permissions.contents).toBe('write')
  expect(permissions.issues).toBe('write')
  expect(permissions['pull-requests']).toBe('write')
})

it('keeps classification and backport tracking tokens read-only for repository contents', () => {
  for (const name of ['classify', 'track-backport-pr']) {
    const permissions = workflow.jobs[name].permissions ?? workflow.permissions
    expect(permissions.contents, name).toBe('read')
  }
})

const targetScript = path.resolve(import.meta.dirname, '../release/backport-target.sh')

function resolveTarget(
  branches: string[],
  releases: { tag_name: string; draft: boolean }[],
  command = 'latest_backport_target',
  failReleaseRead = false
) {
  return spawnSync(
    'bash',
    [
      '-e',
      '-o',
      'pipefail',
      '-c',
      `
      gh() {
        case "$*" in
          *matching-refs*) printf '%s\\n' "$REFS" ;;
          *releases*) [ "$FAIL_RELEASE_READ" = false ] && printf '%s\\n' "$RELEASES" ;;
          *) return 1 ;;
        esac
      }
      source "$TARGET_SCRIPT"
      ${command}
      `
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        TARGET_SCRIPT: targetScript,
        REPO: 'CherryHQ/cherry-studio',
        REFS: JSON.stringify([
          branches.map((branch) => ({ ref: `refs/heads/release/${branch}`, object: { sha: branch } }))
        ]),
        RELEASES: JSON.stringify([releases]),
        FAIL_RELEASE_READ: String(failReleaseRead),
        RELEASE_BRANCH: 'release/v2.2.0',
        RELEASE_HEAD: 'v2.2.0'
      }
    }
  )
}

it.each([false, true])('targets the next branch regardless of draft state (%s)', (hasDraft) => {
  const drafts = hasDraft ? [{ tag_name: 'v2.2.0', draft: true }] : []
  const result = resolveTarget(
    ['v2.1.10', 'v2.2.0', 'v2.2.0-rc.10'],
    [{ tag_name: 'v2.1.10', draft: false }, ...drafts]
  )
  expect(result.status).toBe(0)
  expect(result.stdout.trim()).toBe('release/v2.2.0\tv2.2.0')
})

it('orders prerelease numbers numerically and ignores invalid branches', () => {
  const result = resolveTarget(['v2.2.0-rc.10', 'v2.2.0-rc.9', 'v99-experiment'], [])
  expect(result.status).toBe(0)
  expect(result.stdout.trim()).toBe('release/v2.2.0-rc.10\tv2.2.0-rc.10')
})

it('never falls back to an older branch after a version is published', () => {
  const result = resolveTarget(['v2.1.10', 'v2.2.0'], [{ tag_name: 'v2.2.0', draft: false }])
  expect(result.status).toBe(0)
  expect(result.stdout).toBe('')
})

it('does not select an older branch when the published version has no branch', () => {
  const result = resolveTarget(['v2.1.10'], [{ tag_name: 'v2.2.0', draft: false }])
  expect(result.status).toBe(0)
  expect(result.stdout).toBe('')
})

it('reports a release API failure instead of assuming the target is unpublished', () => {
  expect(resolveTarget(['v2.2.0'], [], 'latest_backport_target', true).status).toBe(1)
})

it('rejects a stale selection before writing a backport', () => {
  expect(resolveTarget(['v2.2.0'], [], 'revalidate_backport_target').status).toBe(0)
  expect(resolveTarget(['v2.2.0', 'v2.3.0'], [], 'revalidate_backport_target').status).toBe(1)
  expect(resolveTarget(['v2.2.0'], [], 'RELEASE_HEAD=old revalidate_backport_target').status).toBe(1)
  expect(resolveTarget(['v2.2.0'], [{ tag_name: 'v2.2.0', draft: false }], 'revalidate_backport_target').status).toBe(1)
})
