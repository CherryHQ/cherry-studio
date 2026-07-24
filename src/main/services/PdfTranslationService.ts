import type { ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline'

import { application } from '@application'
import { modelService } from '@data/services/ModelService'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { isWin } from '@main/core/platform'
import { mergeBinaryExecutionEnv } from '@main/utils/binaryEnv'
import { getBinaryPath } from '@main/utils/binaryResolver'
import { crossPlatformSpawn, killProcessTree } from '@main/utils/processRunner'
import { getShellEnv } from '@main/utils/shellEnv'
import type { TranslateLangCode, TranslateSourceLanguage } from '@shared/data/preference/preferenceTypes'
import { BABELDOC_TOOL_NAME, isBabelDocInstalled } from '@shared/data/presets/binaryTools'
import { parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { translateErrorCodes } from '@shared/ipc/errors/translate'
import type {
  PdfTranslationProgress,
  PdfTranslationProgressStage,
  PdfTranslationStage
} from '@shared/ipc/schemas/translate'
import { formatGatewayModelId } from '@shared/utils/apiGateway'
import { stringify as stringifyToml } from 'smol-toml'
import * as z from 'zod'

const logger = loggerService.withContext('PdfTranslationService')
const BABELDOC_ERROR_PREFIX = '__CHERRY_BABELDOC_ERROR__'
const BABELDOC_PROGRESS_PREFIX = '__CHERRY_BABELDOC_PROGRESS__'
const BABELDOC_ASSET_DOWNLOAD_PATTERNS = [
  /not found or corrupted, downloading/i,
  /downloading (?:all assets|fonts|cmaps)(?: from)?/i
]
// BabelDOC 0.6.3 exposes structured events to Python callers but renders only
// terminal output in its CLI. This per-run hook preserves those events as NDJSON.
const BABELDOC_PROGRESS_ADAPTER = `import contextlib
import json
import math
import sys

def _emit_progress(event):
    event_type = event.get("type")
    if event_type == "error":
        error = event.get("error")
        payload = {"name": type(error).__name__, "message": str(error)}
        sys.stdout.write("${BABELDOC_ERROR_PREFIX}" + json.dumps(payload, separators=(",", ":")) + "\\n")
        sys.stdout.flush()
        return
    if event_type not in ("progress_update", "progress_end"):
        return
    stage = event.get("stage")
    progress = event.get("overall_progress")
    if not isinstance(stage, str) or not isinstance(progress, (int, float)) or not math.isfinite(progress):
        return
    payload = {"stage": stage, "progress": max(0.0, min(100.0, float(progress)))}
    sys.stdout.write("${BABELDOC_PROGRESS_PREFIX}" + json.dumps(payload, separators=(",", ":")) + "\\n")
    sys.stdout.flush()

def _create_progress_handler(_translation_config, show_log=False):
    return contextlib.nullcontext(), _emit_progress

try:
    import babeldoc.main as _babeldoc_main
    _babeldoc_main.create_progress_handler = _create_progress_handler
except Exception as _error:
    sys.stderr.write("Cherry Studio progress adapter failed: " + str(_error) + "\\n")
`
const babeldocErrorSchema = z.strictObject({
  name: z.string().min(1),
  message: z.string().min(1)
})
const babeldocProgressSchema = z.strictObject({
  stage: z.string().min(1),
  progress: z.number().finite().min(0).max(100)
})
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
  sourcePath: string
  sourceLangCode: TranslateSourceLanguage
  targetLangCode: TranslateLangCode
  modelId: UniqueModelId
}

interface PdfTranslationResult {
  outputPath: string
  fileName: string
}

interface ActivePdfTranslation {
  cancelled: boolean
  child: ChildProcess | null
  progress: number
  progressStage: PdfTranslationProgressStage | null
}

const normalizeLanguageCode = (code: TranslateSourceLanguage): string => {
  if (code === 'auto' || code === 'unknown') return 'auto'
  const alias = BABELDOC_LANGUAGE_ALIASES[code]
  if (alias) return alias
  const [language, region] = code.split('-', 2)
  return region ? `${language}-${region.toUpperCase()}` : language
}

const gatewayHostForClient = (host: string): string => {
  if (host === '0.0.0.0') return '127.0.0.1'
  if (host === '::') return '[::1]'
  return host
}

@Injectable('PdfTranslationService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['ApiGatewayService'])
export class PdfTranslationService extends BaseService {
  private readonly activeJobs = new Map<string, ActivePdfTranslation>()
  private readonly activeRuns = new Set<Promise<PdfTranslationResult>>()

  protected async onInit(): Promise<void> {
    // Success-path output dirs are cleaned only by the renderer effect, which never runs
    // on window close / app quit. No jobs are active at init, so drop the whole feature
    // temp root here to clear anything a prior session left behind.
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

    const job: ActivePdfTranslation = { cancelled: false, child: null, progress: 0, progressStage: null }
    const outputDir = application.getPath('feature.pdf_translation.temp', request.jobId)
    const gateway = application.get('ApiGatewayService')
    let gatewayLeaseAcquired = false
    let completed = false

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
      const baseUrl = `http://${gatewayHostForClient(config.host)}:${config.port}/v1`

      await fs.promises.rm(outputDir, { force: true, recursive: true })
      await fs.promises.mkdir(outputDir, { recursive: true })
      onStage?.('translating')

      await this.runSidecar(job, executable, request, outputDir, gatewayModelId, baseUrl, apiKey, onStage, onProgress)
      this.throwIfCancelled(job)

      // BabelDOC 0.6.3 inserts a `.no_watermark` segment into the mono filename whenever the
      // watermark mode is not `watermarked` (we pass `--watermark-output-mode no_watermark`), e.g.
      // `paper.no_watermark.zh-CN.mono.pdf`. Omitting it would ENOENT here and delete the artifact.
      const fileName = `${path.parse(request.sourcePath).name}.no_watermark.${normalizeLanguageCode(request.targetLangCode)}.mono.pdf`
      const outputPath = path.join(outputDir, fileName)
      await fs.promises.access(outputPath, fs.constants.R_OK)
      this.reportProgress(job, { stage: 'rendering', progress: 100 }, onProgress)
      completed = true
      return { outputPath, fileName }
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
      if (!completed) {
        await fs.promises.rm(outputDir, { force: true, recursive: true }).catch((error) => {
          logger.warn('Failed to clean PDF translation output', { jobId: request.jobId, error: String(error) })
        })
      }
      if (gatewayLeaseAcquired) gateway.releaseLease()
    }
  }

  public cancel(jobId: string): void {
    const job = this.activeJobs.get(jobId)
    if (!job) return
    job.cancelled = true
    if (job.child) killProcessTree(job.child)
  }

  public async cleanup(jobId: string): Promise<void> {
    if (this.activeJobs.has(jobId)) return
    await fs.promises.rm(application.getPath('feature.pdf_translation.temp', jobId), {
      force: true,
      recursive: true
    })
  }

  private async resolveSidecar(): Promise<string> {
    const binaryManager = application.get('BinaryManager')
    const snapshot = (await binaryManager.getToolSnapshots([BABELDOC_TOOL_NAME]))[BABELDOC_TOOL_NAME]
    if (!isBabelDocInstalled(snapshot)) {
      throw new IpcError(translateErrorCodes.PDF_DEPENDENCY_NOT_INSTALLED, 'BabelDOC is not installed')
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
    onStage?: (stage: PdfTranslationStage) => void,
    onProgress?: (progress: PdfTranslationProgress) => void
  ): Promise<void> {
    const configPath = path.join(outputDir, 'babeldoc.toml')
    const progressAdapterDir = path.join(outputDir, '.progress-adapter')
    await fs.promises.mkdir(progressAdapterDir, { recursive: true })
    await fs.promises.writeFile(path.join(progressAdapterDir, 'sitecustomize.py'), BABELDOC_PROGRESS_ADAPTER, {
      mode: 0o600
    })
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
      '--watermark-output-mode',
      'no_watermark',
      '--no-dual'
    ]
    const env = { ...(await this.buildSidecarEnv()), PYTHONPATH: progressAdapterDir }

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
        let downloadingAssets = false
        let adapterWarned = false
        const progressLines = child.stdout ? createInterface({ input: child.stdout }) : null

        progressLines?.on('line', (line) => {
          if (line.startsWith(BABELDOC_ERROR_PREFIX)) {
            let candidate: unknown
            try {
              candidate = JSON.parse(line.slice(BABELDOC_ERROR_PREFIX.length))
            } catch {
              logger.warn('Ignored malformed BabelDOC error event')
              return
            }
            const parsed = babeldocErrorSchema.safeParse(candidate)
            if (!parsed.success) {
              logger.warn('Ignored invalid BabelDOC error event')
              return
            }
            sidecarError =
              parsed.data.name === 'ScannedPDFError' || parsed.data.message.includes('Scanned PDF detected')
                ? createOcrRequiredError()
                : new Error(parsed.data.message)
            return
          }
          if (!line.startsWith(BABELDOC_PROGRESS_PREFIX)) {
            if (!downloadingAssets && BABELDOC_ASSET_DOWNLOAD_PATTERNS.some((pattern) => pattern.test(line))) {
              downloadingAssets = true
              onStage?.('downloading_assets')
            }
            logger.debug(line.trim())
            return
          }
          let candidate: unknown
          try {
            candidate = JSON.parse(line.slice(BABELDOC_PROGRESS_PREFIX.length))
          } catch {
            logger.warn('Ignored malformed BabelDOC progress event')
            return
          }
          const parsed = babeldocProgressSchema.safeParse(candidate)
          if (!parsed.success) {
            logger.warn('Ignored invalid BabelDOC progress event')
            return
          }
          if (downloadingAssets) {
            downloadingAssets = false
            onStage?.('translating')
          }
          this.reportProgress(
            job,
            {
              stage: this.normalizeProgressStage(parsed.data.stage),
              progress: Math.round(parsed.data.progress)
            },
            onProgress
          )
        })
        child.stderr?.on('data', (chunk) => {
          stderr = `${stderr}${String(chunk)}`.slice(-8000)
          // The progress adapter (sitecustomize.py) monkeypatches BabelDOC; if it breaks
          // (version bump, packaging change), no progress/structured-error events arrive.
          if (!adapterWarned && stderr.includes('Cherry Studio progress adapter failed')) {
            adapterWarned = true
            logger.warn('BabelDOC progress adapter failed; progress and structured errors unavailable', {
              jobId: request.jobId
            })
          }
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
          } else if (/ScannedPDFError|Scanned PDF detected/i.test(stderr)) {
            // Checked BEFORE `code === 0`: BabelDOC 0.6.3 only logs the error event and breaks, so a
            // scanned PDF can still exit 0. A broken adapter can't emit the structured
            // ScannedPDFError, so match the raw traceback (class name or exact message) and still
            // surface the friendly OCR hint. Kept narrow so an unrelated failure whose stderr merely
            // mentions "scanned PDF" isn't misreported as OCR-required.
            reject(createOcrRequiredError())
          } else if (code === 0) {
            resolve()
          } else {
            reject(new Error(stderr.trim() || `BabelDOC exited with code ${code ?? 'null'} (${signal ?? 'no signal'})`))
          }
        })
      })
    } finally {
      await Promise.all([
        fs.promises.rm(configPath, { force: true }).catch((error) => {
          logger.warn('Failed to remove BabelDOC credential file', { error: String(error) })
        }),
        fs.promises.rm(progressAdapterDir, { force: true, recursive: true }).catch((error) => {
          logger.warn('Failed to remove BabelDOC progress adapter', { error: String(error) })
        })
      ])
    }
  }

  private normalizeProgressStage(stage: string): PdfTranslationProgressStage {
    const normalized = stage.toLowerCase()
    if (normalized.includes('translate')) return 'translating'
    if (normalized.includes('term')) return 'extracting_terms'
    if (normalized.includes('typeset')) return 'typesetting'
    if (normalized.includes('parse pdf') || normalized.includes('intermediate representation')) return 'parsing'
    if (
      normalized.includes('detect') ||
      normalized.includes('layout') ||
      normalized.includes('paragraph') ||
      normalized.includes('formula') ||
      normalized.includes('style') ||
      normalized.includes('table')
    ) {
      return 'analyzing'
    }
    if (
      normalized.includes('font') ||
      normalized.includes('drawing') ||
      normalized.includes('save pdf') ||
      normalized.includes('generate pdf')
    ) {
      return 'rendering'
    }
    return 'processing'
  }

  private reportProgress(
    job: ActivePdfTranslation,
    progress: PdfTranslationProgress,
    onProgress?: (progress: PdfTranslationProgress) => void
  ): void {
    if (progress.progress < job.progress) return
    if (job.progressStage === progress.stage && job.progress === progress.progress) return
    job.progress = progress.progress
    job.progressStage = progress.stage
    onProgress?.(progress)
  }

  private throwIfCancelled(job: ActivePdfTranslation): void {
    if (job.cancelled) throw new Error('PDF translation cancelled')
  }

  private async buildSidecarEnv(): Promise<Record<string, string>> {
    const shellEnv = await getShellEnv()
    const allowedEnv: Record<string, string> = {}
    for (const [key, value] of Object.entries(shellEnv)) {
      if (SIDECAR_ENV_KEYS.has(key.toUpperCase())) allowedEnv[key] = value
    }

    const runtimeHome = application.getPath('feature.pdf_translation.babeldoc')
    return mergeBinaryExecutionEnv({
      ...allowedEnv,
      HOME: runtimeHome,
      USERPROFILE: runtimeHome,
      PYTHONUTF8: '1'
    })
  }
}
