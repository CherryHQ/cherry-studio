import { exec } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { application } from '@application'
import { isWin } from '@main/constant'
import type { FileProcessorMerged } from '@shared/data/presets/file-processing'
import type { FileMetadata } from '@types'
import { isImageFileMetadata } from '@types'

import type { ImageToTextHandlerOutput } from '../types'
import type { PreparedOvOcrContext } from './types'

const execAsync = promisify(exec)

export function prepareContext(
  file: FileMetadata,
  _config: FileProcessorMerged,
  signal?: AbortSignal
): PreparedOvOcrContext {
  signal?.throwIfAborted()

  if (!isImageFileMetadata(file)) {
    throw new Error('OV OCR only supports image files')
  }

  if (!isAvailable()) {
    throw new Error('OV OCR is not available on this device')
  }

  return {
    file,
    workingDirectoryPrefix: path.join(application.getPath('app.temp'), 'cherry-ovocr-')
  }
}

export async function executeExtraction(context: PreparedOvOcrContext): Promise<ImageToTextHandlerOutput> {
  context.signal?.throwIfAborted()

  let workingDirectory: string | null = null

  try {
    workingDirectory = await fs.promises.mkdtemp(context.workingDirectoryPrefix)
    const imgDirectory = path.join(workingDirectory, 'img')
    const outputDirectory = path.join(workingDirectory, 'output')

    await prepareWorkingDirectory(imgDirectory)
    await prepareWorkingDirectory(outputDirectory)

    const fileName = path.basename(context.file.path)
    await fs.promises.copyFile(context.file.path, path.join(imgDirectory, fileName))

    // TODO(file-processing): Once unified ProcessManagerService lands, delegate
    // OV OCR process lifecycle/logging/restart handling there and keep this
    // provider focused on input/output preparation plus result parsing.
    await execAsync(`"${getOvOcrScriptPath()}"`, {
      cwd: workingDirectory,
      timeout: 60000,
      signal: context.signal
    })

    const baseNameWithoutExt = path.basename(fileName, path.extname(fileName))
    const outputFilePath = path.join(outputDirectory, `${baseNameWithoutExt}.txt`)

    if (!fs.existsSync(outputFilePath)) {
      throw new Error(`OV OCR output file not found at: ${outputFilePath}`)
    }

    context.signal?.throwIfAborted()

    return {
      kind: 'text',
      text: await fs.promises.readFile(outputFilePath, 'utf-8')
    }
  } finally {
    if (workingDirectory) {
      await fs.promises.rm(workingDirectory, { recursive: true, force: true })
    }
  }
}

function isAvailable(): boolean {
  return (
    isWin &&
    os.cpus()[0]?.model.toLowerCase().includes('intel') &&
    os.cpus()[0]?.model.toLowerCase().includes('ultra') &&
    fs.existsSync(getOvOcrScriptPath())
  )
}

function getOvOcrScriptPath(): string {
  return application.getPath('feature.ovms.ovocr', 'run.npu.bat')
}

async function prepareWorkingDirectory(dirPath: string): Promise<void> {
  await fs.promises.rm(dirPath, { recursive: true, force: true })
  await fs.promises.mkdir(dirPath, { recursive: true })
}
