const timestamp = (value) => (typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null)
const seconds = (start, end) => {
  if (!timestamp(start) || !timestamp(end)) return null
  const value = (Date.parse(end) - Date.parse(start)) / 1000
  return Number.isFinite(value) && value >= 0 ? value : null
}
const percentile = (values, fraction) =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1] ?? null
const distribution = (values) => {
  const known = values.filter(Number.isFinite)
  return {
    samples: known.length,
    p50: percentile(known, 0.5),
    p90: percentile(known, 0.9),
    max: known.length ? Math.max(...known) : null
  }
}

export function summarizeRun(run, jobs) {
  const active = jobs.filter((job) => job.conclusion !== 'skipped')
  const scope = jobs.flatMap((job) => job.steps ?? []).find((step) => step.name.startsWith('Validation scope: '))?.name
  const measured = active
    .map((job) => {
      const allocated = job.runner_id > 0 || (job.steps ?? []).some((step) => timestamp(step.started_at))
      const ordered =
        (!timestamp(run.created_at) || seconds(run.created_at, job.created_at) !== null) &&
        seconds(job.created_at, job.started_at) !== null
      const waitsKnown = run.run_attempt === 1 && allocated && ordered
      return {
        name: job.name,
        result: job.conclusion,
        labels: [...(job.labels ?? [])].sort(),
        createdAt: timestamp(job.created_at),
        startedAt: timestamp(job.started_at),
        completedAt: timestamp(job.completed_at),
        beforeCreationSeconds: waitsKnown ? seconds(run.created_at, job.created_at) : null,
        schedulingSeconds: waitsKnown ? seconds(job.created_at, job.started_at) : null,
        seconds: allocated ? seconds(job.started_at, job.completed_at) : null,
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
      }
    })
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
    jobTimings: {
      beforeCreation: distribution(measured.map((job) => job.beforeCreationSeconds)),
      scheduling: distribution(measured.map((job) => job.schedulingSeconds)),
      execution: distribution(measured.map((job) => job.seconds))
    },
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
  const duration = (value) => (Number.isFinite(value) ? `${value.toFixed(1)} s` : 'Unavailable')
  const escape = (value) => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ').replaceAll('<', '&lt;')
  const time = (value) => (timestamp(value) ? escape(value) : 'Unavailable')
  return [
    '# CI performance observation',
    '',
    `Run ${current.id}, attempt ${current.attempt}; result: ${current.conclusion}.`,
    '',
    '| Metric | Current | Comparable baseline |',
    '| --- | ---: | ---: |',
    `| Initial queue (run created → first start) | ${duration(current.queueSeconds)} | — |`,
    `| Execution window (first start → last end) | ${duration(current.executionSeconds)} | P50 ${duration(baseline.executionP50)} / P90 ${duration(baseline.executionP90)} |`,
    `| Total elapsed | ${duration(current.elapsedSeconds)} | — |`,
    `| Sum of runner time | ${duration(current.runnerSeconds)} | P50 ${duration(baseline.runnerP50)} |`,
    '',
    `Baseline: ${baseline.samples} successful runs with matching scope, event, job names, runner labels and known cache state.`,
    'No performance threshold blocks CI. Runner time is elapsed job time, not billed minutes. The execution window includes later scheduling waits; it is not pure execution. Initial queue excludes later job scheduling waits. Wait and total elapsed metrics are unavailable for reruns because timestamps may belong to different attempts.',
    '',
    '| Per-job interval | Samples / jobs | P50 | P90 | Max |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...[
      ['Before creation (run created → job created)', 'beforeCreation'],
      ['Scheduling wait (job created → started)', 'scheduling'],
      ['Execution (job started → completed)', 'execution']
    ].map(([label, key]) => {
      const values = current.jobTimings?.[key] ?? distribution([])
      return `| ${label} | ${values.samples}/${current.jobs.length} | ${duration(values.p50)} | ${duration(values.p90)} | ${duration(values.max)} |`
    }),
    '',
    'Before creation includes upstream dependencies and orchestration; it is not an isolated dependency wait. Scheduling wait is the observed created-to-start interval, not a diagnosis of runner capacity. No critical path is inferred without the measured workflow dependency graph. Parallel waits must not be summed as wall time.',
    '',
    '| Job | Result | Cache | Before creation | Scheduling wait | Execution |',
    '| --- | --- | --- | ---: | ---: | ---: |',
    ...current.jobs.map(
      (job) =>
        `| ${escape(job.name)} | ${job.result} | ${job.cache} | ${duration(job.beforeCreationSeconds)} | ${duration(job.schedulingSeconds)} | ${duration(job.seconds)} |`
    ),
    '',
    '<details><summary>Job timestamps (UTC)</summary>',
    '',
    '| Job | Created | Started | Completed |',
    '| --- | --- | --- | --- |',
    ...current.jobs.map(
      (job) => `| ${escape(job.name)} | ${time(job.createdAt)} | ${time(job.startedAt)} | ${time(job.completedAt)} |`
    ),
    '',
    '</details>',
    '',
    'The JSON artifact retains per-step durations and baseline run IDs. Cancelled/failed runs are reported but never used as successful baselines.',
    ''
  ].join('\n')
}
