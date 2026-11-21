import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import { app } from 'electron'

import { findExecutableInEnv } from '@main/utils/commandResolver'
import { findSkillMdPath, parseSkillMetadata } from '@main/utils/markdownParser'
import { getShellEnv } from '@main/utils/shellEnv'
import type { SkillRequires } from '@shared/types/skillReadiness'

import {
  computeSkillFingerprint,
  evaluateSkillReadiness,
  type ResolvedExecutable,
  type SkillEnvironmentSnapshot
} from './skillReadiness'

const execFileAsync = promisify(execFile)
export const SAFE_PIP_REQUIREMENT =
  /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\[[A-Za-z0-9_,.-]+\])?(?:\s*(?:===|==|~=|!=|<=|>=|<|>)\s*[A-Za-z0-9.*+!_-]+(?:\s*,\s*(?:===|==|~=|!=|<=|>=|<|>)\s*[A-Za-z0-9.*+!_-]+)*)?$/
const SAFE_BINARY = /^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/

// Inspect distribution metadata, including active extras/transitive requirements, without importing package code.
const INSPECT_PACKAGE_SCRIPT = `
import sys, json, importlib.metadata as metadata
from pip._vendor.packaging.requirements import Requirement
from pip._vendor.packaging.utils import canonicalize_name
seen = set()
def installed(requirement):
    distribution = metadata.distribution(requirement.name)
    if not requirement.specifier.contains(distribution.version, prereleases=True):
        return False
    identity = (canonicalize_name(requirement.name), tuple(sorted(requirement.extras)))
    if identity in seen:
        return True
    seen.add(identity)
    for declaration in distribution.requires or []:
        dependency = Requirement(declaration)
        if dependency.marker and not any(dependency.marker.evaluate({'extra': extra}) for extra in requirement.extras or ['']):
            continue
        if not installed(dependency):
            return False
    return True
requirement = Requirement(sys.argv[1])
print(json.dumps({'version': metadata.version(requirement.name), 'valid': installed(requirement)}))
`

async function identity(executable: string): Promise<ResolvedExecutable | null> {
  try {
    const resolved = await realpath(executable)
    const { stdout, stderr } = await execFileAsync(resolved, ['--version'], {
      env: await getShellEnv(),
      timeout: 5000,
      killSignal: 'SIGKILL',
      maxBuffer: 16384,
      windowsHide: true
    })
    return { path: resolved, version: (stdout || stderr).trim().split('\n')[0] }
  } catch {
    return null
  }
}

async function resolveIdentity(name: string): Promise<ResolvedExecutable | null> {
  if (!SAFE_BINARY.test(name)) return null
  try {
    const executable = await findExecutableInEnv(name)
    return executable ? identity(executable) : null
  } catch {
    return null
  }
}

export function managedSkillPython(directory: string): string {
  return path.join(directory, 'venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
}

export async function inspectSkillEnvironment(skillDirectory: string, environmentDirectory?: string) {
  const entry = await findSkillMdPath(skillDirectory)
  if (!entry) throw new Error('Skill definition was not found')
  const metadata = await parseSkillMetadata(skillDirectory, path.basename(skillDirectory), 'skills', {
    calculateSize: false
  })
  const requires = metadata.requires
  const content = await readFile(entry)
  const snapshot: SkillEnvironmentSnapshot = {
    platform: process.platform,
    appVersion: app.getVersion(),
    skillContentHash: createHash('sha256').update(content).digest('hex'),
    binaries: {},
    python: null,
    packages: {}
  }
  if (requires) {
    for (const bin of requires.bins ?? []) snapshot.binaries[bin] = await resolveIdentity(bin)
    if (requires.python || requires.packages?.pip?.length) {
      snapshot.python = environmentDirectory ? await identity(managedSkillPython(environmentDirectory)) : null
      snapshot.python ??= await resolveIdentity(process.platform === 'win32' ? 'python' : 'python3')
    }
    for (const requirement of requires.packages?.pip ?? []) {
      snapshot.packages![requirement] = await inspectManagedPackage(requirement, environmentDirectory)
    }
  }
  return {
    requires,
    warnings: metadata.requirementWarnings,
    snapshot,
    fingerprint: computeSkillFingerprint(requires, snapshot),
    ...evaluateSkillReadiness(requires, snapshot)
  }
}

async function inspectManagedPackage(requirement: string, directory?: string): Promise<ResolvedExecutable | null> {
  if (!directory || !SAFE_PIP_REQUIREMENT.test(requirement)) return null
  const python = managedSkillPython(directory)
  try {
    const { stdout } = await execFileAsync(python, ['-I', '-c', INSPECT_PACKAGE_SCRIPT, requirement], {
      env: await getShellEnv(),
      timeout: 5000,
      killSignal: 'SIGKILL',
      maxBuffer: 16384,
      windowsHide: true
    })
    const result = JSON.parse(stdout) as { version: string; valid: boolean }
    return result.valid ? { path: python, version: result.version } : null
  } catch {
    return null
  }
}

export function validateSetupRequirements(requires: SkillRequires | undefined): string[] {
  const requirements = requires?.packages?.pip ?? []
  if (
    requirements.length > 100 ||
    requirements.some((requirement) => !SAFE_PIP_REQUIREMENT.test(requirement) || requirement.length > 512)
  ) {
    throw new Error('Setup supports package names and version constraints only, not URLs, paths or installer flags')
  }
  return requirements
}
