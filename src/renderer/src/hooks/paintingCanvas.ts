import FileManager from '@renderer/services/FileManager'
import type { FileMetadata, PaintingCanvas } from '@renderer/types'
import type { CreatePaintingDto, UpdatePaintingDto } from '@shared/data/api/schemas/paintings'
import type { Painting as PaintingRecord, PaintingMode } from '@shared/data/types/painting'

const RESERVED_CANVAS_KEYS = new Set(['id', 'providerId', 'mode', 'files', 'model', 'prompt'])

type CreateCanvas = PaintingCanvas & {
  providerId: string
  mode: PaintingMode
}

function getTopLevelFileIds(files: unknown): string[] {
  if (!Array.isArray(files)) return []

  return files.flatMap((file) => {
    if (file && typeof file === 'object' && 'id' in file && typeof file.id === 'string') {
      return [file.id]
    }

    return []
  })
}

function getCanvasParams(canvas: PaintingCanvas): Record<string, unknown> {
  return Object.fromEntries(Object.entries(canvas).filter(([key]) => !RESERVED_CANVAS_KEYS.has(key)))
}

export async function toCanvas(record: PaintingRecord): Promise<PaintingCanvas> {
  const files = (
    await Promise.all((record.files?.output ?? []).map(async (id) => (await FileManager.getFile(id)) ?? null))
  ).filter((file): file is FileMetadata => Boolean(file))

  return {
    id: record.id,
    providerId: record.providerId,
    model: record.model ?? undefined,
    prompt: record.prompt,
    files,
    ...record.params
  } as PaintingCanvas
}

export function toCanvases(records: PaintingRecord[]): Promise<PaintingCanvas[]> {
  return Promise.all(records.map(toCanvas))
}

export function toCreateDto(canvas: CreateCanvas): CreatePaintingDto {
  return {
    id: canvas.id,
    providerId: canvas.providerId,
    mode: canvas.mode,
    model: typeof canvas.model === 'string' && canvas.model.trim() ? canvas.model : undefined,
    prompt: canvas.prompt ?? '',
    params: getCanvasParams(canvas),
    files: { output: getTopLevelFileIds(canvas.files), input: [] }
  }
}

export function toUpdateDto(canvas: PaintingCanvas): UpdatePaintingDto {
  return {
    model: typeof canvas.model === 'string' && canvas.model.trim() ? canvas.model : undefined,
    prompt: canvas.prompt ?? '',
    params: getCanvasParams(canvas),
    files: { output: getTopLevelFileIds(canvas.files), input: [] }
  }
}
