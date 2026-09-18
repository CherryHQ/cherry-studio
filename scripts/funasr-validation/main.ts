import fs from 'node:fs'
import path from 'node:path'

import { app } from 'electron'

import { bundleFile, bundleForCapability, getSharedArtifact } from '../../src/main/ai/localModel/catalog/catalog'
import { currentPlatformKey } from '../../src/main/ai/localModel/catalog/types'
import { CPU_LOCAL_INFERENCE_PROFILE } from '../../src/main/ai/localModel/runtime/inferenceAcceleration'
import type { AsrInferenceContract } from '../../src/main/ai/localModel/runtime/inferenceProcess'
import type { InferenceInitData } from '../../src/main/ai/localModel/runtime/protocol'
import { defineUtilityProcess } from '../../src/main/core/utilityProcess/defineUtilityProcess'
import { electronProcessAdapter } from '../../src/main/core/utilityProcess/host/electronProcessAdapter'
import { ProcessHost, type UtilityProcessHostLogger } from '../../src/main/core/utilityProcess/host/ProcessHost'

const inputPath = requiredArgument('--input')
const userDataPath = requiredArgument('--user-data')
const repoRoot = requiredArgument('--repo-root')
const networkDenied = process.argv.includes('--offline')
const validationUserData = path.join(app.getPath('temp'), `cherry-funasr-validation-${process.pid}`)

app.setPath('userData', validationUserData)

const logger: UtilityProcessHostLogger = {
  debug: () => {},
  info: () => {},
  warn: (message) => process.stderr.write(`${message}\n`),
  error: (message) => process.stderr.write(`${message}\n`)
}

function requiredArgument(name: string): string {
  const index = process.argv.indexOf(name)
  const value = index >= 0 ? process.argv[index + 1] : undefined
  if (!value || value.startsWith('--')) throw new Error(`Missing ${name}`)
  return path.resolve(value)
}

function installedPaths() {
  const bundle = bundleForCapability('asr')
  const artifact = getSharedArtifact('sherpa-onnx')
  const platform = artifact.platforms[currentPlatformKey()]
  if (!platform) throw new Error('FunASR is unsupported on this platform')

  const modelDir = path.join(userDataPath, 'Runtime', 'models', 'funasr-nano')
  const artifactDir = path.join(userDataPath, 'Toolchain', 'sherpa-onnx', platform.installSubdir)
  for (const file of bundle.files) requireFile(path.join(modelDir, file.relPath), file.minBytes)
  for (const file of [platform.entryFile, ...platform.supportFiles]) requireFile(path.join(artifactDir, file), 1)

  const modelFile = (key: string) => path.join(modelDir, bundleFile(bundle, key).relPath)
  return {
    bindingPath: path.join(artifactDir, platform.entryFile),
    modelPaths: {
      encoder: modelFile('encoder'),
      llm: modelFile('llm'),
      embedding: modelFile('embedding'),
      tokenizerDir: path.dirname(modelFile('tokenizerVocab')),
      voiceActivityDetector: modelFile('voiceActivityDetector')
    }
  }
}

function requireFile(filePath: string, minBytes: number): void {
  const stat = fs.statSync(filePath, { throwIfNoEntry: false })
  if (!stat?.isFile() || stat.size < minBytes) throw new Error('FunASR installation is incomplete')
}

async function run(): Promise<void> {
  const { bindingPath, modelPaths } = installedPaths()
  requireFile(inputPath, 45)

  const definition = defineUtilityProcess<AsrInferenceContract, InferenceInitData>({
    id: 'inference.asr',
    entry: 'inference-asr',
    cancellation: 'terminate',
    idleTimeoutMs: 60_000,
    createInitData: () => ({
      appPath: repoRoot,
      artifactPaths: { 'sherpa-onnx': bindingPath },
      runtimeProfile: CPU_LOCAL_INFERENCE_PROFILE
    })
  })
  const host = new ProcessHost(definition, {
    adapter: electronProcessAdapter,
    logger,
    resolveEntry: (entry) => path.join(repoRoot, 'out', 'utility-process', `${entry}.js`),
    getTempDir: () => validationUserData
  })

  try {
    const result = await host.request('transcribe', {
      modelPaths,
      source: { kind: 'wav', filePath: inputPath }
    })
    const transcriptNonEmpty = result.text.trim().length > 0
    if (!transcriptNonEmpty || result.segments.length === 0) throw new Error('FunASR returned no speech')
    process.stdout.write(
      `${JSON.stringify({
        transcriptNonEmpty,
        segmentCount: result.segments.length,
        firstSegmentStart: result.segments[0].start,
        lastSegmentEnd: result.segments.at(-1)?.end ?? 0,
        ...(networkDenied ? { networkDenied: true } : {})
      })}\n`
    )
  } finally {
    await host.dispose().catch(() => {})
  }
}

void app.whenReady().then(async () => {
  app.dock?.hide()
  const timeout = setTimeout(() => {
    process.stderr.write('FunASR validation timed out\n')
    app.exit(1)
  }, 10 * 60_000)
  timeout.unref()
  try {
    await run()
    clearTimeout(timeout)
    app.exit(0)
  } catch (error) {
    clearTimeout(timeout)
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    app.exit(1)
  } finally {
    fs.rmSync(validationUserData, { recursive: true, force: true })
  }
})
