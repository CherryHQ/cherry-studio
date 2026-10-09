import { execFileSync } from 'node:child_process'

export const testProjects = [
  'main',
  'preload',
  'renderer',
  'aiCore',
  'ui',
  'file-preview',
  'shared',
  'provider-registry',
  'scripts',
  'ai-sdk-provider',
  'dsh-bridge',
  'remote-protocol',
  'remote-transport'
]

export const checkTasks = {
  format: { group: 'repository', args: ['format:check'] },
  docs: { group: 'repository', args: ['docs:check'] },
  skills: { group: 'repository', args: ['skills:check'] },
  knowledge: { group: 'repository', args: ['build:builtin-knowledge:check'] },
  migrations: { group: 'repository', args: ['db:migrations:check'] },
  lint: { group: 'lint', args: ['lint'] },
  'types-node': { group: 'types', args: ['typecheck:node'] },
  'types-web': { group: 'types', args: ['typecheck:web'] },
  'types-aicore': { group: 'types', args: ['--filter', '@cherrystudio/ai-core', 'typecheck'] },
  'types-e2e': { group: 'types', args: ['typecheck:e2e'] },
  'types-remote-protocol': { group: 'types', args: ['--filter', '@cherrystudio/remote-protocol', 'typecheck'] },
  'types-remote-transport': { group: 'types', args: ['--filter', '@cherrystudio/remote-transport', 'typecheck'] },
  'types-file-preview': { group: 'types', args: ['--filter', '@cherrystudio/file-preview', 'typecheck'] },
  'i18n-catalog': { group: 'i18n', args: ['i18n:check'] },
  'i18n-unused': { group: 'i18n', args: ['i18n:unused:check'] },
  'i18n-hardcoded': { group: 'i18n', args: ['i18n:hardcoded:strict'] }
}

const consumers = {
  main: ['main', 'preload'],
  renderer: ['renderer'],
  shared: testProjects,
  aiCore: ['aiCore', 'main', 'preload', 'renderer'],
  'ai-sdk-provider': ['ai-sdk-provider', 'aiCore', 'main', 'preload', 'renderer'],
  ui: ['ui', 'file-preview', 'renderer'],
  'file-preview': ['file-preview', 'renderer'],
  spreadsheet: ['main', 'preload', 'file-preview', 'renderer'],
  'provider-registry': ['provider-registry', 'shared', 'scripts', 'main', 'preload', 'renderer'],
  'extension-table-plus': ['renderer'],
  'dsh-bridge': ['dsh-bridge', 'main', 'preload'],
  'remote-protocol': ['remote-protocol', 'remote-transport', 'shared', 'scripts', 'main', 'preload', 'renderer'],
  'remote-transport': ['remote-transport', 'main', 'preload', 'renderer'],
  scripts: ['scripts']
}

function scopeFor(file) {
  if (file.startsWith('resources/')) return 'all'
  if (
    (file.startsWith('docs/') || file.startsWith('.agents/notes/') || file.startsWith('.changeset/')) &&
    file.endsWith('.md')
  )
    return 'docs'
  if (/^(?:[^/]+\.md|(?:src|packages|scripts)\/.*\/README(?:\.[\w-]+)?\.md)$/.test(file)) return 'docs'
  if (file.startsWith('.agents/skills/') || file.startsWith('.claude/skills/')) return 'skills'
  if (file.startsWith('src/preload/')) return 'preload'
  if (file.startsWith('migrations/')) return 'main'
  if (file.startsWith('tests/e2e/') || /^playwright.*\.config\.ts$/.test(file)) return 'e2e'
  if (file === 'tests/file-preview.setup.ts') return 'file-preview'
  if (
    file.startsWith('tests/helpers/') ||
    file.startsWith('tests/__mocks__/main/') ||
    file === 'tests/main.setup.ts' ||
    file === 'tests/__mocks__/MainLoggerService.ts'
  )
    return 'main'
  if (
    file.startsWith('tests/__mocks__/renderer/') ||
    [
      'tests/renderer.setup.ts',
      'tests/__mocks__/RendererLoggerService.ts',
      'tests/__mocks__/requestAnimationFrame.ts'
    ].includes(file)
  )
    return 'renderer'
  if (file.startsWith('scripts/validation/') || file.startsWith('.github/')) return 'all'
  if (file.startsWith('scripts/')) return 'scripts'
  const process = /^src\/(main|renderer|shared)\//.exec(file)?.[1]
  if (process) return process
  const pkg = /^packages\/([^/]+)\//.exec(file)?.[1]
  return pkg && consumers[pkg] ? pkg : 'all'
}

export function createPlan(files, fullReason) {
  const reasons = {}
  const projects = new Set()
  const add = (task, reason) => {
    const entries = (reasons[task] ??= [])
    if (entries.length < 3 && !entries.includes(reason)) entries.push(reason)
  }
  const full = (reason) => {
    for (const task of Object.keys(checkTasks)) add(task, reason)
    for (const project of testProjects) projects.add(project)
  }
  if (fullReason) full(fullReason)
  for (const file of [...new Set(files)].sort()) {
    const scope = scopeFor(file)
    add('format', file)
    add('docs', file)
    if (scope === 'docs') continue
    if (scope === 'skills') {
      add('skills', file)
      continue
    }
    if (scope === 'all') {
      full(`Conservative fallback: ${file}`)
      continue
    }
    add('lint', file)
    if (scope === 'e2e') {
      add('types-e2e', file)
      continue
    }
    add('knowledge', file)
    const affected = scope === 'preload' ? ['main', 'preload', 'renderer'] : consumers[scope]
    for (const project of affected) projects.add(project)
    if (affected.some((project) => ['main', 'shared', 'scripts', 'provider-registry'].includes(project)))
      add('types-node', file)
    if (affected.includes('renderer')) add('types-web', file)
    if (affected.includes('aiCore')) add('types-aicore', file)
    if (affected.includes('remote-protocol')) add('types-remote-protocol', file)
    if (affected.includes('remote-transport')) add('types-remote-transport', file)
    if (affected.includes('file-preview')) add('types-file-preview', file)
    if (scope === 'main' || scope === 'shared') add('migrations', file)
    for (const task of ['i18n-catalog', 'i18n-unused', 'i18n-hardcoded']) add(task, file)
  }
  return {
    tasks: Object.keys(checkTasks).filter((task) => reasons[task]),
    projects: testProjects.filter((project) => projects.has(project)),
    reasons
  }
}

export function changedFiles(cwd, base = 'origin/main', head = 'HEAD', local = true) {
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' })
  const baseCommit = git('rev-parse', '--verify', '--end-of-options', `${base}^{commit}`).trim()
  const headCommit = git('rev-parse', '--verify', '--end-of-options', `${head}^{commit}`).trim()
  const comparison = local ? git('merge-base', baseCommit, headCommit).trim() : baseCommit
  const files = git('diff', '--name-only', '--no-renames', '-z', comparison, headCommit).split('\0')
  if (local) {
    files.push(...git('diff', '--cached', '--name-only', '--no-renames', '-z', 'HEAD').split('\0'))
    files.push(...git('diff', '--name-only', '--no-renames', '-z').split('\0'))
    files.push(...git('ls-files', '--others', '--exclude-standard', '-z').split('\0'))
  }
  return [...new Set(files.filter(Boolean))]
}

export function selectedGroups(plan) {
  return {
    repository: plan.tasks.some((task) => checkTasks[task].group === 'repository'),
    lint: plan.tasks.includes('lint'),
    types: plan.tasks.some((task) => checkTasks[task].group === 'types'),
    i18n: plan.tasks.some((task) => checkTasks[task].group === 'i18n'),
    main: plan.projects.includes('main'),
    platform: plan.projects.includes('main'),
    renderer: plan.projects.includes('renderer'),
    packages: plan.projects.some((project) => !['main', 'preload', 'renderer'].includes(project))
  }
}

export function verifyResults(plan, results, groups = Object.keys(selectedGroups(plan))) {
  const selected = selectedGroups(plan)
  for (const group of groups) {
    if (!Object.hasOwn(selected, group)) throw new Error(`Unknown validation group: ${group}`)
    const required = selected[group]
    if (required && results[group] !== 'success')
      throw new Error(`${group}: expected success, received ${results[group] ?? 'missing'}`)
    if (!required && results[group] !== 'skipped' && results[group] !== 'success')
      throw new Error(`${group}: unexpected result ${results[group] ?? 'missing'}`)
  }
}
