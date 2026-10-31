// Browser `node:fs/promises`: ZenFS, whose `/web` mount holds the account's files (`mountAccountFiles`).
import * as zenfsPromises from '@zenfs/core/promises'

export * from '@zenfs/core/promises'

export const promises = zenfsPromises

export default promises
