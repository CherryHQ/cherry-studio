import { isWindowsDrivePath } from '@renderer/utils/filePath'
import type { Link, Root } from 'mdast'
import { visit } from 'unist-util-visit'

/**
 * Root a Windows drive-path link destination (`C:/Users/…`, `C:\Users\…`) so it
 * reaches our `<Link>` renderer intact.
 *
 * `MarkdownCore` runs rehype-sanitize (which reads the leading `C:` as an unknown
 * `c:` URL scheme and drops the whole href) and rehype-harden (which hard-blocks
 * the `file:` scheme, so encoding the path as a `file://` URL is not an option).
 * A rooted, forward-slashed path (`/C:/Users/…`) threads both: it carries no URL
 * scheme, so the sanitizer leaves it alone, and it starts with `/`, so harden
 * treats it as an allowed path-relative URL and preserves the pathname. `<Link>`
 * (`parseFileLinkHref`) strips the leading slash back off before opening.
 *
 * POSIX absolute (`/foo`) and relative (`./foo`) paths already survive both
 * stages, so they are left untouched.
 */
export function remarkFileLinks() {
  return (tree: Root): void => {
    visit(tree, 'link', (node: Link) => {
      if (isWindowsDrivePath(node.url)) {
        node.url = `/${node.url.replace(/\\/g, '/')}`
      }
    })
  }
}
