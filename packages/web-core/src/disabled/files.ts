import { unsupported, unsupportedClass } from './unsupported'

// Stand-ins for `@main/services/file` and the tool-output storage parts of `@main/utils/file` (`src/runtime/files.ts`).
// Tool outputs too large to keep inline are stored as files on the desktop; the Web edition has no such storage yet.
export const hashContent = unsupported('Tool-output file storage')
export const PathStaleVersionError = unsupportedClass('Local files')
export const openRequestPath = unsupported('Local files')
