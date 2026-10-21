// Browser `node:fs`: ZenFS, whose `/web` mount holds the account's files (`mountAccountFiles`).
import * as zenfs from '@zenfs/core/emulation/compat.js'

import { promises } from './nodeFsPromises'

export * from '@zenfs/core/emulation/compat.js'
export { promises }

export default { ...zenfs, promises }
