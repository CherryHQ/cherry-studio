/**
 * Fixture data for issue #8880 — Gemini citation over-matching.
 *
 * groundingMetadata sourced from a real Gemini 3 Pro response to the query
 * "请搜索二氧化硫能否燃烧" (Can sulfur dioxide burn?).
 *
 * The content is reconstructed so that segment byte offsets align exactly
 * with the groundingSupports data; gaps between segments are filled with
 * ASCII spaces (1 byte each) to preserve byte positions.
 */
import type { GroundingChunk, GroundingMetadata, GroundingSupport } from '@google/genai'

export const groundingChunks: GroundingChunk[] = [
  { web: { uri: 'https://example.com/teck', title: 'teck.com' } },
  { web: { uri: 'https://example.com/service-gov', title: 'service.gov.uk' } },
  { web: { uri: 'https://example.com/mozaweb', title: 'mozaweb.com' } },
  { web: { uri: 'https://example.com/ivhhn', title: 'ivhhn.org' } },
  { web: { uri: 'https://example.com/airliquide', title: 'airliquide.com' } },
  { web: { uri: 'https://example.com/osha', title: 'osha.gov.tw' } },
  { web: { uri: 'https://example.com/ccohs', title: 'ccohs.ca' } }
]

export const groundingSupports: GroundingSupport[] = [
  {
    segment: {
      endIndex: 99,
      text: '**二氧化硫（$SO_2$）不能燃烧**，它是一种**不可燃**且通常**不助燃**的气体'
    },
    groundingChunkIndices: [0, 1, 2]
  },
  {
    segment: {
      startIndex: 184,
      endIndex: 275,
      text: '**不可燃性**：在日常和消防标准中，二氧化硫被明确归类为不燃气体'
    },
    groundingChunkIndices: [0, 3, 4]
  },
  {
    segment: {
      startIndex: 278,
      endIndex: 332,
      text: '它本身就是硫或含硫化合物燃烧后的产物'
    },
    groundingChunkIndices: [2, 5]
  },
  {
    segment: {
      startIndex: 861,
      endIndex: 1097,
      text: '**安全警告**：虽然二氧化硫本身不会燃烧，但需要注意的是，如果装有高压液态二氧化硫的钢瓶或储罐被卷入火灾中，受热会导致容器内压力急剧上升，有**发生物理爆炸**的危险'
    },
    groundingChunkIndices: [0, 6]
  },
  {
    segment: {
      startIndex: 1100,
      endIndex: 1226,
      text: '此外，二氧化硫是一种具有强烈刺激性和腐蚀性的有毒气体，吸入会对人体呼吸道造成严重伤害'
    },
    groundingChunkIndices: [0, 6, 4]
  },
  {
    segment: {
      startIndex: 1231,
      endIndex: 1286,
      text: '总结来说，二氧化硫自身绝对**不能燃烧**'
    },
    groundingChunkIndices: [0, 6]
  }
]

export const groundingMetadata: GroundingMetadata = {
  groundingChunks,
  groundingSupports,
  webSearchQueries: ['Is sulfur dioxide flammable', '"二氧化硫" 能否燃烧']
}

/**
 * Build a content string where segments sit at their correct UTF-8 byte
 * positions. Gaps are filled with ASCII spaces so byte offsets stay valid.
 */
export function buildContent(): string {
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  const totalBytes = 1286 // endIndex of the last segment
  const buffer = new Uint8Array(totalBytes).fill(0x20) // ASCII space

  for (const support of groundingSupports) {
    if (!support.segment?.text) continue
    const start = support.segment.startIndex ?? 0
    buffer.set(encoder.encode(support.segment.text), start)
  }

  return decoder.decode(buffer)
}
