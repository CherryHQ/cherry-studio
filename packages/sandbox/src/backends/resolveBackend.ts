import { MxcBackend } from './mxc/MxcBackend.js'

export function resolveBackend() {
  return new MxcBackend()
}
