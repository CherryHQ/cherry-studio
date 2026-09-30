import { execFileSync, spawnSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { changedFiles, checkTasks, createPlan, selectedGroups, testProjects } from './plan.mjs'

const { values } = parseArgs({
  options: {
    all: { type: 'boolean' },
    plan: { type: 'boolean' },
    json: { type: 'boolean' },
    base: { type: 'string', default: 'origin/main' },
    head: { type: 'string', default: 'HEAD' },
    committed: { type: 'boolean' },
    group: { type: 'string' },
    shard: { type: 'string' },
    'github-output': { type: 'boolean' }
  }
})
const root = fileURLToPath(new URL('../../', import.meta.url))
const groups = ['repository', 'lint', 'types', 'i18n', 'main', 'renderer', 'packages', 'platform', 'checks', 'tests']
if (values.group && !groups.includes(values.group)) throw new Error(`Unknown validation group: ${values.group}`)
if (values.shard && !/^\d+\/\d+$/.test(values.shard)) throw new Error('Expected --shard=N/M')

let plan
if (process.env.VALIDATION_PLAN) {
  plan = JSON.parse(process.env.VALIDATION_PLAN)
  if (
    !Array.isArray(plan.tasks) ||
    !Array.isArray(plan.projects) ||
    plan.tasks.some((task) => !Object.hasOwn(checkTasks, task)) ||
    plan.projects.some((project) => !testProjects.includes(project))
  )
    throw new Error('Invalid validation plan')
} else if (values.all) {
  plan = createPlan([], 'Explicit full validation')
} else {
  try {
    plan = createPlan(changedFiles(root, values.base, values.head, !values.committed))
  } catch {
    plan = createPlan([], `Full validation: comparison history unavailable (${values.base})`)
  }
}

if (values['github-output']) {
  if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required')
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `plan=${JSON.stringify(plan)}\n${Object.entries(selectedGroups(plan))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')}\n`
  )
}
if (values.json) process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`)
else {
  for (const task of plan.tasks)
    process.stdout.write(`${task}: ${plan.reasons?.[task]?.join(', ') ?? 'Selected by CI plan'}\n`)
  process.stdout.write(`Test projects: ${plan.projects.join(', ') || 'none'}\n`)
}
if (values.plan || values['github-output']) process.exit(0)

const tasks = plan.tasks.filter(
  (task) => !values.group || values.group === 'checks' || checkTasks[task].group === values.group
)
const projects =
  values.group === 'platform' && plan.projects.includes('main')
    ? ['main', 'shared', 'dsh-bridge']
    : plan.projects.filter((project) => {
        if (!values.group || values.group === 'tests') return true
        if (values.group === 'main') return ['main', 'preload'].includes(project)
        if (values.group === 'renderer') return project === 'renderer'
        if (values.group === 'packages') return !['main', 'preload', 'renderer'].includes(project)
        return false
      })
function run(args) {
  if (!process.env.npm_execpath) throw new Error('Execute validation through pnpm check')
  process.stdout.write(`\n> pnpm ${args.join(' ')}\n`)
  const executable = process.env.npm_execpath
  const isScript = /\.[cm]?js$/.test(executable)
  const result = spawnSync(isScript ? process.execPath : executable, isScript ? [executable, ...args] : args, {
    cwd: root,
    stdio: 'inherit'
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
if (tasks.some((task) => task.startsWith('types-')) || projects.length) {
  run(['run', 'postinstall'])
  if (tasks.some((task) => task.startsWith('types-'))) run(['--filter', '@cherrystudio/ai-sdk-provider', 'build'])
}
for (const task of tasks) run(checkTasks[task].args)
if (projects.length) {
  if (projects.includes('main')) run(['rebuild:node'])
  const files =
    values.group === 'platform'
      ? execFileSync('git', ['ls-files', '-z', '--', 'src/main', 'src/shared', 'packages/dsh-bridge'], {
          cwd: root,
          encoding: 'utf8'
        })
          .split('\0')
          .filter(
            (file) =>
              /\.(test|spec)\.tsx?$/.test(file) && readFileSync(join(root, file), 'utf8').includes('process.platform')
          )
      : []
  if (values.group === 'platform' && !files.length) throw new Error('No platform-gated tests found')
  run([
    'exec',
    'vitest',
    'run',
    ...projects.flatMap((project) => ['--project', project]),
    ...files,
    ...(values.shard ? [`--shard=${values.shard}`] : [])
  ])
}
