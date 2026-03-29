import { exec } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { loggerService } from '@logger'
import { isWin } from '@main/constant'
import { HOME_CHERRY_DIR } from '@shared/config/constant'
import type { FileProcessorMerged } from '@shared/data/presets/file-processing'
import type { FileMetadata } from '@types'
import { isImageFileMetadata } from '@types'

import type { FileProcessingTextExtractionResult } from '../../../types'
import type { PreparedOvOcrContext } from './type'

const logger = loggerService.withContext('FileProcessing:OvOcrProcessor')
const execAsync = promisify(exec)
const PATH_BAT_FILE = path.join(os.homedir(), HOME_CHERRY_DIR, 'ovms', 'ovocr', 'run.npu.bat')

export function prepareContext(
  file: FileMetadata,
  config: FileProcessorMerged,
  signal?: AbortSignal
): PreparedOvOcrContext {
  logger.debug(`OvOcr Processor: ${config.id}`)
  if (!isImageFileMetadata(file)) {
    throw new Error('OV OCR only supports image files')
  }

  if (!isAvailable()) {
    throw new Error('OV OCR is not available on this device')
  }

  return {
    file,
    signal
  }
}

export async function executeExtraction(context: PreparedOvOcrContext): Promise<FileProcessingTextExtractionResult> {
  context.signal?.throwIfAborted()

  logger.info(`OV OCR called on ${context.file.path}`)

  await prepareWorkingDirectory(getImgDir())
  await prepareWorkingDirectory(getOutputDir())

  const fileName = path.basename(context.file.path)
  await fs.promises.copyFile(context.file.path, path.join(getImgDir(), fileName))

  await execAsync(`"${PATH_BAT_FILE}"`, {
    cwd: getOvOcrPath(),
    timeout: 60000
  })

  const baseNameWithoutExt = path.basename(fileName, path.extname(fileName))
  const outputFilePath = path.join(getOutputDir(), `${baseNameWithoutExt}.txt`)

  if (!fs.existsSync(outputFilePath)) {
    throw new Error(`OV OCR output file not found at: ${outputFilePath}`)
  }

  context.signal?.throwIfAborted()

  return {
    text: await fs.promises.readFile(outputFilePath, 'utf-8')
  }
}

function isAvailable(): boolean {
  return (
    isWin &&
    os.cpus()[0]?.model.toLowerCase().includes('intel') &&
    os.cpus()[0]?.model.toLowerCase().includes('ultra') &&
    fs.existsSync(PATH_BAT_FILE)
  )
}

function getOvOcrPath(): string {
  return path.join(os.homedir(), HOME_CHERRY_DIR, 'ovms', 'ovocr')
}

function getImgDir(): string {
  return path.join(getOvOcrPath(), 'img')
}

function getOutputDir(): string {
  return path.join(getOvOcrPath(), 'output')
}

async function prepareWorkingDirectory(dirPath: string): Promise<void> {
  await fs.promises.rm(dirPath, { recursive: true, force: true })
  await fs.promises.mkdir(dirPath, { recursive: true })
}
