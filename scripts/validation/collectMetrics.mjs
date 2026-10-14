import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

import { compareRuns, renderReport, summarizeRun } from './metrics.mjs'

const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
const run = event.workflow_run
const repository = process.env.GITHUB_REPOSITORY
const api = (path, paginate = false) =>
  JSON.parse(execFileSync('gh', ['api', ...(paginate ? ['--paginate', '--slurp'] : []), path], { encoding: 'utf8' }))
const summarize = (item) =>
  summarizeRun(
    item,
    api(`repos/${repository}/actions/runs/${item.id}/attempts/${item.run_attempt}/jobs?per_page=100`, true).flatMap(
      (page) => page.jobs
    )
  )
const current = summarize(run)
const history = []
if (current.comparisonKey) {
  const candidates = api(
    `repos/${repository}/actions/workflows/${run.workflow_id}/runs?status=success&event=${encodeURIComponent(run.event)}&per_page=20`
  ).workflow_runs
  for (const candidate of candidates) {
    if (candidate.id !== run.id && Date.parse(candidate.created_at) < Date.parse(run.created_at))
      history.push(summarize(candidate))
  }
}
const baseline = compareRuns(current, history)
const report = renderReport(current, baseline)
mkdirSync('.context/ci-metrics', { recursive: true })
writeFileSync('.context/ci-metrics/report.json', JSON.stringify({ version: 1, current, baseline }, null, 2))
writeFileSync('.context/ci-metrics/report.md', report)
appendFileSync(process.env.GITHUB_STEP_SUMMARY, report)
