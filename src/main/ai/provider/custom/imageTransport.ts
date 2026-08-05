import type { ImageModelV3CallOptions } from '@ai-sdk/provider'
import type { ImageSizeToken } from '@main/ai/utils/aiSdkNativeBindings'
import type { VendorBag, WireVendorBag } from '@main/ai/utils/imageOptions'
import type { ImageGenerationMode } from '@shared/data/types/model'

export interface ImageTransportDescriptor {
  id: string
  endpoint: string
  isSync?: boolean
  mode?: ImageGenerationMode
}

export interface ImageTransportInputSupport {
  readonly files: boolean
  readonly mask: boolean
}

export type NonEmptyImageUrls = [string, ...string[]]

export type ImageTransportSubmission =
  | { kind: 'completed'; imageUrls: NonEmptyImageUrls }
  | { kind: 'submitted'; taskId: string }

export type ImageTransportTaskState =
  | { kind: 'pending'; progress?: number }
  | { kind: 'completed'; imageUrls: NonEmptyImageUrls }
  | { kind: 'failed'; message: string }

export interface ImageTransportPollPolicy {
  readonly initialDelayMs: number
  readonly maxAttempts: number | null
  readonly maxElapsedMs: number | null
  readonly maxConsecutiveErrors: number
  readonly getDelayMs: (elapsedMs: number) => number
}

export const ADAPTIVE_IMAGE_POLL_POLICY: ImageTransportPollPolicy = {
  initialDelayMs: 0,
  maxAttempts: 120,
  maxElapsedMs: null,
  maxConsecutiveErrors: 10,
  getDelayMs: (elapsedMs) => (elapsedMs < 60_000 ? 3_000 : 10_000)
}

export const AIHUBMIX_FLUX_POLL_POLICY: ImageTransportPollPolicy = {
  initialDelayMs: 2_000,
  maxAttempts: null,
  maxElapsedMs: 5 * 60_000,
  maxConsecutiveErrors: 10,
  getDelayMs: () => 2_000
}

export type ImageTransportCancelCapability<P> =
  | { kind: 'unsupported' }
  | {
      kind: 'supported'
      cancelRemote: (taskId: string, context: ImageTransportTaskContext<P, undefined>) => Promise<void>
    }

export type ImageTransportTaskCapability<P> =
  | { kind: 'unsupported' }
  | {
      kind: 'supported'
      pollPolicy: ImageTransportPollPolicy
      query: (taskId: string, context: ImageTransportTaskContext<P, AbortSignal>) => Promise<ImageTransportTaskState>
      cancel: ImageTransportCancelCapability<P>
    }

export interface ImageTransportTaskContext<P, S extends AbortSignal | undefined> {
  signal: S
  modelDescriptor: ImageTransportDescriptor | undefined
  headers: Record<string, string | undefined> | undefined
  providerParams: P
}

/**
 * `P` is the transport's own provider-parameter spelling: {@link VendorBag} for
 * the durable job path and {@link WireVendorBag} for the in-SDK adapter.
 */
interface ImageGenerationTransportBase<P> {
  supportsInput: (input: ImageGenerationSubmitInput<P>) => ImageTransportInputSupport
}

export interface ImmediateImageGenerationTransport<P> extends ImageGenerationTransportBase<P> {
  submit: (input: ImageGenerationSubmitInput<P>) => Promise<Extract<ImageTransportSubmission, { kind: 'completed' }>>
  task: Extract<ImageTransportTaskCapability<P>, { kind: 'unsupported' }>
}

export interface TaskImageGenerationTransport<P> extends ImageGenerationTransportBase<P> {
  submit: (input: ImageGenerationSubmitInput<P>) => Promise<ImageTransportSubmission>
  task: Extract<ImageTransportTaskCapability<P>, { kind: 'supported' }>
}

export type ImageGenerationTransport<P = VendorBag | WireVendorBag> =
  | ImmediateImageGenerationTransport<P>
  | TaskImageGenerationTransport<P>

export interface ImageGenerationSubmitInput<P = VendorBag | WireVendorBag> {
  modelId: string
  prompt: string | undefined
  n: number
  size: ImageSizeToken | undefined
  aspectRatio?: string
  seed: number | undefined
  files: ImageModelV3CallOptions['files']
  mask: ImageModelV3CallOptions['mask']
  modelDescriptor?: ImageTransportDescriptor
  providerParams: P
  headers?: Record<string, string | undefined>
  signal?: AbortSignal
}

export function completedImageTransportSubmission(
  imageUrls: readonly string[],
  source: string
): Extract<ImageTransportSubmission, { kind: 'completed' }> {
  return { kind: 'completed', imageUrls: requireNonEmptyImageUrls(imageUrls, source) }
}

export function submittedImageTransportSubmission(
  taskId: string,
  source: string
): Extract<ImageTransportSubmission, { kind: 'submitted' }> {
  if (taskId.length === 0) {
    throw new Error(`${source} returned an empty task id`)
  }
  return { kind: 'submitted', taskId }
}

export function completedImageTransportTask(
  imageUrls: readonly string[],
  source: string
): Extract<ImageTransportTaskState, { kind: 'completed' }> {
  return { kind: 'completed', imageUrls: requireNonEmptyImageUrls(imageUrls, source) }
}

export function requireNonEmptyImageUrls(imageUrls: readonly string[], source: string): NonEmptyImageUrls {
  if (imageUrls.length === 0) {
    throw new Error(`${source} completed but returned no image URLs`)
  }
  if (imageUrls.some((url) => url.length === 0)) {
    throw new Error(`${source} returned an empty image URL`)
  }
  const [first, ...rest] = imageUrls
  return [first, ...rest]
}
