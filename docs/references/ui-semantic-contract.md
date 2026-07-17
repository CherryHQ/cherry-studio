# UI Semantic Contract

Cherry Studio exposes app-owned HTML elements and public SVG boundaries through one machine-readable `data-ui`
attribute. It is the stable interface for user themes, end-to-end tests, inspectors, and controlled AI automation.
Internal classes, DOM ancestry, and unmarked SVG drawing primitives are not part of this contract.

## Token protocol

`data-ui` is an unordered set of whitespace-separated tokens. The compiler writes tokens in this canonical order:

```html
<article
  data-ui="chat.message id:u3976699 scope:message:m_817 scope:topic:t_42 mode:fold state:assistant state:complete"
></article>
```

| Token | Meaning | Stability |
| --- | --- | --- |
| `chat.message` | Human-readable semantic role | Stable public grouping selector |
| `id:u3976699` | Compact exact source node identity | Stable across builds; never reused after retirement |
| `scope:message:m_817` | Runtime instance identity | Stable for that business entity |
| `variant:bubble` | Visual/product variant | Changes when the variant changes |
| `mode:fold` | Active layout or behavior mode | Changes with the active mode |
| `state:complete` | Current state | Changes with runtime state |
| `boundary:app` | Style-isolation boundary | Stable infrastructure token |
| `theme:custom` | Active theme owner | Stable infrastructure token |

Use token matching (`~=`), never substring matching:

```css
/* Every chat message */
[data-ui~='chat.message'] {
  display: grid;
}

/* One message instance */
[data-ui~='chat.message'][data-ui~='scope:message:m_817'] {
  outline: 1px solid hotpink;
}

/* One exact source node */
[data-ui~='id:u7b21d4a'] {
  display: none;
}
```

## Build-time contract

The pre-transform Vite plugin parses TSX/JSX with SWC and annotates every intrinsic HTML element plus each `svg` root
before the React compiler runs. It also annotates component boundaries that explicitly forward DOM markers such as
`data-slot`, which covers Cherry Studio's Radix/Shadcn primitives. Window HTML is annotated by the same plugin. An
explicit `uiTokens(...)` call on any component boundary receives that source node's exact `id:` token without losing
runtime tokens.

SVG drawing internals such as `path`, `g`, `defs`, gradients, masks, filters, and shapes are implementation details by
default. They enter the public contract only when they carry `data-ui`, `data-slot`, `data-testid`, `role`, or an event
handler. HTML descendants of `foreignObject` are annotated normally. This keeps icons themeable through their stable
`svg` boundary while avoiding thousands of fragile IDs for generated vector paths; a drawing part that genuinely needs
independent styling or testing can opt in explicitly.

Semantic inference uses, in order:

1. an explicit semantic ID passed to `uiTokens` or a static `data-ui` value;
2. `data-slot`, `data-testid`, stable `id`/`name`/`type`, and event-handler names;
3. source domain, component name, and element role.

Visible text is never an identity input, so localization and copy changes cannot rename the contract. Line numbers,
timestamps, random values, class names, and build traversal order are also excluded.

The committed `ui-contract.registry.json` reconciles source nodes with their exact IDs. IDs survive formatting, display
text changes, and normal rebuilds. A uniquely identifiable node also keeps its ID after a file move. Ambiguous structural
moves require an explicit `data-ui={uiTokens('domain.role', ...)}` marker to preserve intent. Removed exact IDs move to a
tombstone list and are never allocated again.

After changing renderer markup, update and commit the registry:

```bash
pnpm ui:contract:sync
```

Production builds and CI reject drift through `pnpm ui:contract:check`. Builds emit a deterministic, dictionary-packed
`ui-contract.json` asset. Its `columns` field describes each node tuple; the `sources`, `semantics`, `elements`, and
`components` dictionaries map tuple indexes back to readable metadata. Theme inspectors and AI tools should discover the
contract from this manifest instead of scraping implementation classes.

During source work, an agent or developer can resolve a semantic prefix without building the app:

```bash
pnpm ui:contract:query chat.message
```

The command returns exact IDs, element/component names, and relative source locations as JSON, and refuses to query a
stale registry.

## Runtime API

Use the curated runtime helpers for entity scopes and state. Do not concatenate free-form strings:

```tsx
import { uiTokens } from '@renderer/utils/uiContract'

<div
  data-ui={uiTokens('chat.message', {
    scopes: [`message:${message.id}`, `topic:${message.topicId}`],
    states: [message.role, message.status, selected && 'selected'],
    modes: ['fold']
  })}
/>
```

`uiTokens` validates the token grammar, removes duplicates, and serializes deterministically. `parseUiTokens` supports
inspectors. `uiSelector` creates exact CSS selectors. Playwright code can use `uiLocator(page, 'chat.message', options)`
from `tests/e2e/utils`.

Runtime scopes may contain durable business IDs already present in the renderer. Do not place secrets, prompt content,
credentials, or user-visible text in a token.

## Style isolation and cascade

Each window body is compiled as the root boundary:

```html
<body data-ui="app.window id:app.window~… scope:window:main boundary:app theme:custom">
```

Custom CSS is unlayered and inserted after application styles, so it can override normal component rules without blanket
`!important`. By default it is wrapped in:

```css
@scope ([data-ui~='boundary:app'][data-ui~='theme:custom']) {
  /* user CSS */
}
```

This prevents one window's theme sheet from escaping its declared app boundary. To style the boundary element itself,
use `:scope`. CSS beginning with `@import`, `@charset`, or `@namespace` is rejected in isolated mode because those rules cannot safely live
inside `@scope`. An advanced theme can intentionally opt out at the top of the stylesheet:

```css
/* @cherry-ui raw */
```

Raw mode preserves the previous global behavior and may affect every matching node in that document.

CSS cannot cross a Shadow DOM or iframe boundary. App-owned shadow roots remain intentionally isolated and need their own
adopted theme sheet if they are later made public. DOM created from third-party runtime HTML is not automatically part of
the source contract; its owning renderer must expose a stable boundary or explicit semantic nodes.

## Compatibility rules

- Semantic IDs are lowercase dot-separated roles, not descriptions of current copy or appearance.
- Existing semantic IDs are public API. Rename them only with a compatibility alias and a breaking-change entry.
- Exact `id:` tokens are immutable and never reused.
- Runtime state belongs in `state:`, `mode:`, or `variant:`; do not generate a new semantic ID for each state.
- Tests and automation must query semantic/exact tokens, then use accessible roles for the intended interaction. The
  contract identifies nodes; it does not grant arbitrary script execution or bypass application permissions.
