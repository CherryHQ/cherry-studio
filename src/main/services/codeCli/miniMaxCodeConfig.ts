import path from 'node:path'

import { atomicWriteFile, ensureDir, read } from '@main/utils/file'
import { type AbsoluteFilePath, AbsoluteFilePathSchema } from '@shared/types/file'
import { Document, isMap, parseDocument } from 'yaml'

const MCODE_CONFIG_FILE_MODE = 0o600

interface PreviousConfigValue {
  present: boolean
  value?: unknown
}

export interface MiniMaxCodeSelectionReceipt {
  configPath: AbsoluteFilePath
  appliedDefaultModel: string
  defaultModel: PreviousConfigValue
  defaultModelVariant: PreviousConfigValue
}

function readEnvironmentPath(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}

export function resolveMiniMaxCodeConfigPath(
  environment: Record<string, string>,
  systemHome: string
): AbsoluteFilePath {
  const configuredDataDir =
    readEnvironmentPath(environment.MINIMAX_DATA_DIR) ?? readEnvironmentPath(environment.MAVIS_DATA_DIR)
  const home = readEnvironmentPath(environment.HOME) ?? readEnvironmentPath(environment.USERPROFILE) ?? systemHome
  const dataDir = configuredDataDir ? path.resolve(configuredDataDir) : path.join(home, '.minimax')
  return AbsoluteFilePathSchema.parse(path.join(dataDir, 'config.yaml'))
}

function describeYamlError(error: { message: string; linePos?: Array<{ line: number; col: number }> }): string {
  const at = error.linePos?.[0]
  const location = at ? ` at line ${at.line}, column ${at.col}` : ''
  return `${error.message}${location}`
}

async function readConfigDocument(configPath: AbsoluteFilePath): Promise<Document> {
  let content: string | undefined
  try {
    content = await read(configPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  const document = content === undefined ? new Document({}) : parseDocument(content)
  if (document.errors.length > 0) {
    throw new Error(`Invalid MiniMax Code config YAML: ${describeYamlError(document.errors[0])}`)
  }
  if (document.contents === null) document.contents = document.createNode({})
  if (!isMap(document.contents)) throw new Error('MiniMax Code config.yaml must contain a YAML mapping')
  return document
}

function snapshotValue(document: Document, key: string): PreviousConfigValue {
  const root = document.toJS() as Record<string, unknown>
  return Object.prototype.hasOwnProperty.call(root, key) ? { present: true, value: root[key] } : { present: false }
}

async function writeConfigDocument(configPath: AbsoluteFilePath, document: Document): Promise<void> {
  await ensureDir(AbsoluteFilePathSchema.parse(path.dirname(configPath)))
  await atomicWriteFile(configPath, String(document), { mode: MCODE_CONFIG_FILE_MODE })
}

export async function activateMiniMaxCodeModel(
  environment: Record<string, string>,
  systemHome: string,
  providerId: string,
  modelId: string
): Promise<MiniMaxCodeSelectionReceipt> {
  const configPath = resolveMiniMaxCodeConfigPath(environment, systemHome)
  const document = await readConfigDocument(configPath)
  const appliedDefaultModel = `${providerId}/${modelId}`
  const receipt: MiniMaxCodeSelectionReceipt = {
    configPath,
    appliedDefaultModel,
    defaultModel: snapshotValue(document, 'defaultModel'),
    defaultModelVariant: snapshotValue(document, 'defaultModelVariant')
  }

  document.setIn(['defaultModel'], appliedDefaultModel)
  document.deleteIn(['defaultModelVariant'])
  await writeConfigDocument(configPath, document)
  return receipt
}

function restoreValue(document: Document, key: string, previous: PreviousConfigValue): void {
  if (previous.present) document.setIn([key], previous.value)
  else document.deleteIn([key])
}

export async function restoreMiniMaxCodeSelection(receipt: MiniMaxCodeSelectionReceipt): Promise<void> {
  const document = await readConfigDocument(receipt.configPath)
  const currentDefaultModel = snapshotValue(document, 'defaultModel')
  const currentVariant = snapshotValue(document, 'defaultModelVariant')
  if (currentDefaultModel.value !== receipt.appliedDefaultModel || currentVariant.present) {
    throw new Error('MiniMax Code model selection changed before rollback')
  }
  restoreValue(document, 'defaultModel', receipt.defaultModel)
  restoreValue(document, 'defaultModelVariant', receipt.defaultModelVariant)
  await writeConfigDocument(receipt.configPath, document)
}
