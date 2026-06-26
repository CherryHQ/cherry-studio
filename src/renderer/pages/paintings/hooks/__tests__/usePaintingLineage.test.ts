import type { FileMetadata } from '@renderer/types/file'
import type { FileEntry } from '@shared/data/types/file/fileEntry'
import { describe, expect, it } from 'vitest'

import type { PaintingData } from '../../model/types/paintingData'
import { buildPaintingLineageEdges } from '../usePaintingLineage'

const output = (id: string): FileMetadata => ({ id }) as FileMetadata
const input = (id: string): FileEntry => ({ id }) as FileEntry

function painting(id: string, opts: { outputs?: string[]; inputs?: string[] } = {}): PaintingData {
  return {
    id,
    providerId: 'p',
    mode: 'generate',
    prompt: '',
    files: (opts.outputs ?? []).map(output),
    inputFiles: (opts.inputs ?? []).map(input)
  }
}

describe('buildPaintingLineageEdges', () => {
  it('connects a derived card to the card that produced its input', () => {
    const a = painting('A', { outputs: ['f1'] })
    const b = painting('B', { outputs: ['f2'], inputs: ['f1'] })

    expect(buildPaintingLineageEdges([a, b])).toEqual([{ id: 'A->B', source: 'A', target: 'B' }])
  })

  it('emits no edge for a user-uploaded input that no card produced', () => {
    const b = painting('B', { inputs: ['upload-x'] })
    expect(buildPaintingLineageEdges([b])).toEqual([])
  })

  it('ignores a self-referential input (output reused as own input)', () => {
    const a = painting('A', { outputs: ['f1'], inputs: ['f1'] })
    expect(buildPaintingLineageEdges([a])).toEqual([])
  })

  it('dedupes when a card uses two outputs of the same source', () => {
    const a = painting('A', { outputs: ['f1', 'f2'] })
    const merged = painting('M', { inputs: ['f1', 'f2'] })

    expect(buildPaintingLineageEdges([a, merged])).toEqual([{ id: 'A->M', source: 'A', target: 'M' }])
  })

  it('fans multiple sources into one merge card', () => {
    const a = painting('A', { outputs: ['f1'] })
    const b = painting('B', { outputs: ['f2'] })
    const merged = painting('M', { inputs: ['f1', 'f2'] })

    expect(buildPaintingLineageEdges([a, b, merged])).toEqual([
      { id: 'A->M', source: 'A', target: 'M' },
      { id: 'B->M', source: 'B', target: 'M' }
    ])
  })
})
