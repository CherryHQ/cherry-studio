import { isWin } from '@main/core/platform'

export function getEnvironmentValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const key = isWin
    ? Object.keys(env)
        .sort()
        .find((key) => key.toUpperCase() === name.toUpperCase())
    : name
  return key === undefined ? undefined : env[key]
}

/** Windows child processes must receive one entry per case-insensitive environment name. */
export function mergeEnvironment(...sources: (NodeJS.ProcessEnv | undefined)[]): Record<string, string> {
  const merged: NodeJS.ProcessEnv = Object.fromEntries(
    sources.flatMap((env) => {
      const keys = Object.keys(env ?? {})
      // Match Node's first sorted key within each source; later explicit sources still override it.
      if (isWin) keys.sort().reverse()
      return keys.map((key) => [isWin ? key.toUpperCase() : key, env![key]])
    })
  )
  return Object.fromEntries(Object.entries(merged).filter((entry): entry is [string, string] => entry[1] !== undefined))
}
