const seconds = (start, end) => {
  const value = (Date.parse(end) - Date.parse(start)) / 1000
  return Number.isFinite(value) && value >= 0 ? value : null
}

export function summarizeRun(run, jobs) {
  const active = jobs.filter((job) => job.conclusion !== 'skipped')
  const scope = jobs.flatMap((job) => job.steps ?? []).find((step) => step.name.startsWith('Validation scope: '))?.name
  const measured = active
    .map((job) => ({
      name: job.name,
      result: job.conclusion,
      labels: [...(job.labels ?? [])].sort(),
      seconds: seconds(job.started_at, job.completed_at),
      cache:
        job.steps?.find((step) => step.name.startsWith('Dependency cache: '))?.name.slice(18) ??
        (job.steps?.some((step) => /pnpm|dependencies|setup-validation|cache/i.test(step.name))
          ? 'unknown'
          : 'not-used'),
      steps: (job.steps ?? [])
        .filter((step) => step.conclusion !== 'skipped')
        .map((step) => ({
          name: step.name,
          result: step.conclusion,
          seconds: seconds(step.started_at, step.completed_at)
        }))
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const starts = active.map((job) => Date.parse(job.started_at))
  const ends = active.map((job) => Date.parse(job.completed_at))
  const complete = measured.length > 0 && measured.every((job) => job.seconds !== null)
  const firstStart = complete ? new Date(Math.min(...starts)).toISOString() : null
  const lastEnd = complete ? new Date(Math.max(...ends)).toISOString() : null
  return {
    id: run.id,
    attempt: run.run_attempt,
    sha: run.head_sha,
    url: run.html_url,
    event: run.event,
    conclusion: run.conclusion,
    scope: scope?.slice(18) ?? null,
    queueSeconds: run.run_attempt === 1 && firstStart ? seconds(run.created_at, firstStart) : null,
    executionSeconds: complete ? seconds(firstStart, lastEnd) : null,
    elapsedSeconds: run.run_attempt === 1 && complete ? seconds(run.created_at, lastEnd) : null,
    runnerSeconds: complete ? measured.reduce((sum, job) => sum + job.seconds, 0) : null,
    comparisonKey:
      complete && scope && measured.every((job) => ['exact-hit', 'not-used'].includes(job.cache))
        ? JSON.stringify([run.event, scope, measured.map(({ name, labels, cache }) => [name, labels, cache])])
        : null,
    jobs: measured
  }
}

export function compareRuns(current, history) {
  const comparable = history.filter(
    (run) =>
      current.comparisonKey &&
      run.comparisonKey === current.comparisonKey &&
      run.conclusion === 'success' &&
      run.id !== current.id
  )
  const percentile = (values, fraction) =>
    [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1] ?? null
  return {
    samples: comparable.length,
    executionP50: percentile(
      comparable.map((run) => run.executionSeconds),
      0.5
    ),
    executionP90: percentile(
      comparable.map((run) => run.executionSeconds),
      0.9
    ),
    runnerP50: percentile(
      comparable.map((run) => run.runnerSeconds),
      0.5
    ),
    runIds: comparable.map((run) => run.id)
  }
}

export function renderReport(current, baseline) {
  const duration = (value) => (value === null ? 'Unavailable' : `${value.toFixed(1)} s`)
  const escape = (value) => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ').replaceAll('<', '&lt;')
  return [
    '# CI performance observation',
    '',
    `Run ${current.id}, attempt ${current.attempt}; result: ${current.conclusion}.`,
    '',
    '| Metric | Current | Comparable baseline |',
    '| --- | ---: | ---: |',
    `| Initial queue | ${duration(current.queueSeconds)} | — |`,
    `| Execution wall time | ${duration(current.executionSeconds)} | P50 ${duration(baseline.executionP50)} / P90 ${duration(baseline.executionP90)} |`,
    `| Total elapsed | ${duration(current.elapsedSeconds)} | — |`,
    `| Sum of runner time | ${duration(current.runnerSeconds)} | P50 ${duration(baseline.runnerP50)} |`,
    '',
    `Baseline: ${baseline.samples} successful runs with matching scope, event, job names, runner labels and known cache state.`,
    'No performance threshold blocks CI. Runner time is elapsed job time, not billed minutes. Initial queue excludes later job scheduling waits. Queue and total elapsed are unavailable for reruns because creation time belongs to the original attempt.',
    '',
    '| Job | Result | Cache | Duration |',
    '| --- | --- | --- | ---: |',
    ...current.jobs.map((job) => `| ${escape(job.name)} | ${job.result} | ${job.cache} | ${duration(job.seconds)} |`),
    '',
    'The JSON artifact retains per-step durations and baseline run IDs. Cancelled/failed runs are reported but never used as successful baselines.',
    ''
  ].join('\n')
}
