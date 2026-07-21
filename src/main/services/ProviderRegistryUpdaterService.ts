import {
  type CatalogManifest,
  CatalogManifestSchema,
  ModelListSchema,
  ProviderListSchema,
  ProviderModelListSchema,
  REGISTRY_FILES,
  REGISTRY_SCHEMA_VERSION,
  type RegistryFileName
} from '@cherrystudio/provider-registry/node'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { providerRegistryService } from '@main/data/services/ProviderRegistryService'
import { regionService } from '@main/services/RegionService'
import { generateUserAgent } from '@main/utils/systemInfo'
import { app, net } from 'electron'
import semver from 'semver'

const logger = loggerService.withContext('ProviderRegistryUpdaterService')

// Remote source of the regenerated catalog. Pinned to a stable branch (not a
// moving `main`), under a schema-version dir so a structurally-breaking schema
// change can't reach older clients: an app only ever fetches the `v{N}` its
// bundled schema understands. Zod validation on download is the second line of
// defence, fallback-to-bundled the third. The `x-files/*` branch matches
// x-files/app-upgrade-config so the same GitCode repo mirror serves CN clients.
const REMOTE_BRANCH = 'x-files/provider-registry'
const REMOTE_SUBPATH = `v${REGISTRY_SCHEMA_VERSION}`
const REGISTRY_URL_GITHUB = `https://raw.githubusercontent.com/CherryHQ/cherry-studio/refs/heads/${REMOTE_BRANCH}/${REMOTE_SUBPATH}`
const REGISTRY_URL_GITCODE = `https://raw.gitcode.com/CherryHQ/cherry-studio/raw/${encodeURIComponent(REMOTE_BRANCH)}/${REMOTE_SUBPATH}`

// Manifest published alongside the catalog. `releaseFloor` is the app release the
// remote data was generated for; a client refuses data whose floor is older than
// its own version so a lagging mirror can never downgrade below the bundled data.
const MANIFEST_FILE = 'manifest.json'

// Validators keyed by file — the SAME schemas RegistryLoader validates with on
// read, so an accepted download is guaranteed loadable. Typed structurally
// (only `version` is read here) to sidestep the three schemas' distinct outputs.
const SCHEMA_BY_FILE: Record<RegistryFileName, { parse: (data: unknown) => { version: string } }> = {
  'models.json': ModelListSchema,
  'providers.json': ProviderListSchema,
  'provider-models.json': ProviderModelListSchema
}

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
// Short delay before the first check, letting boot I/O settle. registerInterval
// only fires after one full interval, so the initial pull is scheduled separately.
const INITIAL_CHECK_DELAY_MS = 30_000

interface StagedFile {
  file: RegistryFileName
  body: string
  version: string
}

/**
 * Downloads the regenerated provider/model catalog from the pinned remote branch
 * and shadows the bundled JSON via the `feature.provider_registry.override` dir —
 * so new preset models reach running apps without an app release.
 *
 * Models & provider-model overrides hot-reload immediately (loader cache is
 * cleared). New *providers* are DB-seeded and only appear after the next restart
 * (the seeder re-runs on a version bump, reading the same override).
 */
@Injectable('ProviderRegistryUpdaterService')
@ServicePhase(Phase.WhenReady)
export class ProviderRegistryUpdaterService extends BaseService {
  protected onReady(): void {
    // Dev/test never auto-download — an override under userData would silently
    // shadow the source catalog a developer just regenerated. `check()` is still
    // callable directly for manual/test runs.
    if (!app.isPackaged) return

    this.registerInterval(() => this.check(), CHECK_INTERVAL_MS)

    const initial = setTimeout(() => void this.check(), INITIAL_CHECK_DELAY_MS)
    initial.unref()
    this.registerDisposable(() => clearTimeout(initial))
  }

  /** Run one update cycle: fetch → floor+validate → (if changed) apply + hot-reload. Never throws. */
  public async check(): Promise<void> {
    try {
      const result = await this.fetchAndValidate()
      if (!result) return
      const { staged, manifestBody } = result
      if (!this.hasChanges(staged)) {
        logger.debug('registry update: catalog already current')
        return
      }
      const files = Object.fromEntries(staged.map((s) => [s.file, s.body])) as Record<RegistryFileName, string>
      await providerRegistryService.applyOverride(files, manifestBody)
      logger.info(`registry update: applied ${staged.map((s) => `${s.file}@${s.version}`).join(', ')}`)
    } catch (error) {
      logger.warn('registry update: cycle failed', error as Error)
    }
  }

  /**
   * Fetch and validate the manifest + all three files. Returns `null` (abort,
   * keep current data) if the manifest is older than this app, or if ANY file
   * fails to download or validate — never a partial set.
   */
  private async fetchAndValidate(): Promise<{ staged: StagedFile[]; manifestBody: string } | null> {
    const inCn = (await regionService.getCountry()).toLowerCase() === 'cn'
    const baseUrl = inCn ? REGISTRY_URL_GITCODE : REGISTRY_URL_GITHUB
    const headers = {
      'User-Agent': generateUserAgent(),
      'Cache-Control': 'no-cache',
      Accept: 'application/json'
    }
    const fetchText = async (name: string): Promise<string | null> => {
      try {
        const response = await net.fetch(`${baseUrl}/${name}`, { headers })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return await response.text()
      } catch (error) {
        logger.warn(`registry update: fetch failed for ${name}, skipping cycle`, error as Error)
        return null
      }
    }

    // Manifest first: a mirror lagging behind this app's release is rejected
    // before downloading the catalog, so stale data can never shadow the newer
    // bundled data an upgrade shipped with.
    const manifestBody = await fetchText(MANIFEST_FILE)
    if (manifestBody === null) return null
    const manifest = this.parseManifest(manifestBody)
    if (!manifest || !this.passesReleaseFloor(manifest.releaseFloor)) return null

    const staged: StagedFile[] = []
    for (const file of REGISTRY_FILES) {
      const body = await fetchText(file)
      if (body === null) return null
      let version: string
      try {
        version = this.parseVersion(file, body)
      } catch (error) {
        logger.warn(`registry update: ${file} failed validation, keeping current data`, error as Error)
        return null
      }
      // Bind the set to ONE published snapshot: the manifest records each file's
      // content-hash version. A mismatch means the movable `registry-data` branch
      // advanced mid-fetch and we pulled a cross-commit mixture — abort the cycle.
      if (version !== manifest.files[file]) {
        logger.warn(
          `registry update: ${file} digest mismatch (manifest ${manifest.files[file]} vs fetched ${version}) — cross-commit fetch, skipping`
        )
        return null
      }
      staged.push({ file, body, version })
    }
    return { staged, manifestBody }
  }

  private parseManifest(manifestBody: string): CatalogManifest | null {
    try {
      return CatalogManifestSchema.parse(JSON.parse(manifestBody))
    } catch {
      logger.warn('registry update: manifest malformed, skipping')
      return null
    }
  }

  /** Reject a remote catalog generated for a release older than this app (anti-downgrade). */
  private passesReleaseFloor(releaseFloor: string): boolean {
    const cleanFloor = semver.valid(semver.coerce(releaseFloor))
    if (!cleanFloor) {
      logger.warn('registry update: manifest missing a valid releaseFloor, skipping')
      return false
    }
    const appVersion = semver.coerce(app.getVersion())?.version ?? '0.0.0'
    if (!semver.gte(cleanFloor, appVersion)) {
      logger.debug(`registry update: remote floor ${cleanFloor} older than app ${appVersion}, skipping`)
      return false
    }
    return true
  }

  /** True if any downloaded file's version differs from what the data layer currently reports. */
  private hasChanges(staged: StagedFile[]): boolean {
    return staged.some(({ file, version }) => version !== providerRegistryService.getCatalogVersion(file))
  }

  private parseVersion(file: RegistryFileName, jsonText: string): string {
    return SCHEMA_BY_FILE[file].parse(JSON.parse(jsonText)).version
  }
}
