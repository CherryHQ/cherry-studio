import type OpenAI from '@cherrystudio/openai'

import type { Provider } from './provider'

// Only OpenAI (Responses) is supported for now.
export type VideoEndpointType = 'openai'
export type VideoStatus = 'queued' | 'in_progress' | 'completed' | 'downloading' | 'downloaded' | 'failed'

interface VideoBase {
  readonly id: string
  readonly type: VideoEndpointType
  readonly providerId: string
  name: string
  thumbnail?: string | null
  fileId?: string
  prompt: string
  /**
   * Represents the possible states of a video generation or download process.
   *
   * - `queued`: The video task has been submitted and is waiting to be processed.
   * - `in_progress`: The video is currently being generated.
   * - `completed`: The video has been successfully generated and is ready for download.
   * - `downloading`: The video content is being downloaded to local storage.
   * - `downloaded`: The video has been fully downloaded and is available locally.
   * - `failed`: The video task encountered an error and could not be completed.
   */
  readonly status: VideoStatus
}

interface OpenAIVideoBase {
  readonly type: 'openai'
  metadata: OpenAI.Videos.Video
}

export interface VideoQueued extends VideoBase {
  readonly status: 'queued'
  thumbnail?: never
}

export interface VideoInProgress extends VideoBase {
  readonly status: 'in_progress'
  /** integer percent */
  progress: number
  thumbnail?: never
}
export interface VideoCompleted extends VideoBase {
  readonly status: 'completed'
  /** Base64 image string. When generation completed, firstly try to retrieve thumbnail. */
  thumbnail: string | null
}

export interface VideoDownloading extends VideoBase {
  readonly status: 'downloading'
  /** Base64 image string */
  thumbnail: string | null
  /** integer percent */
  progress: number
}
export interface VideoDownloaded extends VideoBase {
  readonly status: 'downloaded'
  /** Base64 image string */
  thumbnail: string | null
  /** Managed by fileManager */
  fileId: string
}

export interface VideoFailedBase extends VideoBase {
  readonly status: 'failed'
  error: unknown
}

export interface OpenAIVideoQueued extends VideoQueued, OpenAIVideoBase {}
export interface OpenAIVideoInProgress extends VideoInProgress, OpenAIVideoBase {}
export interface OpenAIVideoCompleted extends VideoCompleted, OpenAIVideoBase {}
export interface OpenAIVideoDownloading extends VideoDownloading, OpenAIVideoBase {}
export interface OpenAIVideoDownloaded extends VideoDownloaded, OpenAIVideoBase {}
export interface OpenAIVideoFailed extends VideoFailedBase, OpenAIVideoBase {
  error: OpenAI.Videos.Video['error']
}

export type VideoFailed = OpenAIVideoFailed

export type OpenAIVideo =
  | OpenAIVideoQueued
  | OpenAIVideoInProgress
  | OpenAIVideoCompleted
  | OpenAIVideoDownloading
  | OpenAIVideoDownloaded
  | OpenAIVideoFailed

export type Video = OpenAIVideo

// Create Video
interface CreateVideoBaseParams {
  type: VideoEndpointType
  provider: Provider
}

export interface OpenAICreateVideoParams extends CreateVideoBaseParams {
  type: 'openai'
  params: OpenAI.VideoCreateParams
  options?: OpenAI.RequestOptions
}

export type CreateVideoParams = OpenAICreateVideoParams

interface CreateVideoBaseResult {
  type: VideoEndpointType
  video: unknown
}

export interface OpenAICreateVideoResult extends CreateVideoBaseResult {
  type: 'openai'
  video: OpenAI.Videos.Video
}

export type CreateVideoResult = OpenAICreateVideoResult

// Retrieve Video
interface RetrieveVideoBaseParams {
  type: VideoEndpointType
  provider: Provider
}

export interface OpenAIRetrieveVideoParams extends RetrieveVideoBaseParams {
  type: 'openai'
  videoId: string
  options?: OpenAI.RequestOptions
}

export type RetrieveVideoParams = OpenAIRetrieveVideoParams

interface RetrieveVideoBaseResult {
  type: VideoEndpointType
}

export interface OpenAIRetrieveVideoResult extends RetrieveVideoBaseResult {
  type: 'openai'
  video: OpenAI.Videos.Video
}

export type RetrieveVideoResult = OpenAIRetrieveVideoResult

// Retrieve Video Content
interface RetrieveVideoContentBaseParams {
  type: VideoEndpointType
  provider: Provider
}

export interface OpenAIRetrieveVideoContentParams extends RetrieveVideoContentBaseParams {
  type: 'openai'
  videoId: string
  query?: OpenAI.Videos.VideoDownloadContentParams
  options?: OpenAI.RequestOptions
}

export type RetrieveVideoContentParams = OpenAIRetrieveVideoContentParams

interface RetrieveVideoContentBaseResult {
  type: VideoEndpointType
}

export interface OpenAIRetrieveVideoContentResult extends RetrieveVideoContentBaseResult {
  type: 'openai'
  response: Response
}

export type RetrieveVideoContentResult = OpenAIRetrieveVideoContentResult

// Delete Video
export interface DeleteVideoBaseParams {
  type: VideoEndpointType
  provider: Provider
}

export interface OpenAIDeleteVideoParams extends DeleteVideoBaseParams {
  type: 'openai'
  videoId: string
  options?: OpenAI.RequestOptions
}

export type DeleteVideoParams = OpenAIDeleteVideoParams

interface DeleteVideoBaseResult {
  type: VideoEndpointType
  result: unknown
}

export interface OpenAIDeleteVideoResult extends DeleteVideoBaseResult {
  type: 'openai'
  result: OpenAI.Videos.VideoDeleteResponse
}

export type DeleteVideoResult = OpenAIDeleteVideoResult
