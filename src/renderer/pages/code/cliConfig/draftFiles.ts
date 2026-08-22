import { CLI_CONFIG_FILE_SPECS } from '@shared/utils/cliConfig'

import { parseDotenv } from './dotenv'
import { type CliConfigReadFiles, parseJsonOrThrow, parseTomlOrThrow, readConfigFiles, requireReadFile } from './file'
import type { CliConfigFileDraft, CliConfigTarget } from './types'

export function getDraftFile(
  files: CliConfigFileDraft[] | undefined,
  target: CliConfigTarget
): CliConfigFileDraft | undefined {
  return files?.find((file) => file.target === target)
}

/**
 * Read view for a draft rebuild: targets covered by an in-progress draft are served
 * from it (no disk IO — a failing read must not block a rebuild the draft already
 * has everything for); only uncovered targets cross to `code_cli.read_config`.
 */
export async function readConfigFilesForDraft(
  targets: readonly CliConfigTarget[],
  files: CliConfigFileDraft[] | undefined
): Promise<CliConfigReadFiles> {
  const read = await readConfigFiles(targets.filter((target) => !getDraftFile(files, target)))
  for (const target of targets) {
    const draft = getDraftFile(files, target)
    if (draft && !read.has(target)) read.set(target, { path: draft.path, content: draft.content })
  }
  return read
}

/** Draft entry for freshly-rendered content; the path is the main-resolved one from the batch read. */
export function makeDraftFile(target: CliConfigTarget, content: string, read: CliConfigReadFiles): CliConfigFileDraft {
  const spec = CLI_CONFIG_FILE_SPECS[target]
  return { target, label: spec.label, path: requireReadFile(target, read).path, language: spec.language, content }
}

/** Current text of `target`: an in-progress draft overrides the on-disk file ('' when missing on disk). */
export function readDraftFileText(
  target: CliConfigTarget,
  files: CliConfigFileDraft[] | undefined,
  read: CliConfigReadFiles
): string {
  const draft = getDraftFile(files, target)
  if (draft) return draft.content
  return requireReadFile(target, read).content ?? ''
}

/** Parse a draft/on-disk config file, wrapping a parse failure with the file's label and path. */
export function readAndParseDraftFile<T>(
  target: CliConfigTarget,
  parseFn: (content: string) => T,
  files: CliConfigFileDraft[] | undefined,
  read: CliConfigReadFiles
): T {
  const content = readDraftFileText(target, files, read)
  try {
    return parseFn(content)
  } catch (err) {
    // parseFn (parseJsonOrThrow/parseTomlOrThrow) already redacts its own message at the source.
    const spec = CLI_CONFIG_FILE_SPECS[target]
    const path = getDraftFile(files, target)?.path ?? requireReadFile(target, read).path
    const rawMessage = err instanceof Error ? err.message : String(err)
    throw new Error(`Failed to parse ${spec.label} at ${path}: ${rawMessage}`)
  }
}

function parseDraftFile(file: CliConfigFileDraft): Record<string, any> | Map<string, string> {
  switch (file.language) {
    case 'json':
      return parseJsonOrThrow(file.content)
    case 'toml':
      return parseTomlOrThrow(file.content)
    case 'dotenv':
      return parseDotenv(file.content)
  }
}

export function validateCliConfigDraftForWrite(files: CliConfigFileDraft[]): void {
  for (const file of files) parseDraftFile(file)
}
