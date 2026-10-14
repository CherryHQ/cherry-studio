import path from 'node:path'

import { application } from '@application'
import { isWin } from '@main/core/platform'
import { getRawShellEnv } from '@main/utils/shellEnv'
import { type AbsoluteFilePath, AbsoluteFilePathSchema } from '@shared/types/file'

function readEnv(env: NodeJS.ProcessEnv, name: string): string {
  if (!isWin) return env[name]?.trim() ?? ''
  const key = Object.keys(env).find((candidate) => candidate.toLowerCase() === name.toLowerCase())
  return key ? (env[key]?.trim() ?? '') : ''
}

/** Resolve the Hermes home the way Hermes itself does: HERMES_HOME override, else the platform default. */
export function resolveHermesHome(env: NodeJS.ProcessEnv): AbsoluteFilePath {
  const override = readEnv(env, 'HERMES_HOME')
  if (override) return AbsoluteFilePathSchema.parse(path.resolve(override))
  return AbsoluteFilePathSchema.parse(application.getPath('external.hermes.default_home'))
}

let pinnedHome: Promise<AbsoluteFilePath> | null = null

/**
 * Session-pinned Hermes home. Config reads/writes and the Dashboard process must
 * all see one value, even if a shell-env refresh changes HERMES_HOME mid-session.
 */
export function getHermesHome(): Promise<AbsoluteFilePath> {
  pinnedHome ??= getRawShellEnv().then(resolveHermesHome)
  return pinnedHome
}
