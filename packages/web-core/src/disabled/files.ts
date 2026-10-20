import { unsupported } from './unsupported'

// Stand-in for `@main/utils/file`: the Worker has no local file system. Tool outputs too large
// to keep inline are stored as files on the desktop; the Web edition has no such storage yet.
export const hashContent = unsupported('Tool-output file storage')
