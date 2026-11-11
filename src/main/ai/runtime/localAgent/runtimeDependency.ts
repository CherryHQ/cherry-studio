import { coerce, gte } from 'semver'
import which from 'which'

import { application } from '@application'
import { mergeBinaryExecutionEnv } from '@main/utils/binaryEnv'
import { findExecutableInEnv } from '@main/utils/commandResolver'
import { executeCommand } from '@main/utils/processRunner'
import { getPathFromEnvironment } from '@main/utils/shellEnv'
import type { LocalAgentPreset } from '@shared/ai/localAgent'

export async function resolveRequiredRuntime(
  runtime: NonNullable<LocalAgentPreset['requiredRuntime']>,
  env: Record<string, string>
) {
  const systemPath = await findExecutableInEnv(runtime.executable, { env })
  const snapshot = (await application.get('BinaryManager').getToolSnapshots([runtime.executable]))[runtime.executable]
  const paths = await which(runtime.executable, { path: getPathFromEnvironment(env) ?? '', all: true, nothrow: true })
  const candidates = [
    ...(systemPath ? [{ source: 'system' as const, path: systemPath }] : []),
    ...(paths ?? []).filter((file) => file !== systemPath).map((file) => ({ source: 'system' as const, path: file })),
    ...(snapshot && snapshot.availability.source !== 'none' ? [snapshot.availability] : [])
  ]
  for (const candidate of candidates) {
    const version = await executeCommand(candidate.path, ['--version'], {
      env: candidate.source === 'mise' ? mergeBinaryExecutionEnv(env) : env,
      timeout: 3000,
      maxOutputBytes: 4096
    }).then(coerce, () => null)
    if (version && gte(version, runtime.minimumVersion)) return candidate
  }
  return undefined
}
