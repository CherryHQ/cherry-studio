import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { parse } from 'yaml'

// Catch dispatch regressions that run a matrix, drop queued requests, or lose the verdict.
it('dispatches one validated platform and retains the machine-readable verdict and evidence', () => {
  const source = readFileSync(resolve(__dirname, '../../../../.github/workflows/qa-ondemand.yml'), 'utf8')
  const workflow = parse(source)
  expect(Object.keys(workflow.on.workflow_dispatch.inputs)).toHaveLength(6)
  expect(workflow.jobs.test.strategy).toBeUndefined()
  expect(workflow.jobs.test['runs-on']).toBe('${{ needs.resolve.outputs.runner }}')
  expect(workflow.jobs.test.concurrency).toMatchObject({ 'cancel-in-progress': false, queue: 'max' })
  const upload = workflow.jobs.test.steps.find((step: { name?: string }) => step.name === 'Upload evidence')
  expect(upload.with['retention-days']).toBe(30)
  expect(upload.with.name).toContain('short_sha')
  expect(workflow.jobs.test.steps.at(-1).run).toContain('r.exitCode')
  expect(source).not.toContain('inputs.plan }}\n        run:')
  expect(source).not.toContain('run-phase')
  expect(source).not.toContain('startup-smoke')
})
