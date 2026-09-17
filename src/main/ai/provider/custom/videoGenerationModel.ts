import type { UniqueModelId } from '@shared/data/types/model'

/**
 * Video generation transport interface.
 *
 * All video generation providers share this interface: submit a prompt,
 * get back a taskId, then poll until the video URL is ready. The caller
 * (videoGenerationJobHandler) owns the polling loop.
 *
 * A transport is created via a factory that captures the API key, so
 * poll() never needs the key explicitly and a restarted job can rebuild
 * the transport from the persisted provider config.
 */

export interface VideoGenerationTransport {
  /** Submit a generation request; returns a provider task ID. */
  submit(input: VideoGenerationSubmitInput): Promise<string>
  /**
   * Poll once. Returns the video URL when done, null while still in progress.
   * Throws on terminal failure.
   */
  poll(taskId: string, signal?: AbortSignal): Promise<string | null>
  /** Request cancellation (best-effort — providers may not support it). */
  cancel?(taskId: string): Promise<void>
}

export type VideoTransportFactory = (apiKey: string) => VideoGenerationTransport

export interface VideoGenerationSubmitInput {
  /** Provider-scoped model identifier (e.g. "wanx2.1-t2v-turbo"). */
  modelId: string
  prompt: string
  /** Seconds; provider caps apply. */
  duration?: number
  /** e.g. "1280:720" */
  resolution?: string
}

export interface VideoGenerationJobInput {
  /** UniqueModelId format: "providerId::modelId". */
  uniqueModelId: UniqueModelId
  prompt: string
  duration?: number
  resolution?: string
  /** Pre-persisted video row id — written before enqueue so a restart can resume. */
  videoId: string
}

export interface VideoGenerationJobOutput {
  /** Remote URL of the finished video. */
  videoUrl: string
}
