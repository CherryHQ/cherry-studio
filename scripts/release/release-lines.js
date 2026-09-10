const LINE_PATTERN = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.x$/

function parseReleaseLine(line) {
  const match = typeof line === 'string' && LINE_PATTERN.exec(line)
  if (!match) throw new Error(`Invalid release line: ${line}`)
  return [BigInt(match[1]), BigInt(match[2])]
}

function compareLines(left, right) {
  const a = parseReleaseLine(left)
  const b = parseReleaseLine(right)
  return a[0] === b[0] ? a[1] > b[1] : a[0] > b[0]
}

function validateReleaseLines(config) {
  if (!config || !['exact-version', 'minor-line'].includes(config.mode)) {
    throw new Error('Release mode must be exact-version or minor-line')
  }
  const lines = [config.current, config.previous, config.candidate].filter((line) => line !== null)
  lines.forEach(parseReleaseLine)
  if (new Set(lines).size !== lines.length) throw new Error('Release lines must be distinct')
  if (config.mode === 'minor-line' && !config.current) throw new Error('Minor-line mode requires a current line')
  if (config.previous && (!config.current || !compareLines(config.current, config.previous))) {
    throw new Error('Previous line must precede current')
  }
  if (config.candidate && (!config.current || !compareLines(config.candidate, config.current))) {
    throw new Error('Candidate line must follow current')
  }
  return config
}

function requireSupportedLine(config, line) {
  validateReleaseLines(config)
  parseReleaseLine(line)
  if (config.mode !== 'minor-line' || ![config.current, config.previous, config.candidate].includes(line)) {
    throw new Error(`Release line ${line} is not enabled for backports`)
  }
}

async function readReleaseLines(github, repo) {
  const { data: repository } = await github.rest.repos.get(repo)
  const { data: file } = await github.rest.repos.getContent({
    ...repo,
    path: '.github/release-lines.json',
    ref: repository.default_branch
  })
  return validateReleaseLines(JSON.parse(Buffer.from(file.content, 'base64').toString('utf8')))
}

function sourceNumber(value) {
  if (!/^[1-9][0-9]*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) {
    throw new Error(`Invalid source pull request number: ${value}`)
  }
  return Number(value)
}

function backportIdentity(pr, repoName) {
  const match = /^backport\/([^/]+)\/pr-([1-9][0-9]*)$/.exec(pr.head.ref)
  if (!match || !LINE_PATTERN.test(match[1]) || pr.head.repo?.full_name !== repoName) return null
  const [, line, number] = match
  if (pr.base.ref !== `release/${line}`) throw new Error('Backport branch and base release line disagree')
  const body = (pr.body || '').replace(/```release-note\s*\n[\s\S]*?```/g, '')
  const markers = [...body.matchAll(/^<!-- release-backport-source-pr: ([1-9][0-9]*) -->\r?$/gm)]
  if (markers.length !== 1 || markers[0][1] !== number)
    throw new Error('Backport source marker does not match its branch')
  return { line, source: sourceNumber(number) }
}

async function planLineBackports({ github, context, inputs = {} }) {
  const config = await readReleaseLines(github, context.repo)
  if (config.mode !== 'minor-line') {
    if (context.eventName === 'workflow_dispatch') throw new Error('Minor-line backports are not enabled')
    return { mode: config.mode, targets: [] }
  }
  if (context.eventName === 'push') {
    for (const line of [config.current, config.previous, config.candidate].filter(Boolean)) {
      await github.rest.issues
        .createLabel({
          ...context.repo,
          name: `target/${line}`,
          color: '5319E7',
          description: `Request a backport to release/${line}`
        })
        .catch((error) => {
          if (error.status !== 422 || !error.response?.data?.errors?.some((entry) => entry.code === 'already_exists'))
            throw error
        })
    }
    return { mode: config.mode, targets: [] }
  }
  const manual = context.eventName === 'workflow_dispatch'
  if (
    !manual &&
    ['labeled', 'unlabeled'].includes(context.payload.action) &&
    !context.payload.label?.name.startsWith('target/')
  ) {
    return { mode: config.mode, targets: [] }
  }
  const number = sourceNumber(manual ? inputs.source_pr : context.payload.pull_request.number)
  const { data: pr } = await github.rest.pulls.get({ ...context.repo, pull_number: number })
  const identity = backportIdentity(pr, `${context.repo.owner}/${context.repo.repo}`)
  if (!manual && identity) return { mode: config.mode, targets: [{ ...identity, retry: false }] }
  if (pr.base.ref !== 'main' || !pr.merged_at) return { mode: config.mode, targets: [] }
  const lines = manual
    ? [inputs.line]
    : pr.labels
        .map((label) => label.name)
        .filter((name) => name.startsWith('target/'))
        .map((name) => name.slice(7))
  lines.forEach(parseReleaseLine)
  return { mode: config.mode, targets: [...new Set(lines)].map((line) => ({ source: number, line, retry: manual })) }
}

module.exports = {
  backportIdentity,
  parseReleaseLine,
  planLineBackports,
  readReleaseLines,
  requireSupportedLine,
  validateReleaseLines
}
