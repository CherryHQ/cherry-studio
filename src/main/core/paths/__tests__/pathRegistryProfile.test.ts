import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { buildAppPathRegistry, buildPathRegistry, buildProfilePathRegistry } from '../pathRegistry'
import { PROFILE_PATH_KEYS } from '../profileKeys'

// The Data subtree + DB root at profileRoot; per-identity content at credentialRoot.
describe('path registry app/profile split', () => {
  it('roots the Data subtree + DB at profileRoot and credentials at credentialRoot', () => {
    const reg = buildProfilePathRegistry('/p', '/c')
    expect(reg['app.database.file']).toBe(path.join('/p', 'cherrystudio.sqlite'))
    expect(reg['app.userdata.data']).toBe(path.join('/p', 'Data'))
    expect(reg['feature.files.data']).toBe(path.join('/p', 'Data', 'Files'))
    expect(reg['feature.agents.workspaces']).toBe(path.join('/p', 'Data', 'Agents'))
    expect(reg['feature.agents.claude.root']).toBe(path.join('/p', '.claude'))
    expect(reg['feature.mcp.oauth']).toBe(path.join('/c', 'config', 'mcp', 'oauth'))
    expect(reg['feature.copilot.token_file']).toBe(path.join('/c', 'config', '.copilot_token'))
    expect(reg['feature.trace']).toBe(path.join('/c', 'trace'))
  })

  it('profile registry keys match PROFILE_PATH_KEYS exactly (classification and builder agree)', () => {
    const built = Object.keys(buildProfilePathRegistry('/p', '/c')).sort()
    expect(built).toEqual([...PROFILE_PATH_KEYS].sort())
  })

  it('app and profile registries partition the full key set', () => {
    const appKeys = Object.keys(buildAppPathRegistry())
    const profileKeys = new Set<string>(PROFILE_PATH_KEYS)
    // disjoint: no app key is a profile key
    for (const key of appKeys) expect(profileKeys.has(key)).toBe(false)
    // union: app ∪ profile covers exactly the combined default registry
    const union = new Set([...appKeys, ...PROFILE_PATH_KEYS])
    expect(union).toEqual(new Set(Object.keys(buildPathRegistry())))
  })
})
