import type { ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline'

import { application } from '@application'
import { modelService } from '@data/services/ModelService'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { mergeBinaryExecutionEnv } from '@main/utils/binaryEnv'
import { getBinaryPath } from '@main/utils/binaryResolver'
import { hasPdfTextLayer } from '@main/utils/pdf'
import { crossPlatformSpawn } from '@main/utils/processRunner'
import { getShellEnv } from '@main/utils/shellEnv'
import type { TranslateLangCode, TranslateSourceLanguage } from '@shared/data/preference/preferenceTypes'
import { BABELDOC_BINARY_TOOL_PRESET } from '@shared/data/presets/binaryTools'
import { parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { translateErrorCodes } from '@shared/ipc/errors/translate'
import type { PdfTranslationProgress, PdfTranslationProgressStage } from '@shared/ipc/schemas/translate'
import { formatGatewayModelId } from '@shared/utils/apiGateway'
import { Mutex } from 'async-mutex'
import { stringify as stringifyToml } from 'smol-toml'
import * as z from 'zod'

const logger = loggerService.withContext('PdfTranslationService')
const BABELDOC_ERROR_PREFIX = '__CHERRY_BABELDOC_ERROR__'
const BABELDOC_PROGRESS_PREFIX = '__CHERRY_BABELDOC_PROGRESS__'
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

export type PdfTranslationStage = 'preparing' | 'translating'

export interface PdfTranslationRequest {
  jobId: string
  sourcePath: string
  sourceLangCode: TranslateSourceLanguage
  targetLangCode: TranslateLangCode
  modelId: UniqueModelId
}

export interface PdfTranslationResult {
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
  private readonly gatewayMutex = new Mutex()
  private gatewayLeaseCount = 0
  private gatewayStartedByService = false

  protected async onStop(): Promise<void> {
    for (const job of this.activeJobs.values()) {
      job.cancelled = true
      job.child?.kill()
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
    this.activeJobs.set(request.jobId, job)
    const outputDir = application.getPath('feature.pdf_translation.temp', request.jobId)
    let gatewayLeaseAcquired = false
    let completed = false

    try {
      await fs.promises.access(request.sourcePath, fs.constants.R_OK)
      if (path.extname(request.sourcePath).toLowerCase() !== '.pdf') {
        throw new Error('PDF translation requires a .pdf source file')
      }

      onStage?.('preparing')
      const hasTextLayer = await hasPdfTextLayer(await fs.promises.readFile(request.sourcePath))
      this.throwIfCancelled(job)
      if (!hasTextLayer) {
        throw createOcrRequiredError()
      }

      const executable = await this.resolveSidecar()
      this.throwIfCancelled(job)

      const { providerId, modelId } = parseUniqueModelId(request.modelId)
      const model = modelService.getByKey(providerId, modelId)
      const gatewayModelId = formatGatewayModelId(providerId, model.apiModelId ?? modelId)

      await this.acquireGateway()
      gatewayLeaseAcquired = true
      this.throwIfCancelled(job)

      const gateway = application.get('ApiGatewayService')
      const apiKey = await gateway.ensureValidApiKey()
      const config = gateway.getCurrentConfig()
      const baseUrl = `http://${gatewayHostForClient(config.host)}:${config.port}/v1`

      await fs.promises.rm(outputDir, { force: true, recursive: true })
      await fs.promises.mkdir(outputDir, { recursive: true })
      onStage?.('translating')

      await this.runSidecar(job, executable, request, outputDir, gatewayModelId, baseUrl, apiKey, onProgress)
      this.throwIfCancelled(job)

      const fileName = `${path.parse(request.sourcePath).name}.${normalizeLanguageCode(request.targetLangCode)}.mono.pdf`
      const outputPath = path.join(outputDir, fileName)
      await fs.promises.access(outputPath, fs.constants.R_OK)
      this.reportProgress(job, { stage: 'rendering', progress: 100 }, onProgress)
      completed = true
      return { outputPath, fileName }
    } finally {
      this.activeJobs.delete(request.jobId)
      if (!completed) {
        await fs.promises.rm(outputDir, { force: true, recursive: true }).catch((error) => {
          logger.warn('Failed to clean PDF translation output', { jobId: request.jobId, error: String(error) })
        })
      }
      if (gatewayLeaseAcquired) await this.releaseGateway()
    }
  }

  public cancel(jobId: string): void {
    const job = this.activeJobs.get(jobId)
    if (!job) return
    job.cancelled = true
    job.child?.kill()
  }

  public async cleanup(jobId: string): Promise<void> {
    if (this.activeJobs.has(jobId)) return
    await fs.promises.rm(application.getPath('feature.pdf_translation.temp', jobId), {
      force: true,
      recursive: true
    })
  }

  private async resolveSidecar(): Promise<string> {
    const installed = application.get('BinaryManager').getState().tools[BABELDOC_BINARY_TOOL_PRESET.name]
    if (
      installed?.tool !== BABELDOC_BINARY_TOOL_PRESET.tool ||
      installed.version !== BABELDOC_BINARY_TOOL_PRESET.version
    ) {
      throw new IpcError(
        translateErrorCodes.PDF_DEPENDENCY_NOT_INSTALLED,
        `BabelDOC ${BABELDOC_BINARY_TOOL_PRESET.version} is not installed`
      )
    }

    const installedPath = await getBinaryPath(BABELDOC_BINARY_TOOL_PRESET.name)
    if (!path.isAbsolute(installedPath)) {
      throw new IpcError(
        translateErrorCodes.PDF_DEPENDENCY_NOT_INSTALLED,
        `BabelDOC ${BABELDOC_BINARY_TOOL_PRESET.version} is not available`
      )
    }
    try {
      await fs.promises.access(installedPath, fs.constants.X_OK)
    } catch {
      throw new IpcError(
        translateErrorCodes.PDF_DEPENDENCY_NOT_INSTALLED,
        `BabelDOC ${BABELDOC_BINARY_TOOL_PRESET.version} is not available`
      )
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
      '--no-dual'
    ]
    const env = { ...(await this.buildSidecarEnv()), PYTHONPATH: progressAdapterDir }

    try {
      await new Promise<void>((resolve, reject) => {
        const child = crossPlatformSpawn(executable, args, { cwd: outputDir, env })
        job.child = child
        let stderr = ''
        let sidecarError: Error | null = null
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

  private async acquireGateway(): Promise<void> {
    await this.gatewayMutex.runExclusive(async () => {
      const gateway = application.get('ApiGatewayService')
      if (this.gatewayLeaseCount === 0 && !gateway.isRunning()) {
        await gateway.start()
        this.gatewayStartedByService = true
      }
      this.gatewayLeaseCount += 1
    })
  }

  private async releaseGateway(): Promise<void> {
    await this.gatewayMutex.runExclusive(async () => {
      this.gatewayLeaseCount -= 1
      if (this.gatewayLeaseCount > 0 || !this.gatewayStartedByService) return

      try {
        await application.get('ApiGatewayService').stop()
      } catch (error) {
        logger.warn('Failed to stop temporary API gateway', error as Error)
      } finally {
        this.gatewayStartedByService = false
      }
    })
  }

  private async buildSidecarEnv(): Promise<Record<string, string>> {
    const shellEnv = await getShellEnv()
    const allowedEnv: Record<string, string> = {}
    for (const [key, value] of Object.entries(shellEnv)) {
      if (SIDECAR_ENV_KEYS.has(key.toUpperCase())) allowedEnv[key] = value
    }

    const runtimeHome = application.getPath('feature.pdf_translation.runtime')
    return mergeBinaryExecutionEnv({
      ...allowedEnv,
      HOME: runtimeHome,
      USERPROFILE: runtimeHome,
      PYTHONUTF8: '1'
    })
  }
}
