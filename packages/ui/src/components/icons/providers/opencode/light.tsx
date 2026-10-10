import type { SVGProps } from 'react'

import { OpenCode } from '../../general/open-code'

/**
 * Hand-written forwarder: the OpenCode provider mark reuses the general
 * open-code glyph instead of a vectorized SVG source. Exposing it as
 * `<Name>Light` lets the icon pipeline (collectIconDirs/getComponentName)
 * treat this directory like any generated icon — index.tsx/avatar.tsx are
 * regenerated from it, and the catalog entries pick it up automatically.
 */
const OpenCodeGoLight = (props: SVGProps<SVGSVGElement>) => <OpenCode {...props} />

export { OpenCodeGoLight }
