import type { BaseNode, Document, Metadata } from '@vectorstores/core'
import { buildNodeFromSplits, MetadataMode } from '@vectorstores/core'

type ChunkOptions = {
  chunkSize: number
  chunkOverlap: number
}

const normalizeChunkOptions = ({ chunkSize, chunkOverlap }: ChunkOptions) => {
  const normalizedSize = Math.max(1, Math.floor(chunkSize))
  const normalizedOverlap = Math.max(0, Math.min(Math.floor(chunkOverlap), normalizedSize - 1))
  const step = Math.max(1, normalizedSize - normalizedOverlap)

  return { normalizedSize, normalizedOverlap, step }
}

const splitTextByFixedSize = (text: string, options: ChunkOptions): string[] => {
  if (!text) {
    return []
  }

  const { normalizedSize, step } = normalizeChunkOptions(options)
  const chunks: string[] = []

  for (let start = 0; start < text.length; start += step) {
    const chunk = text.slice(start, start + normalizedSize).trim()
    if (chunk.length > 0) {
      chunks.push(chunk)
    }
  }

  return chunks
}

export const TextChunkSplitter = (documents: Document[], options: ChunkOptions): BaseNode<Metadata>[] => {
  const nodes: BaseNode<Metadata>[] = []

  for (const document of documents) {
    const text = document.getContent(MetadataMode.NONE)
    const splits = splitTextByFixedSize(text, options)
    if (splits.length === 0) {
      continue
    }
    nodes.push(...buildNodeFromSplits(splits, document))
  }

  return nodes
}
