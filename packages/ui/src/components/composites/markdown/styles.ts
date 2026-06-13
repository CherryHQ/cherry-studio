/**
 * Side-effect CSS imports for the markdown composite. Consumers can either
 * import this file directly (`import '@cherrystudio/ui/composites/markdown/styles'`)
 * or replicate the imports themselves. The bundle is small enough that we
 * default to including all three stylesheet groups Streamdown / KaTeX /
 * remark-alert need.
 */

import 'katex/dist/katex.min.css'
import 'katex/dist/contrib/copy-tex'
import 'katex/dist/contrib/mhchem'
import 'remark-github-blockquote-alert/alert.css'
import 'streamdown/styles.css'
