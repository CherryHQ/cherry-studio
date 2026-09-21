/**
 * Fork identity for The Boss.
 *
 * Every product name, filesystem namespace, and outbound identifier that
 * distinguishes this fork from upstream Cherry Studio resolves here, so a
 * rebrand touches one file instead of the whole tree — and upstream merges
 * conflict only here rather than at every literal.
 *
 * Keep this free of feature flags and edition logic. `CHERRY_EDITION`
 * (`global` | `cn`) is a separate, orthogonal axis.
 */

/** Display name shown in the app menu, window titles, and installers. */
export const PRODUCT_NAME = 'The Boss'

/** Reverse-DNS application identifier. Must match `appId` in electron-builder.yml. */
export const APP_ID = 'tools.know-me.the-boss'

/** Vendor shown to the OS, e.g. crash-report grouping. */
export const COMPANY_NAME = 'Know Me Tools'

/**
 * Filesystem namespace — a single path component used for the home directory,
 * temp directory, and OS-level window class.
 *
 * Changing this moves data on disk. It is consumed by preboot before the path
 * registry is frozen, so treat it as a data-migration decision, never a
 * cosmetic one.
 */
export const APP_SLUG = 'the-boss'

/**
 * Home directory name under `os.homedir()`; holds BootConfig, outside userData.
 *
 * Duplicated as `CHERRY_HOME_DIRNAME` in `@main/core/paths/constants`, which
 * loads before `app.whenReady()` and may not import business modules. Change
 * both together; `rebrand-003` owns the actual filesystem move.
 */
export const HOME_DIRNAME = `.${APP_SLUG}`

/**
 * Directory name for app-owned data under an OS root — `userData` beneath
 * `appData`, and the scratch directory beneath the system temp dir.
 *
 * Electron derives `userData` as `<appData>/<app name>` when nothing calls
 * `setPath`. Preboot sets it explicitly from this constant so the location is
 * pinned by configuration and cannot drift when the display name changes.
 * Kept space-free because it becomes a real directory on every platform.
 */
export const PRODUCT_DIRNAME = 'TheBoss'

/** Identifier sent to third-party AI providers for attribution. */
export const ATTRIBUTION_NAME = PRODUCT_NAME

/** Site sent as `HTTP-Referer` alongside {@link ATTRIBUTION_NAME}. */
export const ATTRIBUTION_URL = 'https://the-boss.know-me.tools'

/**
 * Fork-owned destinations.
 *
 * Only GitHub and the marketing site exist today: the-boss.know-me.tools is a
 * catch-all SPA, so every path returns the landing page. Docs, releases, and
 * issues therefore point at the repository, which has real per-path content,
 * rather than at a URL that would render as marketing copy.
 *
 * These deliberately do NOT cover Cherry-operated services the app still
 * consumes — CherryIN/CherryAI OAuth and provider endpoints keep their own
 * hosts, because repointing them would break working integrations.
 */
export const REPO_URL = 'https://github.com/Prometheus-AGS/the-boss'
export const WEBSITE_URL = ATTRIBUTION_URL
export const DOCS_URL = `${REPO_URL}#readme`
export const RELEASES_URL = `${REPO_URL}/releases`
export const ISSUES_URL = `${REPO_URL}/issues`
export const SUPPORT_EMAIL = 'support@know-me.tools'
