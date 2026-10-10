import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const workflow = parse(readFileSync(path.resolve(import.meta.dirname, '../../.github/workflows/release.yml'), 'utf8'))

describe('release publication credentials', () => {
  it.each(['Verify draft matches approved archive', 'Validate and publish current draft'])(
    'uses the publishing PAT to access draft releases in %s',
    (name) => {
      const step = workflow.jobs.publish.steps.find((step: { name: string }) => step.name === name)

      expect(step?.env.GH_TOKEN).toBe('${{ secrets.TOKEN_GITHUB_WRITE }}')
    }
  )

  it('keeps the workflow and publishing job built-in token read-only', () => {
    expect(workflow.permissions.contents).toBe('read')
    expect(workflow.jobs.publish.permissions?.contents ?? workflow.permissions.contents).toBe('read')
  })
})
