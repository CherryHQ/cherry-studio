import type { SystemProviderId, Video } from '@renderer/types'

// Hard-encoded for now. We may implement a function to filter video generation model from provider.models.
export const videoModelsMap = {
  openai: ['sora-2', 'sora-2-pro'] as const
} as const satisfies Partial<Record<SystemProviderId, string[]>>

// Mock data for testing
export const mockVideos: Video[] = [
  {
    id: '1',
    type: 'openai',
    status: 'downloaded',
    prompt: 'A beautiful sunset over the ocean with waves crashing',
    thumbnail: 'https://picsum.photos/200/200?random=1',
    fileId: 'file-001',
    providerId: 'openai',
    name: 'video-001',
    metadata: {
      id: 'video-001',
      object: 'video',
      created_at: Math.floor(Date.now() / 1000),
      completed_at: Math.floor(Date.now() / 1000),
      expires_at: null,
      error: null,
      model: 'sora-2',
      progress: 100,
      remixed_from_video_id: null,
      seconds: '4',
      size: '1280x720',
      status: 'completed'
    }
  },
  {
    id: '2',
    type: 'openai',
    status: 'in_progress',
    prompt: 'A cat playing with a ball of yarn in slow motion',
    progress: 65,
    providerId: 'openai',
    name: 'video-002',
    metadata: {
      id: 'video-002',
      object: 'video',
      created_at: Math.floor(Date.now() / 1000),
      completed_at: null,
      expires_at: null,
      error: null,
      model: 'sora-2-pro',
      progress: 65,
      remixed_from_video_id: null,
      seconds: '8',
      size: '1792x1024',
      status: 'in_progress'
    }
  },
  {
    id: '3',
    type: 'openai',
    status: 'queued',
    prompt: 'Time-lapse of flowers blooming in a garden',
    providerId: 'openai',
    name: 'video-003',
    metadata: {
      id: 'video-003',
      object: 'video',
      created_at: Math.floor(Date.now() / 1000),
      completed_at: null,
      expires_at: null,
      error: null,
      model: 'sora-2',
      progress: 0,
      remixed_from_video_id: null,
      seconds: '12',
      size: '1280x720',
      status: 'queued'
    }
  },
  {
    id: '4',
    type: 'openai',
    prompt: 'Birds flying in formation against blue sky',
    status: 'downloading',
    progress: 80,
    thumbnail: 'https://picsum.photos/200/200?random=4',
    providerId: 'openai',
    name: 'video-004',
    metadata: {
      id: 'video-004',
      object: 'video',
      created_at: Math.floor(Date.now() / 1000),
      completed_at: Math.floor(Date.now() / 1000),
      expires_at: null,
      error: null,
      model: 'sora-2-pro',
      progress: 100,
      remixed_from_video_id: null,
      seconds: '8',
      size: '1792x1024',
      status: 'completed'
    }
  },
  {
    id: '5',
    type: 'openai',
    status: 'failed',
    error: { code: '400', message: 'Video generation failed' },
    prompt: 'Mountain landscape with snow peaks and forest',
    providerId: 'openai',
    name: 'video-005',
    metadata: {
      id: 'video-005',
      object: 'video',
      created_at: Math.floor(Date.now() / 1000),
      completed_at: Math.floor(Date.now() / 1000),
      expires_at: null,
      error: { code: '400', message: 'Video generation failed' },
      model: 'sora-2',
      progress: 0,
      remixed_from_video_id: null,
      seconds: '4',
      size: '1280x720',
      status: 'failed'
    }
  },
  {
    id: '6',
    type: 'openai',
    status: 'completed',
    thumbnail: 'https://picsum.photos/200/200?random=6',
    prompt: 'City street at night with neon lights reflecting on wet pavement',
    providerId: 'openai',
    name: 'video-006',
    metadata: {
      id: 'video-006',
      object: 'video',
      created_at: Math.floor(Date.now() / 1000),
      completed_at: Math.floor(Date.now() / 1000),
      expires_at: null,
      error: null,
      model: 'sora-2-pro',
      progress: 100,
      remixed_from_video_id: null,
      seconds: '12',
      size: '1024x1792',
      status: 'completed'
    }
  }
]
