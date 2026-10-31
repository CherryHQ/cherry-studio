import { mkdirSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

export interface RunPaths {
  root: string
  appRecord: string
  artifacts: string
  evidence: string
  fixtures: string
  installed: string
  installation: string
  logs: string
  output: string
  profiles: string
  runState: string
  workspace: string
}

export function getRunPaths(runDirectory: string): RunPaths {
  const root = resolve(runDirectory)
  return {
    root,
    appRecord: join(root, 'app.json'),
    artifacts: join(root, 'release'),
    evidence: join(root, 'evidence'),
    fixtures: join(root, 'fixtures'),
    installed: join(root, 'installed'),
    installation: join(root, 'release', 'installation.json'),
    logs: join(root, 'logs'),
    output: join(root, 'report'),
    profiles: join(root, 'profiles'),
    runState: join(root, 'run.json'),
    workspace: join(root, 'agent-workspace')
  }
}

export function ensureRunDirectories(paths: RunPaths): void {
  for (const directory of [
    paths.root,
    paths.artifacts,
    paths.evidence,
    paths.fixtures,
    paths.installed,
    paths.logs,
    paths.output,
    paths.profiles,
    paths.workspace
  ]) {
    mkdirSync(directory, { recursive: true })
  }
}

export function resolveAllowedPath(candidate: string, roots: string[]): string {
  const resolved = resolve(isAbsolute(candidate) ? candidate : join(roots[0], candidate))
  const isAllowed = roots.some((root) => {
    const normalizedRoot = resolve(root)
    const pathFromRoot = relative(normalizedRoot, resolved)
    return (
      pathFromRoot === '' ||
      (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..' && !isAbsolute(pathFromRoot))
    )
  })
  if (!isAllowed) throw new Error(`Path is outside the regression test directories: ${candidate}`)
  return resolved
}

export function isPathInside(parent: string, child: string): boolean {
  const relativePath = relative(resolve(parent), resolve(child))
  return (
    relativePath === '' || (!relativePath.startsWith(`..${sep}`) && relativePath !== '..' && !isAbsolute(relativePath))
  )
}

export function realpathIfPresent(filePath: string): string {
  try {
    return realpathSync(filePath)
  } catch {
    return resolve(filePath)
  }
}
