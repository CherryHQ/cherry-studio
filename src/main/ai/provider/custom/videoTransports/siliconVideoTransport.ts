/**
 * Silicon Flow text-to-video transport.
 * Submit: POST https://api.siliconflow.cn/v1/video/submit
 * Poll:   GET  https://api.siliconflow.cn/v1/video/status/{requestId}
 */

import type {
  VideoGenerationSubmitInput,
  VideoGenerationTransport,
  VideoTransportFactory
} from '../videoGenerationModel'

const BASE_URL = 'https://api.siliconflow.cn/v1/video'

type SiliconStatus = 'InQueue' | 'Processing' | 'Succeed' | 'Failed'

function createSiliconTransport(apiKey: string): VideoGenerationTransport {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }

  return {
    async submit(input: VideoGenerationSubmitInput): Promise<string> {
      const res = await fetch(`${BASE_URL}/submit`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: input.modelId,
          prompt: input.prompt,
          image_size: input.resolution ?? '1280x720',
          num_frames: input.duration ? Math.round(input.duration * 8) : 40
        })
      })
      if (!res.ok) throw new Error(`Silicon submit failed: ${res.status} ${await res.text()}`)
      const data = (await res.json()) as { requestId?: string }
      if (!data.requestId) throw new Error('Silicon: no requestId in submit response')
      return data.requestId
    },

    async poll(requestId: string, signal?: AbortSignal): Promise<string | null> {
      const res = await fetch(`${BASE_URL}/status/${requestId}`, { headers, signal })
      if (!res.ok) throw new Error(`Silicon poll failed: ${res.status}`)
      const data = (await res.json()) as { status?: SiliconStatus; video?: { url?: string }; message?: string }
      if (data.status === 'Succeed') {
        if (!data.video?.url) throw new Error('Silicon: Succeed but no video url')
        return data.video.url
      }
      if (data.status === 'Failed') throw new Error(`Silicon video failed: ${data.message ?? 'unknown'}`)
      return null
    }
  }
}

export const siliconVideoTransportFactory: VideoTransportFactory = createSiliconTransport
