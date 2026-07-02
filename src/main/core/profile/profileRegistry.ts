import path from 'node:path'

import { customAlphabet } from 'nanoid'

/**
 * Reserved id for the default profile. It is never produced by the generator
 * (which emits 8-char ids), so it can never collide, and `resolveProfileRoots`
 * maps it to the legacy data root for zero-migration of existing users (RFC §4.7).
 */
export const DEFAULT_PROFILE_ID = 'default'

/** A registered profile. `id` is immutable; `name` is the user-editable label. */
export interface ProfileEntry {
  readonly id: string
  /** `dataDir` is the profile's root relative to userData: the `default` sentinel, else `Profiles/<id>`. */
  readonly dataDir: string
  readonly name: string
  readonly createdAt: number
}

/** The whole `profiles.json`: which profile is active and the set of profiles. */
export interface ProfileRegistry {
  readonly activeProfileId: string
  readonly profiles: readonly ProfileEntry[]
}

// base62, no prefix (§ RFC 4.6). 8 chars ≈ 2^47 space; a create-time collision
// check (generateProfileId) makes even that bound irrelevant.
const generate = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', 8)

/** A fresh 8-char base62 profile id, guaranteed absent from `existingIds`. */
export function generateProfileId(existingIds: ReadonlySet<string>): string {
  let id = generate()
  while (existingIds.has(id)) id = generate()
  return id
}

export function findEntry(registry: ProfileRegistry, id: string): ProfileEntry | undefined {
  return registry.profiles.find((entry) => entry.id === id)
}

/** Append a profile. Caller ensures `entry.id` is unique (see generateProfileId). */
export function addProfile(registry: ProfileRegistry, entry: ProfileEntry): ProfileRegistry {
  return { ...registry, profiles: [...registry.profiles, entry] }
}

/** Rename a profile by id; a no-op (same reference contents) if the id is absent. */
export function renameProfile(registry: ProfileRegistry, id: string, name: string): ProfileRegistry {
  return { ...registry, profiles: registry.profiles.map((entry) => (entry.id === id ? { ...entry, name } : entry)) }
}

/** Repoint the active profile. Caller ensures `id` names an existing profile. */
export function setActive(registry: ProfileRegistry, id: string): ProfileRegistry {
  return { ...registry, activeProfileId: id }
}

/** On-disk roots for a profile: the Data/DB base and the per-identity credential base. */
export interface ProfileRoots {
  readonly profileRoot: string
  readonly credentialRoot: string
}

/**
 * Map a profile to its on-disk roots. The default profile resolves to the legacy
 * locations — `legacyUserData` for the Data subtree + DB, `legacyCherryHome` for
 * credentials — so existing data is read in place (RFC §4.7). Every other profile
 * isolates both roots under `<legacyUserData>/<dataDir>` (dataDir = `Profiles/<id>`).
 */
export function resolveProfileRoots(
  entry: ProfileEntry,
  legacyUserData: string,
  legacyCherryHome: string
): ProfileRoots {
  if (entry.id === DEFAULT_PROFILE_ID) {
    return { profileRoot: legacyUserData, credentialRoot: legacyCherryHome }
  }
  const root = path.join(legacyUserData, entry.dataDir)
  return { profileRoot: root, credentialRoot: root }
}
