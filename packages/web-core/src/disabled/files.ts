import { unsupported, unsupportedClass } from './unsupported'

// Stand-in for `@main/utils/file` and `@main/services/file`: the Worker has no local file system.
// Tool outputs too large to keep inline are stored as files on the desktop; the Web edition has no such storage yet.
export const hashContent = unsupported('Tool-output file storage')
export const PathStaleVersionError = unsupportedClass('Local files')
export const openRequestPath = unsupported('Local files')
