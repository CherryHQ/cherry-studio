// Browser `node:fs`: ZenFS, whose `/web` mount holds the account's files (`mountAccountFiles`).
import * as zenfs from '@zenfs/core/emulation/compat.js'

import { promises } from './nodeFsPromises'

export * from '@zenfs/core/emulation/compat.js'
export { promises }

/** Node also offers the OS's resolver as `realpathSync.native`; ZenFS has a single resolver. */
export const realpathSync = Object.assign(zenfs.realpathSync.bind(null), {
  native: zenfs.realpathSync
})

export default { ...zenfs, realpathSync, promises }
