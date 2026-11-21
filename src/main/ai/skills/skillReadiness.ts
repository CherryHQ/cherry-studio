import { createHash } from 'crypto'

import { coerce as semverCoerce, satisfies as semverSatisfies } from 'semver'

import type { SkillRequires } from '@main/utils/plugin'

/**
 * Skill prerequisite readiness (Agent Note: skill-dependency-preflight-and-isolation).
 *
 * This module is the pure decision layer: it evaluates a parsed `requires` declaration against an
 * environment snapshot collected by the caller (binary resolution, runtime versions) and computes
 * the fingerprint that decides when a stored evaluation must be revalidated. It never runs
 * processes, installs anything, or touches the task working directory.
 */

export type SkillReadinessState = 'ready' | 'setup_required' | 'setting_up' | 'failed'

export interface ResolvedExecutable {
  /** Absolute path the executable resolved to. */
  path: string
  /** Reported version string. */
  version: string
}

/**
 * A point-in-time read of everything a `requires` declaration can depend on. Keys of `binaries`
 * are the declared executable names; a null value means the executable did not resolve.
 */
export interface SkillEnvironmentSnapshot {
  platform: string
  appVersion: string
  /** Hash of the installed skill's SKILL.md, from its stored metadata. */
  skillContentHash: string
  binaries: Record<string, ResolvedExecutable | null>
  python: ResolvedExecutable | null
}

export interface SkillReadinessEvaluation {
  /** Preflight outcomes are only ever `ready` or `setup_required`; the other states belong to setup runs. */
  state: 'ready' | 'setup_required'
  /** Human-readable failing prerequisites, e.g. "binary pandoc" or "python 3.9.2 does not satisfy >=3.10". */
  missing: string[]
}

/**
 * Compute the readiness fingerprint for a skill: platform, app version, skill content hash, and
 * the resolved identity (path + version) of every declared prerequisite. Any upgrade, skill
 * update, or environment change flips the fingerprint and forces revalidation.
 */
export function computeSkillFingerprint(requires: SkillRequires | undefined, snapshot: SkillEnvironmentSnapshot): string {
  const identity: Record<string, unknown> = {
    platform: snapshot.platform,
    appVersion: snapshot.appVersion,
    skillContentHash: snapshot.skillContentHash,
    binaries: {} as Record<string, ResolvedExecutable | null>,
    python: snapshot.python
  }
  const binaries = identity.binaries as Record<string, ResolvedExecutable | null>
  for (const bin of [...(requires?.bins ?? [])].sort()) {
    binaries[bin] = snapshot.binaries[bin] ?? null
  }
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex')
}

/**
 * Evaluate a `requires` declaration against an environment snapshot. A skill with no declaration
 * is ready by definition, preserving the behavior of skills that predate prerequisites.
 */
export function evaluateSkillReadiness(
  requires: SkillRequires | undefined,
  snapshot: SkillEnvironmentSnapshot
): SkillReadinessEvaluation {
  if (!requires) {
    return { state: 'ready', missing: [] }
  }

  const missing: string[] = []

  if (requires.platforms && requires.platforms.length > 0 && !requires.platforms.includes(snapshot.platform)) {
    missing.push(`platform ${snapshot.platform} not in [${requires.platforms.join(', ')}]`)
  }

  for (const bin of requires.bins ?? []) {
    if (!snapshot.binaries[bin]) {
      missing.push(`binary ${bin}`)
    }
  }

  if (requires.python) {
    if (!snapshot.python) {
      missing.push(`python (requires ${requires.python})`)
    } else {
      const version = semverCoerce(snapshot.python.version)
      if (!version || !semverSatisfies(version.version, requires.python, { includePrerelease: true })) {
        missing.push(`python ${snapshot.python.version} does not satisfy ${requires.python}`)
      }
    }
  }

  return { state: missing.length > 0 ? 'setup_required' : 'ready', missing }
}
