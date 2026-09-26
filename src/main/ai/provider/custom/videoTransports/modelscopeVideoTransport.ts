/**
 * ModelScope (Alibaba / CogVideoX) text-to-video transport.
 * Uses the DashScope-compatible API for Wan2.1 series models.
 * Submit: POST https://dashscope.aliyuncs.com/api/v1/services/aigc/video-synthesis/video-synthesis
 * Poll:   GET  https://dashscope.aliyuncs.com/api/v1/tasks/{taskId}
 */

import type {
  VideoGenerationSubmitInput,
  VideoGenerationTransport,
  VideoTransportFactory
} from '../videoGenerationModel'

const BASE_URL = 'https://dashscope.aliyuncs.com/api/v1'

type DashScopeStatus = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED' | 'UNKNOWN'

function createModelscopeTransport(apiKey: string): VideoGenerationTransport {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }

  return {
    async submit(input: VideoGenerationSubmitInput): Promise<string> {
      const res = await fetch(`${BASE_URL}/services/aigc/video-synthesis/video-synthesis`, {
        method: 'POST',
        headers: { ...headers, 'X-DashScope-Async': 'enable' },
        body: JSON.stringify({
          model: input.modelId,
          input: { prompt: input.prompt },
          parameters: {
            duration: input.duration ?? 5,
            resolution: input.resolution ?? '1280*720'
          }
        })
      })
      if (!res.ok) throw new Error(`ModelScope submit failed: ${res.status} ${await res.text()}`)
      const data = (await res.json()) as { output?: { task_id?: string } }
      const taskId = data.output?.task_id
      if (!taskId) throw new Error('ModelScope: no task_id in submit response')
      return taskId
    },

    async poll(taskId: string, signal?: AbortSignal): Promise<string | null> {
      const res = await fetch(`${BASE_URL}/tasks/${taskId}`, { headers, signal })
      if (!res.ok) throw new Error(`ModelScope poll failed: ${res.status}`)
      const data = (await res.json()) as {
        output?: {
          task_status: DashScopeStatus
          video_url?: string
          results?: Array<{ url?: string }>
          message?: string
          code?: string
        }
      }
      const output = data.output
      if (!output) throw new Error('ModelScope: empty poll response')
      if (output.task_status === 'SUCCEEDED') {
        const url = output.video_url ?? output.results?.[0]?.url
        if (!url) throw new Error('ModelScope: SUCCEEDED but no video url')
        return url
      }
      if (output.task_status === 'FAILED' || output.task_status === 'CANCELED') {
        throw new Error(`ModelScope video ${output.task_status}: ${output.message ?? output.code ?? 'unknown'}`)
      }
      return null
    }
  }
}

export const modelscopeVideoTransportFactory: VideoTransportFactory = createModelscopeTransport
