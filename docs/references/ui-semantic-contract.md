# UI Semantic Contract

Cherry Studio exposes meaningful app-owned DOM boundaries through one machine-readable `data-ui` attribute. It is the
maintained selector interface for user themes, end-to-end tests, inspectors, and controlled AI automation. Internal
classes, incidental DOM ancestry, and unmarked implementation wrappers are not part of this contract.

The primary consumer is advanced Custom CSS. Structured theme variables remain the preferred surface for common
theming; `data-ui` is the semantic escape hatch for rules that variables cannot express. Tests and automation can reuse
the same coordinates instead of introducing another selector protocol.

## Token protocol

`data-ui` is an unordered set of whitespace-separated static semantic tokens:

| Tokens | Use | Stability |
| --- | --- | --- |
| `chat.message` | Business or component role | Explicit roles are stable; inferred roles are best-effort |
| `part:message-content` | Reusable component structure | Maintained public API |

```html
<article data-ui="chat.message">
  <div data-ui="part:message-content"></div>
</article>
```

Use token matching (`~=`), never substring matching:

```css
/* Every chat message */
[data-ui~='chat.message'] {
  display: grid;
}

/* One reusable component part */
[data-ui~='part:dialog-content'] {
  border-radius: 8px;
}
```

Ordinary implementation children do not need their own token. Custom CSS can traverse from the nearest semantic
boundary; those descendant selectors intentionally follow internal DOM and may need updates after a refactor:

```css
[data-ui~='chat.message'] > div:nth-child(2) {
  max-width: none;
}
```

If a child becomes a commonly used or compatibility-sensitive target, promote it to the maintained contract with an
explicit semantic role or `data-slot`.

## Build-time generation

The pre-transform Vite plugin parses TSX/JSX with SWC before React compilation. It annotates:

- intrinsic roots rendered by a component or fragment branch;
- nested nodes with an explicit `data-ui`, `data-slot`, `data-testid`, stable `id`/`name`/`role`, or a directly named
  business handler such as `handleCopy`;
- each window body and public `svg` root.

Once a parent component boundary exists, ordinary nested HTML remains unmarked. This includes adjacent layout wrappers
and otherwise semantic tags such as paragraphs, headings, sections, and list items. Consumers can traverse downward
from the nearest component coordinate without turning every DOM node into a separate selector. If an internal region
needs independent long-lived styling, prefer extracting an owning component or explicitly promoting a `part:*`.

Directly named business handlers may promote a nested action. Generic event handlers and plumbing such as
`handleClick`, `handleKeyDown`, `stopPropagation`, and `preventDefault` do not create boundaries.

Reusable component structure is represented by `part:*` tokens in the same attribute. Existing static `data-slot`
markers remain unchanged throughout the project. The generator treats their values as authored structural semantics:

```html
<div data-slot="dialog-content" data-ui="part:dialog-content"></div>
```

Explicit `data-ui` parts and `data-slot` values enter the same normalization rule. The original `data-slot` attribute
remains intact, so existing component styles, tests, and custom CSS continue to work.

Semantic inference uses, in order:

1. an explicit semantic role written as a static `data-ui` value;
2. a compact source domain and the owning component name;
3. authored `part:*`, stable semantic attributes, and trusted business-handler names when an internal node is promoted.

For example, a hypothetical `MessageTimeline` component under the chat source domain can produce
`chat.message-timeline`; a nested copy action bound to `handleCopy` can produce
`chat.message-timeline.action.copy`. (The real message group carries the explicit anchor `chat.message.group`, which
overrides inference.) Technical path fragments such as
`components`, `runtime`, and `renderer`, and raw fallback roles such as `element.div`, are excluded. Visible text is
never an input, so localization and copy changes do not rename selectors. Line numbers, timestamps, random values, and
class names are also excluded.

File and component names make inferred semantics readable but are not a permanent identity system. Moving or renaming a
component can change its inferred role. Long-lived themes should use explicit semantic roles or maintained `part:*`
tokens for selectors that must survive such refactors.

SVG drawing internals such as `path`, `g`, `defs`, gradients, masks, filters, and shapes are implementation details by
default. They enter the public contract only when they carry `data-ui`, `data-slot`, `data-testid`, `role`, or a trusted
business handler. HTML descendants of `foreignObject` are processed as a new semantic boundary.

During source work, resolve a semantic prefix without building the app:

```bash
pnpm ui:contract:query chat.message
```

The command scans current source and returns matching semantic roles, element/component names, and source locations.
There is no persistent node registry or generated exact-node ID.

## Selector helpers

Declare compatibility-sensitive business semantics directly in the owning component's markup:

```tsx
<div data-ui="chat.message" />
```

Reusable `part:*` tokens are also declared in the owning component's markup, either explicitly or through a static
`data-slot`. `parseUiTokens` supports inspectors, while `uiSelector` and `uiLocator` compose semantic and structural
selectors without duplicating the token grammar.

The maintained application shell currently includes:

- `app.sidebar`, `app.tab-bar`, and `app.content`.

The maintained chat surface currently includes:

- `chat.view`, `chat.topic-list`, `chat.topic-list.action.create`, `chat.message-list`, `chat.message`, and
  `chat.message.group`;
- `chat.composer`, `chat.composer.action.send`, and `chat.composer.action.pause`;
- `part:message-content`, `part:composer-input`, and `part:composer-actions`.

The maintained settings surface currently includes:

- `settings.view`, `settings.navigation`, and `settings.content`.

## Custom CSS across windows

Each window body exposes the same semantic root:

```html
<body data-ui="app.window">
```

Custom CSS is inserted verbatim and unlayered, while application and bundled vendor stylesheets live in cascade
layers (Tailwind's layers, then `app`; declared in `src/renderer/assets/styles/index.css`). Because unlayered normal
declarations beat every layered declaration regardless of load order or selector specificity, custom CSS can use the
full CSS surface—including `:root`, `body`, top-level at-rules, and semantic `data-ui` selectors—and wins without
blanket `!important`. Every regular renderer window subscribes to the same `ui.custom_css` preference and injects that
stylesheet into its own document. The preboot windows (`migrationV2`, `userDataRelocation`) are the exceptions because
they do not initialize preferences.

Two deliberate limits: `!important` inverts layer precedence, so a layered application `!important` rule beats an
unlayered custom `!important` rule—another reason custom CSS should not use it. And a third-party widget that injects
unlayered styles at runtime (currently the emoji picker) sits outside the layer system, so restyling its internals
falls back to ordinary specificity.

```css
:root {
  --color-primary: hotpink;
}
```

Electron renderer windows are separate documents, so a stylesheet injected into one cannot leak into another. CSS
cannot cross a Shadow DOM or iframe boundary; an app-owned isolated root must expose its own semantic boundary if it is
made public.

## Compatibility rules

- Semantic roles are lowercase dot-separated identifiers, not descriptions of current copy or appearance.
- Explicit semantic roles and `part:*` tokens are maintained public API. Rename them only with a compatibility alias and
  a breaking-change entry.
- Inferred roles are deterministic but best-effort and may change when files, components, or DOM responsibilities move.
- Internal descendant selectors are supported CSS but are not promised to survive structural refactors.
- Tests and automation should start from semantic or `part:*` tokens, then use accessible roles for the intended
  interaction.
