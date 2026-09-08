import { miniAppTable } from '@data/db/schemas/miniApp'
import { declaredGrantKeys, type MiniAppManifest, MiniAppManifestSchema } from '@shared/types/miniAppManifest'
import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

import {
  assertGranted,
  assertMethodAllowed,
  diffDeclaredHosts,
  diffDeclaredSets,
  grantMiniAppPermissions,
  listGrants,
  pendingDeclaredAdditions,
  PermissionDeniedError,
  replaceGrants,
  revokeGrant
} from '../grants'

const APP_ID = 'com.example.mygame'
const manifest = (over: Record<string, unknown> = {}): MiniAppManifest =>
  MiniAppManifestSchema.parse({
    id: APP_ID,
    name: 'App',
    description: 'A tiny sample game.',
    version: '1.1.0',
    entry: 'index.html',
    permissions: ['storage.get'],
    network: [],
    ...over
  })

describe('grants', () => {
  const dbh = setupTestDatabase()

  const insertApp = () =>
    dbh.db
      .insert(miniAppTable)
      .values({
        appId: APP_ID,
        kind: 'app',
        presetMiniAppId: null,
        name: 'App',
        url: `cherry-miniapp://${APP_ID}/index.html`,
        status: 'enabled',
        orderKey: 'a0'
      })
      .run()

  it('records and lists grants', () => {
    insertApp()
    grantMiniAppPermissions(APP_ID, ['storage.get', 'notification.show'], '1.0.0')
    expect(listGrants(APP_ID)).toEqual(['notification.show', 'storage.get'])
  })

  it('is idempotent when re-granting the same key', () => {
    insertApp()
    grantMiniAppPermissions(APP_ID, ['storage.get'], '1.0.0')
    grantMiniAppPermissions(APP_ID, ['storage.get'], '1.0.0')
    expect(listGrants(APP_ID)).toEqual(['storage.get'])
  })

  it('reports only the leaves a widened wildcard actually adds', () => {
    // `storage.get` → `storage.*` is a permission increase, and the diff has to name
    // the leaves so the consent card can show what is new rather than a `*`.
    expect(diffDeclaredSets(manifest(), manifest({ permissions: ['storage.*'] })).added).toEqual([
      'storage.delete',
      'storage.keys',
      'storage.set'
    ])
  })

  it('reports a capability added by an update, and one dropped by it', () => {
    const wider = manifest({ permissions: ['storage.get', 'ai.chat'] })
    expect(diffDeclaredSets(manifest(), wider)).toEqual({ added: ['ai.chat'], addedOptional: [], removed: [] })
    // The reverse direction: `removed` must be more than a constant `[]`.
    expect(diffDeclaredSets(wider, manifest()).removed).toEqual(['ai.chat'])
  })

  it('treats promoting an optional leaf to required as newly required', () => {
    // Design §6.0.1 pins this: promotion removes the user's ability to revoke it. Diffing
    // the arrays FLATTENED hides it, turning promotion into a way around the install gate.
    const before = manifest({ permissions: [], optionalPermissions: ['notification.show'] })
    const after = manifest({ permissions: ['notification.show'], optionalPermissions: [] })
    expect(diffDeclaredSets(before, after).added).toEqual(['notification.show'])
  })

  it('does not let a newly OFFERED optional leaf block the update', () => {
    // The other half. An added optional permission is shown, never blocking: declining it
    // just means not granted, and the update still goes through (§6.0.1).
    const after = manifest({ optionalPermissions: ['notification.show'] })
    expect(diffDeclaredSets(manifest(), after)).toMatchObject({ added: [], addedOptional: ['notification.show'] })
  })

  it('keeps a newly declared domain out of the grant diff but reports it as an added host', () => {
    // Both halves matter: a host must not become a grant row, and it must still stop the
    // update. Asserting only the first would certify silent exfiltration as correct.
    // Both carry `network.fetch`: the schema refuses hosts without it, and it must be an
    // UNCHANGED grant so the diff cannot be explained by the permission instead of the host.
    const before = manifest({ permissions: ['storage.get', 'network.fetch'], network: ['good.com'] })
    const after = manifest({ permissions: ['storage.get', 'network.fetch'], network: ['good.com', 'evil.com'] })
    expect(diffDeclaredSets(before, after).added).toEqual([])
    expect(diffDeclaredHosts(before, after)).toEqual(['evil.com'])
  })

  it('reports nothing added when the declared set is unchanged', () => {
    expect(diffDeclaredSets(manifest(), manifest()).added).toEqual([])
  })

  it('does NOT report a user-revoked permission as newly added', () => {
    // The bug this guards: comparing against current grants would flag `storage`
    // as new after the user revoked it, and re-granting would undo the revocation.
    insertApp()
    grantMiniAppPermissions(APP_ID, ['storage.get'], '1.0.0')
    revokeGrant(APP_ID, 'storage.get')

    expect(diffDeclaredSets(manifest(), manifest()).added).toEqual([])
  })

  it('keeps a revoked permission revoked after an unchanged update', () => {
    insertApp()
    grantMiniAppPermissions(APP_ID, ['storage.get'], '1.0.0')
    revokeGrant(APP_ID, 'storage.get')

    grantMiniAppPermissions(APP_ID, diffDeclaredSets(manifest(), manifest()).added, '1.1.0')

    expect(listGrants(APP_ID)).toEqual([])
  })

  it('throws PermissionDeniedError for an ungranted capability', () => {
    insertApp()
    grantMiniAppPermissions(APP_ID, ['storage.get'], '1.0.0')
    expect(() => assertGranted(APP_ID, 'storage.get')).not.toThrow()
    expect(() => assertGranted(APP_ID, 'ai.chat')).toThrow(PermissionDeniedError)
  })

  it('allows an introspection method once any sibling is granted', () => {
    // `storage.usage` is not declarable and not revocable: refusing it would not
    // narrow what the app can reach, only make it write blind until QuotaExceeded.
    insertApp()
    grantMiniAppPermissions(APP_ID, ['storage.set'], '1.0.0')

    expect(() => assertMethodAllowed(APP_ID, 'storage.usage')).not.toThrow()
  })

  it('refuses an introspection method when the whole namespace is ungranted', () => {
    insertApp()
    grantMiniAppPermissions(APP_ID, ['file.save'], '1.0.0')

    expect(() => assertMethodAllowed(APP_ID, 'storage.usage')).toThrow(PermissionDeniedError)
  })

  it('does not let one leaf imply its siblings', () => {
    // The bug this guards: collapsing back to namespace-wide permissions. Holding
    // `storage.get` must not confer `storage.delete`.
    insertApp()
    grantMiniAppPermissions(APP_ID, ['storage.get'], '1.0.0')

    expect(() => assertMethodAllowed(APP_ID, 'storage.delete')).toThrow(PermissionDeniedError)
    // The positive control, through THIS gate: `assertGranted` passing proves nothing
    // about the `grant` branch, and a gate that refuses everything passes the line above.
    expect(() => assertMethodAllowed(APP_ID, 'storage.get')).not.toThrow()
  })

  it('lets an ungated environment read through with no grants at all', () => {
    insertApp()
    expect(() => assertMethodAllowed(APP_ID, 'app.getInfo')).not.toThrow()
  })

  it('expands a wildcard once, at consent — never at call time', () => {
    // Why wildcards are authoring shorthand only: a stored `storage.*` keeps matching
    // methods Cherry adds later, widening a grant given against a smaller list.
    insertApp()
    grantMiniAppPermissions(APP_ID, declaredGrantKeys(manifest({ permissions: ['storage.*'] })), '1.0.0')

    expect(listGrants(APP_ID)).not.toContain('storage.*')
    expect(listGrants(APP_ID)).toContain('storage.delete')
  })

  it('surfaces a leaf that only exists because Cherry added a method', () => {
    // The app declared `storage.*` back when the namespace was smaller.
    const m = manifest({ permissions: ['storage.*'] })
    const consentedBack_then = ['storage.get', 'storage.set']

    expect(pendingDeclaredAdditions(APP_ID, m, consentedBack_then)).toEqual(['storage.delete', 'storage.keys'])
  })

  it('does NOT surface a permission the user revoked', () => {
    // The bug this guards: diffing against current grants. A revoked leaf is still
    // in the consented set, so it must not come back as "newly available".
    insertApp()
    const m = manifest({ permissions: ['storage.*'] })
    const consented = declaredGrantKeys(m)
    grantMiniAppPermissions(APP_ID, consented, '1.0.0')
    revokeGrant(APP_ID, 'storage.delete')

    expect(pendingDeclaredAdditions(APP_ID, m, consented)).toEqual([])
  })

  it('surfaces nothing for an app that declared only leaves', () => {
    const m = manifest({ permissions: ['storage.get'] })
    expect(pendingDeclaredAdditions(APP_ID, m, ['storage.get'])).toEqual([])
  })

  it('throws again after a grant is revoked', () => {
    insertApp()
    grantMiniAppPermissions(APP_ID, ['storage.get'], '1.0.0')
    revokeGrant(APP_ID, 'storage.get')
    expect(() => assertGranted(APP_ID, 'storage.get')).toThrow(PermissionDeniedError)
  })

  it('restores exactly the recorded set, dropping anything granted since', () => {
    insertApp()
    grantMiniAppPermissions(APP_ID, ['storage.get', 'ai.chat'], '1.1.0')

    replaceGrants(APP_ID, ['storage.get'], '1.0.0')

    expect(listGrants(APP_ID)).toEqual(['storage.get'])
  })

  it('restoring an empty set revokes everything', () => {
    insertApp()
    grantMiniAppPermissions(APP_ID, ['storage.get'], '1.0.0')

    replaceGrants(APP_ID, [], '1.0.0')

    expect(listGrants(APP_ID)).toEqual([])
  })
})
