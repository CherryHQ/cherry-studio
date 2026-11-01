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
