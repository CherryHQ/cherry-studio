/**
 * In-memory binary media served to renderers over the `cherry-media://` scheme.
 * This barrel is the module's only public door.
 */
export { MediaProtocolService } from './MediaProtocolService'
export { registerMediaSchemes } from './registerSchemes'
export { CHERRY_MEDIA_SCHEME, MediaKind } from './types'
