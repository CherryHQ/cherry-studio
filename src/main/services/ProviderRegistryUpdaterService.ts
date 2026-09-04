import {
  type CatalogManifest,
  CatalogManifestSchema,
  isCatalogManifestCompatible,
  ModelListSchema,
  ProviderModelListSchema,
  REGISTRY_SCHEMA_VERSION,
  REMOTE_REGISTRY_FILES,
  type RemoteRegistryFileName
} from '@cherrystudio/provider-registry/node'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { notifyDataApiDataChange } from '@main/data/dataApiDataChange'
import { providerRegistryService } from '@main/data/services/ProviderRegistryService'
import { readActiveOverrideManifest } from '@main/data/services/utils/registryDataPaths'
import { writeProviderRegistrySnapshot } from '@main/services/providerRegistrySnapshot'
import { regionService } from '@main/services/RegionService'
import { generateUserAgent } from '@main/utils/systemInfo'
import type { DataApiDataChangeEffect } from '@shared/data/api/types'
import { app, net } from 'electron'

const logger = loggerService.withContext('ProviderRegistryUpdaterService')

// Remote source of the regenerated catalog. Pinned to a stable branch (not a
// moving `main`), under a schema-version dir so a structurally-breaking schema
// change can't reach older clients: an app only ever fetches the `v{N}` its
// bundled schema understands. Zod validation on download is the second line of
// defence, fallback-to-bundled the third. The `x-files/*` branch matches
// x-files/app-upgrade-config so the same GitCode repo mirror serves CN clients.
const REMOTE_BRANCH = 'x-files/provider-registry'
const REMOTE_SUBPATH = `v${REGISTRY_SCHEMA_VERSION}`
export const REGISTRY_URL_GITHUB = `https://raw.githubusercontent.com/CherryHQ/cherry-studio/refs/heads/${REMOTE_BRANCH}/${REMOTE_SUBPATH}`
export const REGISTRY_URL_GITCODE = `https://raw.gitcode.com/CherryHQ/cherry-studio/raw/${encodeURIComponent(REMOTE_BRANCH)}/${REMOTE_SUBPATH}`

const MANIFEST_FILE = 'manifest.json'

// Validators keyed by file — the SAME schemas RegistryLoader validates with on
// read, so an accepted download is guaranteed loadable. Typed structurally
// (only `version` is read here) to sidestep the schemas' distinct outputs.
const SCHEMA_BY_FILE: Record<RemoteRegistryFileName, { parse: (data: unknown) => { version: string } }> = {
  'models.json': ModelListSchema,
  'provider-models.json': ProviderModelListSchema
}

const REGISTRY_DATA_CHANGE_EFFECTS = [
  { endpoint: '/models', kind: 'projection' },
  { endpoint: '/models/:uniqueModelId*' },
  { endpoint: '/providers/:providerId/preset' },
  { endpoint: '/providers/:providerId/models:resolve', kind: 'membership' },
  { endpoint: '/providers/:providerId/models/:modelId*/image-generation-support' }
] satisfies DataApiDataChangeEffect[]

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
// Short delay before the first check, letting boot I/O settle. registerInterval
// only fires after one full interval, so the initial pull is scheduled separately.
const INITIAL_CHECK_DELAY_MS = 30_000

interface StagedFile {
  file: RemoteRegistryFileName
  body: string
  version: string
}

/**
 * Downloads remote-safe model metadata from the pinned branch. Provider routing
 * remains bundled because unsigned data must never control credential destinations.
 *
 * Existing model projections hot-reload in mounted renderers. Brand-new catalog
 * models enter SQLite only through the existing explicit provider-model sync;
 * this background service never writes business rows.
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

  /** Run one update cycle: fetch → compatibility+revision validate → apply → notify. Never throws. */
  public async check(): Promise<void> {
    try {
      const result = await this.fetchAndValidate()
      if (!result) return
      const { staged, manifest, manifestBody } = result
      const currentManifest = readActiveOverrideManifest()
      if (!this.hasChanges(staged) && (!currentManifest || currentManifest.revision === manifest.revision)) {
        logger.debug('registry update: catalog already current')
        return
      }
      const files = Object.fromEntries(staged.map((s) => [s.file, s.body])) as Record<RemoteRegistryFileName, string>
      await writeProviderRegistrySnapshot(files, manifestBody)
      notifyDataApiDataChange(REGISTRY_DATA_CHANGE_EFFECTS)
      logger.info(`registry update: applied ${staged.map((s) => `${s.file}@${s.version}`).join(', ')}`)
    } catch (error) {
      logger.warn('registry update: cycle failed', error as Error)
    }
  }

  /**
   * Fetch and validate the manifest + remote-safe files. Returns `null` when
   * compatibility, monotonic revision, download, or validation checks fail.
   */
  private async fetchAndValidate(): Promise<{
    staged: StagedFile[]
    manifest: CatalogManifest
    manifestBody: string
  } | null> {
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

    const manifestBody = await fetchText(MANIFEST_FILE)
    if (manifestBody === null) return null
    const manifest = this.parseManifest(manifestBody)
    if (!manifest) return null
    if (!isCatalogManifestCompatible(manifest, app.getVersion())) {
      logger.warn('registry update: manifest is not compatible with this application version, skipping')
      return null
    }
    const activeManifest = readActiveOverrideManifest()
    if (activeManifest && manifest.revision <= activeManifest.revision) {
      logger.debug(
        `registry update: remote revision ${manifest.revision} is not newer than active revision ${activeManifest.revision}, skipping`
      )
      return null
    }

    const staged: StagedFile[] = []
    for (const file of REMOTE_REGISTRY_FILES) {
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
    return { staged, manifest, manifestBody }
  }

  private parseManifest(manifestBody: string): CatalogManifest | null {
    try {
      return CatalogManifestSchema.parse(JSON.parse(manifestBody))
    } catch {
      logger.warn('registry update: manifest malformed, skipping')
      return null
    }
  }

  /** True if any downloaded file's version differs from what the data layer currently reports. */
  private hasChanges(staged: StagedFile[]): boolean {
    return staged.some(({ file, version }) => version !== providerRegistryService.getCatalogVersion(file))
  }

  private parseVersion(file: RemoteRegistryFileName, jsonText: string): string {
    return SCHEMA_BY_FILE[file].parse(JSON.parse(jsonText)).version
  }
}
