import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { parse } from 'yaml'

// Catch dispatch regressions that run a matrix, drop queued requests, or lose the verdict.
it('dispatches one validated platform and retains the machine-readable verdict and evidence', () => {
  const source = readFileSync(resolve(__dirname, '../../../../.github/workflows/qa-ondemand.yml'), 'utf8')
  const workflow = parse(source)
  expect(workflow.env.TZ).toBe('Asia/Shanghai')
  expect(workflow.on.workflow_dispatch.inputs.profile).toMatchObject({
    options: ['clean', 'authenticated'],
    default: 'clean'
  })
  const run = workflow.jobs.test.steps.find((step: { name?: string }) => step.name === 'Run one test')
  expect(run.env.CHERRY_TEST_CUSTOM_PROVIDER_API_KEY).toBe('${{ secrets.CHERRY_TEST_CUSTOM_PROVIDER_API_KEY }}')
  const preflight = workflow.jobs.resolve.steps.find((step: { id?: string }) => step.id === 'ref')
  expect(preflight.env).toEqual(run.env)
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

it('keeps unrelated workflow diagnostics blocking the CI gate', () => {
  const ci = parse(readFileSync(resolve(__dirname, '../../../../.github/workflows/ci.yml'), 'utf8'))
  const lint = ci.jobs['basic-checks'].steps.find(
    (step: { name?: string }) => step.name === 'Lint GitHub Actions workflows'
  )
  expect(lint.with?.args ?? '').not.toContain('-ignore')
  const config = parse(readFileSync(resolve(__dirname, '../../../../.github/actionlint.yaml'), 'utf8'))
  expect(Object.keys(config.paths)).toEqual(['.github/workflows/qa-ondemand.yml'])
  const filters = config.paths['.github/workflows/qa-ondemand.yml'].ignore
  expect(filters).toHaveLength(1)
  const ignored = new RegExp(filters[0])
  expect('unexpected key "queue" for "concurrency" section. expected one of "cancel-in-progress", "group"').toMatch(
    ignored
  )
  for (const error of [
    'unexpected key "queue_typo" for "concurrency" section. expected one of "cancel-in-progress", "group"',
    'unexpected key "queue" for "job" section. expected one of "runs-on", "steps"',
    'invalid expression in concurrency group'
  ])
    expect(error).not.toMatch(ignored)
})
