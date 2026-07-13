import type { ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import { modelService } from '@data/services/ModelService'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { mergeBinaryExecutionEnv } from '@main/utils/binaryEnv'
import { getBinaryPath } from '@main/utils/binaryResolver'
import { crossPlatformSpawn } from '@main/utils/processRunner'
import { getShellEnv } from '@main/utils/shellEnv'
import type { TranslateLangCode, TranslateSourceLanguage } from '@shared/data/preference/preferenceTypes'
import { parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import { formatGatewayModelId } from '@shared/utils/apiGateway'
import { Mutex } from 'async-mutex'
import { stringify as stringifyToml } from 'smol-toml'

const logger = loggerService.withContext('PdfTranslationService')
const BABELDOC_BINARY = 'babeldoc'
const BABELDOC_INSTALL_SPEC = {
  name: BABELDOC_BINARY,
  tool: 'pipx:babeldoc',
  version: '0.6.3'
} as const
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

export type PdfTranslationStage = 'installing' | 'translating'

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
    onStage?: (stage: PdfTranslationStage) => void
  ): Promise<PdfTranslationResult> {
    const run = this.runTranslation(request, onStage)
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
    onStage?: (stage: PdfTranslationStage) => void
  ): Promise<PdfTranslationResult> {
    if (this.activeJobs.has(request.jobId)) {
      throw new Error(`PDF translation job already exists: ${request.jobId}`)
    }

    const job: ActivePdfTranslation = { cancelled: false, child: null }
    this.activeJobs.set(request.jobId, job)
    const outputDir = application.getPath('feature.pdf_translation.temp', request.jobId)
    let gatewayLeaseAcquired = false
    let completed = false

    try {
      await fs.promises.access(request.sourcePath, fs.constants.R_OK)
      if (path.extname(request.sourcePath).toLowerCase() !== '.pdf') {
        throw new Error('PDF translation requires a .pdf source file')
      }

      onStage?.('installing')
      const executable = await this.ensureSidecar()
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

      await this.runSidecar(job, executable, request, outputDir, gatewayModelId, baseUrl, apiKey)
      this.throwIfCancelled(job)

      const fileName = `${path.parse(request.sourcePath).name}.${normalizeLanguageCode(request.targetLangCode)}.dual.pdf`
      const outputPath = path.join(outputDir, fileName)
      await fs.promises.access(outputPath, fs.constants.R_OK)
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

  private async ensureSidecar(): Promise<string> {
    const result = await application.get('BinaryManager').reconcile([BABELDOC_INSTALL_SPEC])
    const failure = result.failed.find(({ name }) => name === BABELDOC_BINARY || name === '*')
    if (failure) {
      throw new Error(`Failed to install BabelDOC: ${failure.error}`)
    }

    const installedPath = await getBinaryPath(BABELDOC_BINARY)
    if (!path.isAbsolute(installedPath)) {
      throw new Error('BabelDOC installed without a resolvable executable')
    }
    await fs.promises.access(installedPath, fs.constants.X_OK)
    return installedPath
  }

  private async runSidecar(
    job: ActivePdfTranslation,
    executable: string,
    request: PdfTranslationRequest,
    outputDir: string,
    gatewayModelId: string,
    baseUrl: string,
    apiKey: string
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
      '--no-mono'
    ]
    const env = await this.buildSidecarEnv()

    try {
      await new Promise<void>((resolve, reject) => {
        const child = crossPlatformSpawn(executable, args, { cwd: outputDir, env })
        job.child = child
        let stderr = ''

        child.stdout?.on('data', (chunk) => logger.debug(String(chunk).trim()))
        child.stderr?.on('data', (chunk) => {
          stderr = `${stderr}${String(chunk)}`.slice(-8000)
        })
        child.once('error', reject)
        child.once('close', (code, signal) => {
          job.child = null
          if (job.cancelled) {
            reject(new Error('PDF translation cancelled'))
          } else if (code === 0) {
            resolve()
          } else {
            reject(new Error(stderr.trim() || `BabelDOC exited with code ${code ?? 'null'} (${signal ?? 'no signal'})`))
          }
        })
      })
    } finally {
      await fs.promises.rm(configPath, { force: true }).catch((error) => {
        logger.warn('Failed to remove BabelDOC credential file', { error: String(error) })
      })
    }
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
