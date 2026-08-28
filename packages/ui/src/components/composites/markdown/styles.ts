/**
 * Side-effect imports for the markdown composite. Consumers can either
 * import this file directly (`import '@cherrystudio/ui/components/composites/markdown/styles'`)
 * or replicate the imports themselves. The bundle is small enough that we
 * default to including all three stylesheet groups Streamdown / KaTeX /
 * remark-alert need — see styles.css for the layered stylesheet imports.
 */

import './styles.css'
import 'katex/dist/contrib/copy-tex'
import 'katex/dist/contrib/mhchem'
