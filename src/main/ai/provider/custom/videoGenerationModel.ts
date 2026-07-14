/**
 * Video-generation transport contract — the video counterpart of
 * `ImageGenerationTransport` (`imageGenerationModel.ts`), minus the
 * `createVideoGenerationModel` factory: aggregator video runs exclusively on the
 * job system (`videoGenerationJobHandler`), which calls `submit`/`poll` directly,
 * so there is no in-SDK `VideoModelV3` wrapper. Native providers (Veo / Grok /
 * Luma / Kling / Seedance / Wan) bypass this entirely via `provider.videoModel()`.
 *
 * Every aggregator (DMXAPI / PPIO / AiHubMix) is submit → poll → signed URL.
 */

/** Provider-agnostic submit payload. Media inputs are data-URLs or http(s) URLs (resolved from FileEntry ids by the handler). */
export interface VideoGenerationSubmitInput {
  /** The vendor API model id (apiModelId), e.g. `happyhorse-1.0-t2v`. */
  modelId: string
  prompt: string | undefined
  /** Image-to-video start frame. */
  firstFrame?: string
  /** End frame for first+last-frame models. */
  lastFrame?: string
  /** Reference/subject images for consistency. */
  referenceImages?: string[]
  /** Input video for extend / video-to-video. */
  inputVideo?: string
  /** Input audio for lip-sync / audio-driven generation. */
  inputAudio?: string
  /**
   * Mapped scalar params (resolution / duration / ratio / seed / watermark / …)
   * by `buildVideoProviderOptions`, keyed under the provider id. The transport
   * reads its own bag (`providerParams[<providerId>]`) for the request body.
   */
  providerParams: Record<string, unknown>
  /** Forwarded from the IPC abort signal; single-shot transports use it to cancel `submit`. */
  signal?: AbortSignal
}

export interface VideoPollOptions {
  signal?: AbortSignal
  onProgress?: (progress: number) => void
  /** Submit-time vendor bag, so a restart-resumed poll can rebuild per-task state. */
  providerParams?: Record<string, unknown>
}

/**
 * A produced video. Most vendors return a public, signed URL the handler downloads
 * unauthenticated (`url`). AiHubMix-style vendors deliver the result only via an
 * AUTHENTICATED binary endpoint, so the transport fetches the bytes itself and returns
 * them (`bytes`) for the handler to persist directly.
 */
export type VideoArtifact = { url: string } | { bytes: Uint8Array; mediaType?: string }

export interface VideoGenerationTransport {
  /** Submit a generation task. Returns a `taskId` to poll, or `videos` directly for sync vendors. */
  submit(input: VideoGenerationSubmitInput): Promise<{ taskId?: string; videos?: VideoArtifact[] }>
  /** Poll until the task completes; resolves to the produced video artifact(s). */
  poll?(taskId: string, options: VideoPollOptions): Promise<VideoArtifact[]>
  /** Best-effort remote cancel on abort. */
  cancel?(taskId: string): Promise<void>
}
