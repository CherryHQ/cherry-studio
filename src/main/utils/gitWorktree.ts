import { execFile } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import type { SessionWorktree } from '@shared/data/api/schemas/agentSessions'

const exec = promisify(execFile)

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec('git', ['-C', cwd, ...args], { timeout: 10000, maxBuffer: 1024 * 1024 })
  return stdout.replace(/\r?\n$/, '')
}

export async function validateSessionWorktree(workspace: string, input: string): Promise<SessionWorktree> {
  const target = await realpath(path.resolve(workspace, input))
  const root = await realpath(await git(target, 'rev-parse', '--show-toplevel'))
  const common = await realpath(await git(workspace, 'rev-parse', '--path-format=absolute', '--git-common-dir'))
  const targetCommon = await realpath(await git(root, 'rev-parse', '--path-format=absolute', '--git-common-dir'))
  const gitDirectory = await realpath(await git(root, 'rev-parse', '--absolute-git-dir'))
  const registered = (await git(workspace, 'worktree', 'list', '--porcelain', '-z'))
    .split('\0')
    .some((entry) => entry.startsWith('worktree ') && path.normalize(entry.slice(9)) === root)
  if (root !== target || common !== targetCommon || gitDirectory === common || !registered) {
    throw new Error('Target must be a registered linked worktree in the original workspace repository')
  }
  const branch = await git(root, 'symbolic-ref', '--quiet', '--short', 'HEAD').catch(async () => {
    await git(root, 'rev-parse', '--verify', 'HEAD')
    return ''
  })
  return { path: root, commonGitDirectory: common, branch: branch || null, available: true }
}
