import type { ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline'

import { application } from '@application'
import { notifyDataApiDataChange } from '@data/dataApiDataChange'
import { modelService } from '@data/services/ModelService'
import { translateHistoryService } from '@data/services/TranslateHistoryService'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { isWin } from '@main/core/platform'
import { getProxyEnvironment } from '@main/services/proxy/proxyEnv'
import { regionService } from '@main/services/RegionService'
import { mergeBinaryExecutionEnv } from '@main/utils/binaryEnv'
import { getBinaryPath } from '@main/utils/binaryResolver'
import { crossPlatformSpawn, killProcessTree } from '@main/utils/processRunner'
import { getShellEnv } from '@main/utils/shellEnv'
import {
  toPersistedLangCodeOrNull,
  type TranslateLangCode,
  type TranslateSourceLanguage
} from '@shared/data/preference/preferenceTypes'
import { BABELDOC_TOOL_NAME, getBabelDocInstallationStatus } from '@shared/data/presets/binaryTools'
import { type FileEntry, SafeNameSchema } from '@shared/data/types/file'
import { parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { translateErrorCodes } from '@shared/ipc/errors/translate'
import {
  PDF_TRANSLATION_PROGRESS_STAGES,
  type PdfTranslationProgress,
  type PdfTranslationProgressStage,
  type PdfTranslationStage
} from '@shared/ipc/schemas/translate'
import { type AbsoluteFilePath, AbsoluteFilePathSchema } from '@shared/types/file'
import { formatGatewayModelId, gatewayClientOrigin } from '@shared/utils/apiGateway'
import { stringify as stringifyToml } from 'smol-toml'
import * as z from 'zod'

const logger = loggerService.withContext('PdfTranslationService')
const BABELDOC_STREAM_SCHEMA = 'babeldoc-stream/v2'
const babeldocStreamProgressSchema = z.strictObject({
  schema: z.literal(BABELDOC_STREAM_SCHEMA),
  type: z.literal('progress'),
  stage: z.enum(PDF_TRANSLATION_PROGRESS_STAGES),
  stage_progress: z.number().finite().min(0).max(100).nullable(),
  overall_progress: z.number().finite().min(0).max(100)
})
const babeldocStreamErrorSchema = z.strictObject({
  schema: z.literal(BABELDOC_STREAM_SCHEMA),
  type: z.literal('error'),
  name: z.string().min(1),
  message: z.string().min(1)
})
const babeldocStreamFinishSchema = z.strictObject({
  schema: z.literal(BABELDOC_STREAM_SCHEMA),
  type: z.literal('finish'),
  result: z.strictObject({
    original_pdf_path: z.string().nullable(),
    mono_pdf_path: z.string().nullable(),
    dual_pdf_path: z.string().nullable(),
    total_seconds: z.number().finite().nonnegative()
  })
})
const babeldocStreamEventSchema = z.discriminatedUnion('type', [
  babeldocStreamProgressSchema,
  babeldocStreamErrorSchema,
  babeldocStreamFinishSchema
])
// Env vars forwarded from the user shell into the BabelDOC (Python) sidecar. The
// allowlist deliberately excludes the user's provider API keys (OPENAI_API_KEY, …):
// BabelDOC's key is injected via babeldoc.toml pointing at the local gateway, so
// forwarding the real keys would only risk leaking them into the child's logs.
// Parallels BinaryManager's MISE_PASSTHROUGH_ENV.
const SIDECAR_ENV_KEYS = new Set([
  'ALL_PROXY',
  'COMSPEC',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'LANG',
  'LC_ALL',
  'NO_PROXY',
  'PATH',
  'PATHEXT',
  'SSL_CERT_DIR',
  'SSL_CERT_FILE',
  'SYSTEMROOT',
  'TEMP',
  'TMP',
  'TMPDIR',
  'WINDIR'
])
const BABELDOC_LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
  'zh-hans': 'zh-CN',
  'zh-hant': 'zh-TW'
}

const createOcrRequiredError = (): IpcError =>
  new IpcError(translateErrorCodes.PDF_OCR_REQUIRED, 'OCR translation for scanned PDFs is not supported yet')

interface PdfTranslationRequest {
  jobId: string
  sourcePath: AbsoluteFilePath
  sourceLangCode: TranslateSourceLanguage
  targetLangCode: TranslateLangCode
  modelId: UniqueModelId
}

interface PdfTranslationResult {
  /** Managed path of the translated PDF (`{userData}/Data/Files/{id}.pdf`), not the sidecar's temp output. */
  outputPath: AbsoluteFilePath
  fileName: string
}

interface ActivePdfTranslation {
  cancelled: boolean
  child: ChildProcess | null
  overallProgress: number
  progressStage: PdfTranslationProgressStage | null
  stageProgress: number | null
}

const normalizeLanguageCode = (code: TranslateSourceLanguage): string => {
  if (code === 'auto' || code === 'unknown') return 'auto'
  const alias = BABELDOC_LANGUAGE_ALIASES[code]
  if (alias) return alias
  const [language, region] = code.split('-', 2)
  return region ? `${language}-${region.toUpperCase()}` : language
}

/**
 * Proxy env for the sidecar, which reaches the gateway over loopback.
 *
 * Two separate gaps break this on Windows. Cherry's proxy decision lives in `process.env`
 * (written by ProxyService), not in the login shell the rest of the sidecar env is filtered
 * from — so the sidecar inherits nothing, and Python falls back to `urllib.request.getproxies()`,
 * which reads the WinINET registry and routes even the loopback call through the system proxy;
 * the proxy refuses it and every paragraph fails with 502. Pinning the gateway host into
 * NO_PROXY is separately required: the registry's own `ProxyOverride` uses shapes like `127.*`
 * that httpx does not read as a bypass. Setting NO_PROXY alone is not enough either — it makes
 * `getproxies()` non-empty, which suppresses the registry fallback and sends BabelDOC's asset
 * downloads direct.
 */
const buildSidecarProxyEnv = (inheritedNoProxy: string | undefined, gatewayHost: string): Record<string, string> => {
  const proxyEnv: Record<string, string> = {}
  for (const [key, value] of Object.entries(getProxyEnvironment(process.env))) {
    if (SIDECAR_ENV_KEYS.has(key.toUpperCase())) proxyEnv[key] = value
  }
  const bypass = proxyEnv.NO_PROXY ?? proxyEnv.no_proxy ?? inheritedNoProxy ?? ''
  const hosts = bypass
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  // `new URL('http://[::1]:1/').hostname` keeps the brackets; NO_PROXY wants the bare address.
  const host = gatewayHost.replace(/^\[|\]$/g, '')
  if (!hosts.includes(host)) hosts.push(host)
  const noProxy = hosts.join(',')
  return { ...proxyEnv, NO_PROXY: noProxy, no_proxy: noProxy }
}

@Injectable('PdfTranslationService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['ApiGatewayService', 'FileManager'])
export class PdfTranslationService extends BaseService {
  private readonly activeJobs = new Map<string, ActivePdfTranslation>()
  private readonly activeRuns = new Set<Promise<PdfTranslationResult>>()

  protected async onInit(): Promise<void> {
    // `runTranslation`'s `finally` removes each job's dir, so this only ever finds residue
    // from a crash or a force-quit mid-run. No jobs are active at init, so drop the whole
    // feature temp root.
    const tempRoot = application.getPath('feature.pdf_translation.temp')
    await fs.promises.rm(tempRoot, { force: true, recursive: true }).catch((error) => {
      logger.warn('Failed to sweep stale PDF translation temp dirs', { error: String(error) })
    })
  }

  protected async onStop(): Promise<void> {
    for (const job of this.activeJobs.values()) {
      job.cancelled = true
      if (job.child) killProcessTree(job.child)
    }
    await Promise.allSettled(this.activeRuns)
  }

  public translate(
    request: PdfTranslationRequest,
    onStage?: (stage: PdfTranslationStage) => void,
    onProgress?: (progress: PdfTranslationProgress) => void
  ): Promise<PdfTranslationResult> {
    const run = this.runTranslation(request, onStage, onProgress)
    this.activeRuns.add(run)
    void run.then(
      () => {
        this.activeRuns.delete(run)
      },
      () => {
        this.activeRuns.delete(run)
      }
    )
    return run
  }

  private async runTranslation(
    request: PdfTranslationRequest,
    onStage?: (stage: PdfTranslationStage) => void,
    onProgress?: (progress: PdfTranslationProgress) => void
  ): Promise<PdfTranslationResult> {
    if (this.activeJobs.has(request.jobId)) {
      throw new Error(`PDF translation job already exists: ${request.jobId}`)
    }

    const job: ActivePdfTranslation = {
      cancelled: false,
      child: null,
      overallProgress: 0,
      progressStage: null,
      stageProgress: null
    }
    const outputDir = application.getPath('feature.pdf_translation.temp', request.jobId)
    const gateway = application.get('ApiGatewayService')
    let gatewayLeaseAcquired = false

    try {
      // Register the job as the first in-try statement so the `finally` cleanup (delete + temp
      // removal + lease release) always pairs with it — a throw from the resolves above can't leave
      // the id wedged in `activeJobs`.
      this.activeJobs.set(request.jobId, job)
      await fs.promises.access(request.sourcePath, fs.constants.R_OK)
      if (path.extname(request.sourcePath).toLowerCase() !== '.pdf') {
        throw new Error('PDF translation requires a .pdf source file')
      }

      onStage?.('preparing')
      const executable = await this.resolveSidecar()
      this.throwIfCancelled(job)

      const { providerId, modelId } = parseUniqueModelId(request.modelId)
      const model = modelService.getByKey(providerId, modelId)
      const gatewayModelId = formatGatewayModelId(providerId, model.apiModelId ?? modelId)

      // Hold a temporary run lease instead of toggling the gateway's persistent enabled state, so a
      // user enabling/disabling the gateway mid-translation is neither overridden nor able to cut us off.
      await gateway.acquireLease()
      gatewayLeaseAcquired = true
      this.throwIfCancelled(job)

      const apiKey = await gateway.ensureValidApiKey()
      const config = gateway.getCurrentConfig()
      const baseUrl = `${gatewayClientOrigin(config.host, config.port)}/v1`

      await fs.promises.rm(outputDir, { force: true, recursive: true })
      await fs.promises.mkdir(outputDir, { recursive: true })
      onStage?.('translating')

      await this.runSidecar(job, executable, request, outputDir, gatewayModelId, baseUrl, apiKey, onProgress)
      this.throwIfCancelled(job)

      // BabelDOC Stream 0.6.4.post1 inserts a `.no_watermark` segment into the mono filename whenever the
      // watermark mode is not `watermarked` (we pass `--watermark-output-mode no_watermark`), e.g.
      // `paper.no_watermark.zh-CN.mono.pdf`. Omitting it would ENOENT here and delete the artifact.
      const fileName = `${path.parse(request.sourcePath).name}.no_watermark.${normalizeLanguageCode(request.targetLangCode)}.mono.pdf`
      const outputPath = AbsoluteFilePathSchema.parse(path.join(outputDir, fileName))
      await fs.promises.access(outputPath, fs.constants.R_OK)
      this.reportProgress(job, { stage: 'rendering', stageProgress: 100, overallProgress: 100 }, onProgress)
      // `await` (not a bare `return`) so the `finally` below cannot delete the temp dir
      // out from under the copy into FileManager.
      return await this.persistResult(request, outputPath, job)
    } catch (error) {
      // Surface the failure to the main-process log (the stderr tail rides along in the
      // reject message on the non-zero-exit path). Cancellation is expected; IpcErrors
      // (OCR required, dependency missing) are actionable user conditions, so log those at
      // warn and reserve error for genuine sidecar failures.
      if (!job.cancelled) {
        const level = error instanceof IpcError ? 'warn' : 'error'
        logger[level]('PDF translation failed', error as Error, { jobId: request.jobId })
      }
      throw error
    } finally {
      this.activeJobs.delete(request.jobId)
      // Unconditional: on success the artifact already lives in FileManager, on failure
      // there is nothing worth keeping. Nobody outside this method reads the temp dir.
      await fs.promises.rm(outputDir, { force: true, recursive: true }).catch((error) => {
        logger.warn('Failed to clean PDF translation output', { jobId: request.jobId, error: String(error) })
      })
      if (gatewayLeaseAcquired) gateway.releaseLease()
    }
  }

  public cancel(jobId: string): void {
    const job = this.activeJobs.get(jobId)
    if (!job) return
    job.cancelled = true
    if (job.child) killProcessTree(job.child)
  }

  /**
   * Hand the finished translation to FileManager and record it in translate history.
   *
   * The artifact is copied into Cherry storage as a `delete_when_unreferenced` internal
   * entry, so the history row's `translate_history_file_ref` is what keeps it alive:
   * deleting the row (or clearing history) releases the PDF to the cleanup pass. The
   * user's original is only *referenced* (external entry) — never copied, never deleted.
   *
   * If the history write throws, the just-created entry would linger as an unreferenced
   * file the user sees in the file manager until the cleanup grace window elapses, so it
   * is compensated away — the same shape as `withCreatedImageEntry`.
   */
  private async persistResult(request: PdfTranslationRequest, outputPath: AbsoluteFilePath, job: ActivePdfTranslation) {
    const fileManager = application.get('FileManager')
    let translated: FileEntry | null = null

    try {
      const created = await fileManager.createInternalEntry({
        source: 'path',
        path: outputPath,
        cleanupPolicy: 'delete_when_unreferenced'
      })
      translated = created
      const entry = await this.renameToDisplayName(created, request)
      const fileName = entry.ext ? `${entry.name}.${entry.ext}` : entry.name

      const source = await this.registerSourceEntry(request.sourcePath, request.jobId)
      this.throwIfCancelled(job)

      const history = application.get('DbService').withWriteTx((tx) =>
        translateHistoryService.createFileTx(tx, {
          sourceText: path.basename(request.sourcePath),
          targetText: fileName,
          sourceLanguage: toPersistedLangCodeOrNull(request.sourceLangCode),
          targetLanguage: toPersistedLangCodeOrNull(request.targetLangCode),
          targetFileEntryId: entry.id,
          ...(source ? { sourceFileEntryId: source.id } : {})
        })
      )
      notifyDataApiDataChange([{ endpoint: '/translate/histories', kind: 'membership', entityIds: [history.id] }])

      return { outputPath: fileManager.getPhysicalPath(entry.id), fileName }
    } catch (error) {
      const cancelled = job.cancelled
      if (!cancelled) {
        logger.error('Failed to persist translated PDF result', error as Error, { jobId: request.jobId })
      }
      if (translated) {
        const translatedId = translated.id
        await fileManager.permanentDelete(translatedId).catch((cleanupError) => {
          logger.error(`Failed to delete orphaned translated PDF entry ${translatedId}`, cleanupError as Error)
        })
      }
      if (cancelled) this.throwIfCancelled(job)
      throw new IpcError(
        translateErrorCodes.PDF_RESULT_PERSIST_FAILED,
        'The PDF was translated, but its result could not be saved'
      )
    }
  }

  /**
   * Trade BabelDOC's artifact name — `<stem>.no_watermark.<lang>.mono.pdf`, which the
   * entry inherits from the copied file's basename — for the name a user expects in the
   * file manager and in "save as". Internal entries are stored at `{id}.{ext}`, so this
   * only rewrites the DB's display name.
   *
   * A source stem that cannot form a safe name (over-long, `.`/`..`) keeps the derived
   * name instead: cosmetics must not sink a translation the user already paid for.
   */
  private async renameToDisplayName(entry: FileEntry, request: PdfTranslationRequest): Promise<FileEntry> {
    const displayName = `${path.parse(request.sourcePath).name}.${normalizeLanguageCode(request.targetLangCode)}`
    if (!SafeNameSchema.safeParse(displayName).success) {
      logger.warn('Kept the BabelDOC-derived name; the display name is not a safe file name', {
        jobId: request.jobId
      })
      return entry
    }
    try {
      return await application.get('FileManager').rename(entry.id, displayName)
    } catch (error) {
      logger.warn('Failed to apply the translated PDF display name; keeping the BabelDOC-derived name', {
        entryId: entry.id,
        error: String(error),
        jobId: request.jobId
      })
      return entry
    }
  }

  /**
   * Reference the user's source PDF so history can offer the side-by-side view again.
   *
   * Best-effort: `ensureExternalEntry` rejects paths it cannot canonicalize (UNC) and
   * case-collisions `fs.realpath` proves are distinct files. Neither says anything about
   * the translation, which is already on disk — so a failure costs the "source" ref, not
   * the history row.
   */
  private async registerSourceEntry(sourcePath: AbsoluteFilePath, jobId: string): Promise<FileEntry | null> {
    try {
      return await application.get('FileManager').ensureExternalEntry({
        externalPath: sourcePath,
        cleanupPolicy: 'delete_when_unreferenced'
      })
    } catch (error) {
      logger.warn('Failed to reference the source PDF; recording the translation without it', {
        error: String(error),
        jobId,
        sourcePath
      })
      return null
    }
  }

  private async resolveSidecar(): Promise<string> {
    const binaryManager = application.get('BinaryManager')
    const snapshot = (await binaryManager.getToolSnapshots([BABELDOC_TOOL_NAME]))[BABELDOC_TOOL_NAME]
    const status = getBabelDocInstallationStatus(snapshot)
    if (status === 'missing') {
      throw new IpcError(translateErrorCodes.PDF_DEPENDENCY_NOT_INSTALLED, 'BabelDOC is not installed')
    }
    if (status === 'outdated') {
      throw new IpcError(translateErrorCodes.PDF_DEPENDENCY_OUTDATED, 'BabelDOC must be updated')
    }

    const installedPath = await getBinaryPath(BABELDOC_TOOL_NAME)
    if (!path.isAbsolute(installedPath)) {
      throw new IpcError(translateErrorCodes.PDF_DEPENDENCY_NOT_INSTALLED, 'BabelDOC is not available')
    }
    try {
      await fs.promises.access(installedPath, fs.constants.X_OK)
    } catch {
      throw new IpcError(translateErrorCodes.PDF_DEPENDENCY_NOT_INSTALLED, 'BabelDOC is not available')
    }
    return installedPath
  }

  private async runSidecar(
    job: ActivePdfTranslation,
    executable: string,
    request: PdfTranslationRequest,
    outputDir: string,
    gatewayModelId: string,
    baseUrl: string,
    apiKey: string,
    onProgress?: (progress: PdfTranslationProgress) => void
  ): Promise<void> {
    const configPath = path.join(outputDir, 'babeldoc.toml')
    await fs.promises.writeFile(configPath, stringifyToml({ babeldoc: { 'openai-api-key': apiKey } }), { mode: 0o600 })
    const args = [
      '--config',
      configPath,
      '--files',
      request.sourcePath,
      '--output',
      outputDir,
      '--openai',
      '--openai-model',
      gatewayModelId,
      '--openai-base-url',
      baseUrl,
      '--lang-in',
      normalizeLanguageCode(request.sourceLangCode),
      '--lang-out',
      normalizeLanguageCode(request.targetLangCode),
      '--report-interval',
      '0.2',
      '--progress-json',
      '--progress-json-version',
      '2',
      '--watermark-output-mode',
      'no_watermark',
      '--no-dual'
    ]
    const env = await this.buildSidecarEnv(baseUrl)

    try {
      await new Promise<void>((resolve, reject) => {
        // POSIX: run BabelDOC as its own process-group leader so `killProcessTree` can signal the
        // whole group (negative PID) and reap the multiprocessing workers it forks for rendering,
        // font subsetting, and saving. Windows relies on `taskkill /T` instead — and `detached`
        // there would pop a console window — so it stays off.
        const child = crossPlatformSpawn(executable, args, { cwd: outputDir, env, detached: !isWin })
        job.child = child
        // A cancel that landed during the pre-spawn await window (resolveSidecar →
        // gateway → mkdir → writeFile) killed a still-null child; re-check now so the
        // freshly-spawned sidecar is terminated instead of running the full translation.
        if (job.cancelled) killProcessTree(child)
        let stderr = ''
        let sidecarError: Error | null = null
        let finishReceived = false
        const progressLines = child.stdout ? createInterface({ input: child.stdout }) : null

        progressLines?.on('line', (line) => {
          let candidate: unknown
          try {
            candidate = JSON.parse(line)
          } catch {
            logger.warn('Ignored malformed BabelDOC Stream event')
            return
          }
          const parsed = babeldocStreamEventSchema.safeParse(candidate)
          if (!parsed.success) {
            logger.warn('Ignored invalid BabelDOC Stream event')
            return
          }
          if (parsed.data.type === 'error') {
            sidecarError ??=
              parsed.data.name === 'ScannedPDFError' || parsed.data.message.includes('Scanned PDF detected')
                ? createOcrRequiredError()
                : new Error(parsed.data.message)
            return
          }
          if (parsed.data.type === 'finish') {
            finishReceived = true
            return
          }
          this.reportProgress(
            job,
            {
              stage: parsed.data.stage,
              stageProgress: parsed.data.stage_progress,
              overallProgress: parsed.data.overall_progress
            },
            onProgress
          )
        })
        child.stderr?.on('data', (chunk) => {
          stderr = `${stderr}${String(chunk)}`.slice(-8000)
        })
        child.once('error', (error) => {
          progressLines?.close()
          reject(error)
        })
        child.once('close', (code, signal) => {
          progressLines?.close()
          job.child = null
          if (job.cancelled) {
            reject(new Error('PDF translation cancelled'))
          } else if (sidecarError) {
            reject(sidecarError)
          } else if (code === 0 && finishReceived) {
            resolve()
          } else if (code === 0) {
            reject(new Error('BabelDOC Stream exited successfully without a finish event'))
          } else {
            reject(
              new Error(
                stderr.trim() || `BabelDOC Stream exited with code ${code ?? 'null'} (${signal ?? 'no signal'})`
              )
            )
          }
        })
      })
    } finally {
      await fs.promises.rm(configPath, { force: true }).catch((error) => {
        logger.warn('Failed to remove BabelDOC credential file', { error: String(error) })
      })
    }
  }

  private reportProgress(
    job: ActivePdfTranslation,
    progress: PdfTranslationProgress,
    onProgress?: (progress: PdfTranslationProgress) => void
  ): void {
    if (progress.overallProgress < job.overallProgress) return
    if (
      job.progressStage === progress.stage &&
      job.stageProgress === progress.stageProgress &&
      job.overallProgress === progress.overallProgress
    ) {
      return
    }
    job.overallProgress = progress.overallProgress
    job.progressStage = progress.stage
    job.stageProgress = progress.stageProgress
    onProgress?.(progress)
  }

  private throwIfCancelled(job: ActivePdfTranslation): void {
    if (job.cancelled) throw new Error('PDF translation cancelled')
  }

  private async buildSidecarEnv(gatewayBaseUrl: string): Promise<Record<string, string>> {
    const shellEnv = await getShellEnv()
    const inChina = await regionService.isInChina().catch(() => false)
    const allowedEnv: Record<string, string> = {}
    for (const [key, value] of Object.entries(shellEnv)) {
      if (SIDECAR_ENV_KEYS.has(key.toUpperCase())) allowedEnv[key] = value
    }

    const runtimeHome = application.getPath('feature.pdf_translation.babeldoc')
    return mergeBinaryExecutionEnv({
      ...allowedEnv,
      ...buildSidecarProxyEnv(allowedEnv.NO_PROXY ?? allowedEnv.no_proxy, new URL(gatewayBaseUrl).hostname),
      HOME: runtimeHome,
      USERPROFILE: runtimeHome,
      PYTHONUTF8: '1',
      ...(inChina ? { BABELDOC_ASSET_UPSTREAM: 'modelscope' } : {})
    })
  }
}
