/**
 * Mini app package manifest — the author-authored contract at the archive root.
 * Shared because the install UI previews exactly what main validates.
 */

import { valid as semverValid } from 'semver'
import * as z from 'zod'

import { MINI_APP_MAX_INPUT_BYTES, MINI_APP_MAX_MESSAGES } from './miniAppQuota'

/** Reserved package-root directory; the runtime serves host assets there. */
export const MINI_APP_RESERVED_DIR = '__cherry'

/**
 * The custom scheme. Lives here rather than in `protocol.ts` because the installer
 * builds `cherry-miniapp://<id>/<entry>` URLs long before the protocol handler
 * exists, and the renderer matches on it too — putting it in the handler module
 * forces earlier tasks to import a later one.
 */
export const MINI_APP_SCHEME = 'cherry-miniapp'

/**
 * Every bridge method and how it is gated. THE single source — the manifest schema,
 * the consent card and the runtime check all read this table, so a method cannot
 * exist without a stated gate.
 *
 * - `grant`   — needs its own leaf grant. Declarable, revocable.
 * - `sibling` — allowed as soon as ANY leaf in the same namespace is granted; not
 *   declarable and not separately revocable. These are introspection calls, and
 *   revoking one does not narrow what the app can reach — it only blinds it. An app
 *   without `storage.usage` writes until it hits QuotaExceeded; an app without
 *   `ai.getCapabilities` cannot degrade when the user swaps the model, which is the
 *   exact crash that method exists to prevent. A permission with no protected object
 *   and a real destructive effect is not a permission.
 * - `none`    — environment reads, no gate at all.
 */
export const MINI_APP_METHODS = {
  'app.getInfo': { gate: 'none' },
  // `none`: it reports the caller's OWN grant state, so there is nothing to protect —
  // gating it would only leave an app blind to which optional permissions it has.
  'app.getPermissions': { gate: 'none' },

  'ai.chat': { gate: 'grant' },
  'ai.getCapabilities': { gate: 'sibling' },
  // `none`, not `sibling`: stopping your own call is not a capability, and gating it
  // would make "stop spending my money" harder to reach than starting to spend it.
  'ai.cancel': { gate: 'none' },

  'storage.get': { gate: 'grant' },
  'storage.set': { gate: 'grant' },
  'storage.delete': { gate: 'grant' },
  'storage.keys': { gate: 'grant' },
  'storage.usage': { gate: 'sibling' },

  'file.save': { gate: 'grant' },
  'file.load': { gate: 'grant' },
  'file.list': { gate: 'grant' },
  'file.delete': { gate: 'grant' },
  'file.usage': { gate: 'sibling' },
  // `grant`, although every export also passes a save dialog: the dialog consents to ONE
  // file, the grant is what lets the user stop an app that keeps asking.
  'file.export': { gate: 'grant' },

  'notification.show': { gate: 'grant' },

  // Both directions gated, and both refused unless the guest has keyboard focus: a
  // background app reading what the user copied elsewhere, or swapping what they are
  // about to paste, is the clipboard's classic abuse.
  'clipboard.read': { gate: 'grant' },
  'clipboard.write': { gate: 'grant' },

  // The revocable half of networking. `manifest.network` is the other half — the scope —
  // and it is not a grant: nothing can revoke one host, so it never reaches this table.
  'network.fetch': { gate: 'grant' }
} as const satisfies Record<string, { gate: 'none' | 'grant' | 'sibling' }>

export type MiniAppMethod = keyof typeof MINI_APP_METHODS

/** The declarable, revocable leaves — derived, never written out a second time. */
export const MINI_APP_PERMISSIONS = Object.entries(MINI_APP_METHODS)
  .filter(([, m]) => m.gate === 'grant')
  .map(([name]) => name)
  .sort() as MiniAppPermission[]

export type MiniAppPermission = MiniAppMethod

export const MINI_APP_NAMESPACES = [...new Set(MINI_APP_PERMISSIONS.map((p) => p.split('.')[0]))].sort()

/**
 * A manifest entry: one leaf (`file.delete`) or one namespace (`file.*`).
 *
 * The wildcard is AUTHORING SHORTHAND ONLY. It is expanded at consent time and never
 * stored, because a stored wildcard would keep matching methods Cherry adds later —
 * the host quietly widening a grant the user gave years ago, which is the same
 * failure as an update growing its permissions, only with us as the author.
 */
export const PermissionDeclarationSchema = z
  .string()
  .refine(
    (p) =>
      MINI_APP_PERMISSIONS.includes(p as MiniAppPermission) ||
      (MINI_APP_NAMESPACES.includes(p.replace(/\.\*$/, '')) && p.endsWith('.*')),
    'must be a known method (e.g. "file.save") or namespace wildcard (e.g. "file.*")'
  )

/** Wildcards → leaves. `sibling` and `none` methods are never included: they are not grantable. */
export function expandPermissions(declared: readonly string[]): MiniAppPermission[] {
  const out = new Set<MiniAppPermission>()
  for (const entry of declared) {
    if (entry.endsWith('.*')) {
      const ns = entry.slice(0, -2)
      for (const p of MINI_APP_PERMISSIONS) if (p.startsWith(`${ns}.`)) out.add(p)
    } else {
      out.add(entry as MiniAppPermission)
    }
  }
  return [...out].sort()
}

/**
 * Size ceilings. All four are enforced BEFORE the corresponding allocation, so
 * each one bounds memory rather than merely reporting on it afterwards.
 *
 * The archive limit is deliberately lower than the extracted limit: compression is
 * the attacker's lever, and a package that unpacks to twice its shipped size is
 * normal while one that unpacks to a thousand times it is not.
 */
export const MINI_APP_MAX_PACKAGE_BYTES = 50 * 1024 * 1024
export const MINI_APP_MAX_EXTRACTED_BYTES = 100 * 1024 * 1024
export const MINI_APP_MAX_MANIFEST_BYTES = 256 * 1024
/** Icon ENTRY cap: the total cap admits one 100 MB entry, and the icon is read whole. */
export const MINI_APP_MAX_ICON_BYTES = 5 * 1024 * 1024

/**
 * The id occupies the URL host position, so it follows RFC 3986 host syntax.
 * Chromium lowercases hosts — two ids differing only in case would collapse
 * onto one origin and silently share storage.
 */
/**
 * Windows device names, reserved EVEN WITH AN EXTENSION — `CON.txt` is as invalid as
 * `CON`. Windows judges by the segment before the first dot, and the appId is used
 * verbatim as an install directory name and as `<appId>.json`, so only the FIRST label
 * matters: `com.example.con` is fine, `con.example.app` is not.
 *
 * Reverse-DNS makes such ids look completely ordinary, and the failure surfaces as a
 * mkdir error mentioning neither Windows nor the appId.
 */
const WINDOWS_RESERVED = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  ...Array.from({ length: 10 }, (_, i) => `com${i}`),
  ...Array.from({ length: 10 }, (_, i) => `lpt${i}`)
])

export const MiniAppIdSchema = z
  .string()
  .max(120)
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/, 'invalid mini app id')
  .refine((id) => !WINDOWS_RESERVED.has(id.split('.')[0]), 'id starts with a Windows reserved device name')

/**
 * The official namespace. `com.cherrystudio.*` as a whole is reserved; official mini
 * apps live under `com.cherrystudio.miniapp.*`.
 *
 * The prefix is NOT enforced here. This schema has no idea where the package came
 * from, and it is also reused to parse journal filenames and uninstall arguments —
 * rejecting the prefix at this layer would make a LEGITIMATE builtin app's journal
 * unparseable. The installer applies the rule once it knows the `source`.
 */
export const MINI_APP_OFFICIAL_ID_PREFIX = 'com.cherrystudio.'
export const MINI_APP_BUILTIN_ID_PREFIX = 'com.cherrystudio.miniapp.'

/**
 * Origins whose packages may claim the official namespace.
 *
 * SINGLE-TENANT ORIGINS ONLY. An origin is scheme + host + port with no path
 * (RFC 6454), so a shared host puts every other tenant inside the trust boundary and
 * the "an update may not change its origin" rule then protects nothing — same origin,
 * different author. `https://github.com/CherryHQ/` cannot be an entry for that reason,
 * and separately because fetching anything downloadable from github.com redirects
 * (raw./objects.githubusercontent.com) while this design uses `redirect: 'error'`.
 * A per-org GitHub Pages subdomain would qualify; a shared host needs a signed
 * package, which is deliberately out of scope.
 *
 * Compile-time constant on purpose: a trust anchor the user can edit is not one.
 */
export const MINI_APP_OFFICIAL_ORIGINS = ['https://cherryai.com'] as const

// Defined in `miniAppQuota` (no zod/semver) so the guest preload stays small; re-exported
// here so every existing consumer keeps its import path.
export { MINI_APP_MAX_INPUT_BYTES, MINI_APP_MAX_MESSAGES }

/** Lowercase hex SHA-256. Shared by `package.sha256` and `icon.sha256`. */
const Sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/)

const PackageRelativePathSchema = z
  .string()
  .min(1)
  .refine((p) => !p.startsWith('/') && !p.includes('\\'), 'must be a package-relative POSIX path')
  .refine((p) => !p.split('/').includes('..'), 'must not traverse outside the package')
  .refine(
    (p) => p.split('/')[0] !== MINI_APP_RESERVED_DIR,
    `must not use the reserved '${MINI_APP_RESERVED_DIR}' directory`
  )

/**
 * A user-visible manifest string: one value for every locale, or a per-locale table.
 *
 * At least one of `en` / `zh` must be present. That requirement is what makes
 * resolution TOTAL: every fallback chain terminates at one of those two, so a locale
 * the author never wrote always has a defined answer instead of an invented one. Any
 * further language is optional — an author writing only for one audience should not
 * be forced to machine-translate, because a forced field produces a placeholder, not
 * a translation.
 */
function localizedText(max: number) {
  const value = z.string().min(1).max(max)
  return z.union([
    value,
    z
      .object({ en: value.optional(), zh: value.optional() })
      .catchall(value)
      .refine((t) => t.en !== undefined || t.zh !== undefined, {
        message: 'a localized field must provide at least one of "en" or "zh"'
      })
      // The per-value cap bounds ONE string; without this a manifest carries hundreds of
      // locales in the same byte budget, each a row the update preview must diff.
      .refine((t) => Object.keys(t).length <= 20, 'too many locales')
  ])
}

export const LocalizedNameSchema = localizedText(64)
/**
 * 200 characters: two or three sentences. Long enough to say what the app does and
 * why it wants what it declares; short enough that the consent card can render it
 * whole, without truncation logic that would hide the second half of a sentence
 * beginning "this app also…".
 */
export const LocalizedDescriptionSchema = localizedText(200)
/**
 * 500 characters — a handful of bullet points, not a blog post.
 *
 * This is AUTHOR-SUPPLIED prose rendered in the dialog where the user decides whether to
 * accept new permissions, i.e. a social-engineering surface ("fixes a crash — please
 * approve all permissions, the system requires it"). Three rules follow, and the cap is
 * the weakest of them: plain text only (no markdown links, no HTML), and the panel puts
 * it BELOW the permission diff so a long one can never push the list out of view.
 */
export const LocalizedReleaseNotesSchema = localizedText(500)

export type LocalizedText = z.infer<typeof LocalizedNameSchema>

/**
 * Resolves as: the full locale → its language subtag → `en` → `zh`.
 *
 * The language-segment step is what lets an author write `zh` once and cover
 * `zh-CN` / `zh-TW` / `zh-HK`. Traditional Chinese therefore shows the Simplified
 * value when only `zh` exists — deliberately: mapping script variants is Cherry's
 * own i18n problem, and a second mapping table here would be a parallel mechanism
 * that drifts from the first one.
 *
 * The last two steps never both miss, because the schema demands one of them.
 */
export function resolveLocalizedText(text: LocalizedText, locale: string): string {
  if (typeof text === 'string') return text
  const table = text as Record<string, string | undefined>
  return table[locale] ?? table[locale.split('-')[0]] ?? table.en ?? table.zh!
}

/**
 * Bare hostname only: a scheme or path would make allowlist matching ambiguous. A last
 * label that is a number is refused here rather than at runtime — that is WHATWG's
 * "ends in a number" rule, so the URL parser reads such a host as an IPv4 address and
 * `network.fetch` refuses every request to it. Accepting it at install would promise
 * access the host can never grant.
 */
const HostnameSchema = z
  .string()
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/, 'must be a bare hostname')
  .refine((host) => !/(^|\.)(\d+|0x[0-9a-f]*)$/.test(host), 'must be a hostname, not an IP address')

export const MiniAppManifestSchema = z
  .object({
    id: MiniAppIdSchema,
    name: LocalizedNameSchema,
    /**
     * REQUIRED. The consent card is where a user decides whether this package may use
     * AI, read and write files, and reach the network — and until now that card showed
     * a name and a permission list with nothing saying what the app is FOR. A
     * permission prompt without a purpose is not a decision, it is a formality.
     */
    description: LocalizedDescriptionSchema,
    /**
     * Semver, because "is this newer" has to be decidable. A plain string makes the
     * update check compare lexicographically — `1.10.0 < 1.9.0` — and gives a server no
     * reason not to push a downgrade. `semver` is already a repo dependency (rtk.ts,
     * versionPolicy.ts, BinaryManager.ts); the comparison is never hand-written.
     */
    version: z
      .string()
      .max(32)
      .refine((v) => semverValid(v) !== null, 'version must be valid semver'),
    entry: PackageRelativePathSchema,
    /**
     * What changed in THIS version. Optional; a history array is deliberately not offered —
     * it would grow without bound inside every package, and the reader only ever wants
     * "what is new since the one I have".
     */
    releaseNotes: LocalizedReleaseNotesSchema.optional(),
    /**
     * Icon path AND the digest of its bytes — both or neither.
     *
     * The digest is not belt-and-braces, it is what makes an icon change VISIBLE at
     * check time. `checkForUpdate` only has the two manifests; comparing paths alone
     * misses `icon.png -> icon.png` with different bytes, which is the ordinary way to
     * change an app's face and exactly the swap design §6.5 requires the update preview
     * to show. Verified against the real bytes at install and at update, so a manifest
     * that lies about it is rejected as a tampered package rather than believed.
     */
    icon: z.object({ path: PackageRelativePathSchema, sha256: Sha256HexSchema }).optional(),
    /** Required. Consent is all-or-nothing at install: agree, or the package is not installed. */
    permissions: z.array(PermissionDeclarationSchema).max(32).default([]),
    /** Optional. Shown on the same card but NOT granted by default; revocable afterwards. */
    optionalPermissions: z.array(PermissionDeclarationSchema).max(32).default([]),
    /**
     * Bounded and DEDUPED, because the total manifest cap bounds transport, not structure.
     * A legal 256 KB manifest holds thousands of hosts, and each one becomes a line in the
     * consent card and the detail panel — the failure is an
     * unreadable permission list, not a slow one.
     *
     * Duplicates are REJECTED rather than silently collapsed: silently collapsing leaves
     * the author believing something took effect.
     */
    network: z
      .array(HostnameSchema)
      .max(20)
      .refine((hosts) => new Set(hosts).size === hosts.length, 'network hosts must be unique')
      .default([]),
    /**
     * Where the host checks for updates. `urlCn` is an OPTIONAL China accelerator serving
     * the same bytes; when present, `mirrorOrder` prefers it for users in China and falls
     * back to `url`. Every declared origin is pinned at install (design §10.1). A purely
     * local package has no `update` block at all and downloads nothing.
     */
    update: z.object({ url: z.url(), urlCn: z.url().optional() }).optional()
  })
  .superRefine((m, ctx) => {
    // AFTER expansion: `["storage.*"]` plus `["storage.get"]` does not overlap
    // textually but does in effect — the easy way to pass a required one off as optional.
    const required = new Set(expandPermissions(m.permissions))
    const optional = expandPermissions(m.optionalPermissions)
    const both = optional.filter((p) => required.has(p))
    if (both.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['optionalPermissions'],
        message: `also declared as required: ${both.join(', ')}`
      })
    }

    /*
     * Hosts and the network capability must be declared together — either is useless
     * alone, so one without the other is an authoring mistake, and catching it at pack
     * time beats letting the user puzzle over an app that silently cannot connect.
     *
     * Tested on the NAMESPACE, never by naming `network.fetch`: the day a second
     * `network.*` method exists, a check that names the method stops firing and says
     * nothing about it.
     */
    const canReachNetwork = [...required, ...optional].some((p) => p.startsWith('network.'))
    if (m.network.length > 0 && !canReachNetwork) {
      ctx.addIssue({
        code: 'custom',
        path: ['network'],
        message: 'declares hosts but no `network.*` permission to reach them'
      })
    }
    if (m.network.length === 0 && canReachNetwork) {
      ctx.addIssue({
        code: 'custom',
        path: ['permissions'],
        message: 'declares a `network.*` permission but no hosts to use it on'
      })
    }
  })

export type MiniAppManifest = z.infer<typeof MiniAppManifestSchema>

/**
 * The manifest served at `update.url` — the packaged one plus where the bytes are.
 *
 * `package` is NOT in `MiniAppManifestSchema` because that one lives at the archive
 * root: its `sha256` is the hash of the archive containing it, so writing the value
 * changes the value. The field is producible only outside the archive.
 */
export const MiniAppDistributionManifestSchema = MiniAppManifestSchema.safeExtend({
  /**
   * REQUIRED here, `.optional()` in the packaged schema — and that difference is the whole
   * point. A purely local package legitimately has no update block; one SERVED over the
   * network without an endpoint has nowhere to be checked against.
   */
  update: z.object({ url: z.url(), urlCn: z.url().optional() }),
  package: z.object({
    url: z.url(),
    /** Optional accelerator; one hash for both, so which mirror served the bytes is irrelevant. */
    urlCn: z.url().optional(),
    /**
     * Where the consent card can fetch the icon BEFORE the package downloads. Verified
     * against `icon.sha256` — the same digest the packaged icon must match at install —
     * so the card never shows a face the package does not carry.
     */
    iconUrl: z.url().optional(),
    sha256: Sha256HexSchema,
    // Bounded HERE, not only at the download site: a declared size over the cap must
    // be refused before anything acts on it.
    size: z.int().positive().max(MINI_APP_MAX_PACKAGE_BYTES)
  })
}).superRefine((m, ctx) => {
  // Both-or-neither: a package mirror needs the update mirror's origin to be pinned to,
  // and an update mirror with no package mirror leaves Chinese users downloading globally.
  if ((m.update.urlCn === undefined) !== (m.package.urlCn === undefined)) {
    ctx.addIssue({
      code: 'custom',
      path: ['package', 'urlCn'],
      message: '`update.urlCn` and `package.urlCn` must be declared together'
    })
  }
  if (m.package.iconUrl !== undefined && m.icon === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['package', 'iconUrl'],
      message: '`package.iconUrl` needs `icon.sha256` to be verified against'
    })
  }
})

export type MiniAppDistributionManifest = z.infer<typeof MiniAppDistributionManifestSchema>

/**
 * The grant keys a manifest asks for, split by whether the user may say no.
 *
 * Hosts are NOT here. A host is the SCOPE of the network permission, not a permission of
 * its own: nothing can revoke one individually, and an unrevokable "permission" is just a
 * parameter. The allowlist is read straight off `manifest.network`; `diffDeclaredHosts`
 * is what keeps an ADDED host asking for consent.
 *
 * Everything downstream — consent, the grant table, the update diff — works in leaves.
 * Nothing but `expandPermissions` ever sees a `*`.
 */
export interface DeclaredGrants {
  required: MiniAppPermission[]
  optional: MiniAppPermission[]
}

export function declaredGrants(manifest: MiniAppManifest): DeclaredGrants {
  return {
    required: expandPermissions(manifest.permissions),
    optional: expandPermissions(manifest.optionalPermissions)
  }
}

/** Everything declared, either way — answers "is this declared at all" and nothing finer. */
export function declaredGrantKeys(manifest: MiniAppManifest): string[] {
  const { required, optional } = declaredGrants(manifest)
  return [...required, ...optional].sort()
}
