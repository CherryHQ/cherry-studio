/**
 * DashScope (Alibaba Cloud) text-to-video transport.
 * Submit: POST https://dashscope.aliyuncs.com/api/v1/services/aigc/video-synthesis/generation
 * Poll:   GET  https://dashscope.aliyuncs.com/api/v1/tasks/{taskId}
 */

import type {
  VideoGenerationSubmitInput,
  VideoGenerationTransport,
  VideoTransportFactory
} from '../videoGenerationModel'

const BASE_URL = 'https://dashscope.aliyuncs.com/api/v1'

type DashScopeStatus = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED' | 'UNKNOWN'

function createDashscopeTransport(apiKey: string): VideoGenerationTransport {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }

  return {
    async submit(input: VideoGenerationSubmitInput): Promise<string> {
      const res = await fetch(`${BASE_URL}/services/aigc/video-synthesis/generation`, {
        method: 'POST',
        headers: { ...headers, 'X-DashScope-Async': 'enable' },
        body: JSON.stringify({
          model: input.modelId,
          input: { prompt: input.prompt },
          parameters: {
            duration: input.duration ?? 5,
            size: input.resolution?.replace(':', '*') ?? '1280*720'
          }
        })
      })
      if (!res.ok) throw new Error(`DashScope submit failed: ${res.status} ${await res.text()}`)
      const data = (await res.json()) as { output?: { task_id?: string } }
      const taskId = data.output?.task_id
      if (!taskId) throw new Error('DashScope: no task_id in submit response')
      return taskId
    },

    async poll(taskId: string, signal?: AbortSignal): Promise<string | null> {
      const res = await fetch(`${BASE_URL}/tasks/${taskId}`, { headers, signal })
      if (!res.ok) throw new Error(`DashScope poll failed: ${res.status}`)
      const data = (await res.json()) as {
        output?: { task_status: DashScopeStatus; video_url?: string; message?: string; code?: string }
      }
      const output = data.output
      if (!output) throw new Error('DashScope: empty poll response')
      if (output.task_status === 'SUCCEEDED') {
        if (!output.video_url) throw new Error('DashScope: SUCCEEDED but no video_url')
        return output.video_url
      }
      if (output.task_status === 'FAILED' || output.task_status === 'CANCELED') {
        throw new Error(`DashScope video ${output.task_status}: ${output.message ?? output.code ?? 'unknown'}`)
      }
      return null
    }
  }
}

export const dashscopeVideoTransportFactory: VideoTransportFactory = createDashscopeTransport
