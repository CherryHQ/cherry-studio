import { readFileSync } from 'node:fs'
import path from 'node:path'

import { expect, it } from 'vitest'
import { parse } from 'yaml'

const workflow = parse(
  readFileSync(path.resolve(import.meta.dirname, '../../.github/workflows/backport-release-fixes.yml'), 'utf8')
)

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
