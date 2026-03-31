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

  const workingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'cherry-ovocr-'))
  const imgDirectory = path.join(workingDirectory, 'img')
  const outputDirectory = path.join(workingDirectory, 'output')

  return {
    file,
    signal,
    workingDirectory,
    imgDirectory,
    outputDirectory
  }
}

export async function executeExtraction(context: PreparedOvOcrContext): Promise<FileProcessingTextExtractionResult> {
  context.signal?.throwIfAborted()

  logger.info(`OV OCR called on ${context.file.path}`, {
    workingDirectory: context.workingDirectory
  })

  try {
    await prepareWorkingDirectory(context.imgDirectory)
    await prepareWorkingDirectory(context.outputDirectory)

    const fileName = path.basename(context.file.path)
    await fs.promises.copyFile(context.file.path, path.join(context.imgDirectory, fileName))

    // TODO(file-processing): Once unified ProcessManagerService lands, delegate
    // OV OCR process lifecycle/logging/restart handling there and keep this
    // provider focused on input/output preparation plus result parsing.
    await execAsync(`"${PATH_BAT_FILE}"`, {
      cwd: context.workingDirectory,
      timeout: 60000
    })

    const baseNameWithoutExt = path.basename(fileName, path.extname(fileName))
    const outputFilePath = path.join(context.outputDirectory, `${baseNameWithoutExt}.txt`)

    if (!fs.existsSync(outputFilePath)) {
      throw new Error(`OV OCR output file not found at: ${outputFilePath}`)
    }

    context.signal?.throwIfAborted()

    return {
      text: await fs.promises.readFile(outputFilePath, 'utf-8')
    }
  } finally {
    await fs.promises.rm(context.workingDirectory, { recursive: true, force: true })
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

async function prepareWorkingDirectory(dirPath: string): Promise<void> {
  await fs.promises.rm(dirPath, { recursive: true, force: true })
  await fs.promises.mkdir(dirPath, { recursive: true })
}
