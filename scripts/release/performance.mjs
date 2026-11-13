import { summarizeRun } from '../validation/metrics.mjs'

export function summarizeRelease(run, jobs, sourceSha) {
  const buildJobs = jobs.filter(
    ({ name }) => name === 'Prepare release ref' || name.startsWith('Build ') || name === 'Update draft release'
  )
  const draft = buildJobs.find(({ name }) => name === 'Update draft release')
  const summary = summarizeRun(run, buildJobs)
  return {
    ...summary,
    sourceSha,
    workflowSha: run.head_sha,
    draftReadySeconds: draft?.conclusion === 'success' ? summary.elapsedSeconds : null,
    unmeasured: ['native preparation', 'code signing', 'notarization', 'installer generation'],
    artifactSizes: null
  }
}

export function renderReleasePerformance(summary) {
  const duration = (value) => (value === null ? 'unknown' : `${(value / 60).toFixed(2)} min`)
  return [
    '## Release build performance',
    '',
    `Source: ${summary.sourceSha}; workflow: ${summary.workflowSha}; attempt: ${summary.attempt}.`,
    '',
    `Draft readiness: ${duration(summary.draftReadySeconds)}. Runner time: ${duration(summary.runnerSeconds)}.`,
    'Approval waiting, publication, and GitCode sync are excluded. Rerun queue/elapsed times remain unknown.',
    `Unmeasured inside packaging: ${summary.unmeasured.join(', ')}. Artifact sizes: unknown.`,
    '',
    '| Job | Result | Runner labels | Store | Scheduling wait | Execution |',
    '| --- | --- | --- | --- | --- | --- |',
    ...summary.jobs.map(
      (job) =>
        `| ${job.name} | ${job.result ?? 'pending'} | ${job.labels.join(', ')} | ${job.cache} | ${duration(job.schedulingSeconds)} | ${duration(job.seconds)} |`
    ),
    '',
    '| Job / step | Result | Execution |',
    '| --- | --- | --- |',
    ...summary.jobs.flatMap((job) =>
      job.steps.map((step) => `| ${job.name} / ${step.name} | ${step.result} | ${duration(step.seconds)} |`)
    ),
    ''
  ].join('\n')
}
