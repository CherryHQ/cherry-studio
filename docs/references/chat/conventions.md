# Chat UI Design & Conventions

> **Status: target architecture (design).** This describes the chat layer's intended
> structure, which lands incrementally across carve PRs. As of this PR, only `layout/`,
> `primitives/`, `tokens/`, `utils/` are on `main`; the other layers and the
> `@renderer/components/chat` package barrel referenced below are the design target and
> arrive in later carves.

How the renderer chat UI under `src/renderer/components/chat` is divided by
responsibility, and the conventions every module follows. The target is to import from the
package entry `@renderer/components/chat`, not deep paths, except when working inside a
module — that barrel is added as the layers below land.

## Design division

The UI is split by responsibility, not by feature. Each kind of module owns one concern
and nothing else. The tree below is the target; the *landed* note marks what exists on
`main` today, everything else is *planned* and arrives in later carves:

- **Presentation** (`primitives/`, `tokens/`) — *landed.* Stateless, themed through
  `@cherrystudio/ui`. No business logic, no data access; everything arrives through props.
- **View state** (React contexts such as `layout/`) — *landed.* Small, self-contained
  pieces of *interface* state (layout mode, viewport insets, navbar visibility). Never
  holds business or persisted data.
- **Contracts** (`adapters/`) — *planned.* Pure projections of business entities (topic /
  session / message) into stable UI shapes, plus the pane / action registries. Will fetch
  nothing and own no cache; the single boundary between business hooks and shared UI. See
  [Chat Adapters](./adapters.md).
- **Content** (`messages/`, `composer/`) — *planned.* Renders a conversation from the
  projected shapes; owns no send/stop/persistence, only the rendering.
- **Orchestration** (`shell/`, `panes/`, `resources/`, `settings/`, `actions/`, and the
  `pages/`) — *planned.* Wires the above into screens. Owns composition, not rendering
  details.

State flows one way: business hooks → a contract projection → presentation. Presentation
never reaches back for business state.

## Conventions

### Context

- Create with `createContext`. Provide with `<SomeContext value={…}>` directly. Read
  through a dedicated hook that calls `use(SomeContext)`:

  ```tsx
  const ChatLayoutModeContext = createContext<ChatLayoutModeContextValue>({ … })
  export const ChatLayoutModeProvider = ({ children }) => {
    const value = useMemo(() => ({ forceWideLayout, setForceWideLayout }), [forceWideLayout])
    return <ChatLayoutModeContext value={value}>{children}</ChatLayoutModeContext>
  }
  export const useChatLayoutMode = () => use(ChatLayoutModeContext)
  ```

- Memoize the provider `value` so consumers don't rerender when an unrelated parent does.
- A slice that can render outside its provider exposes an *optional* reader that returns
  `use(Context)` and lets callers handle the absent case, rather than throwing.

### Refs

- Refs are ordinary props. Components do not wrap themselves in `forwardRef`.

### Render stability

- Project business data into UI shapes once, at the data boundary, with `useMemo`; never
  map raw entities inline in JSX. Keep `send` / `stop` / handler callbacks stable. The
  contract layer is a pure projection, so churn comes only from fresh arrays / objects /
  callbacks created during render — keep that boundary stable.
- Defer expensive derived renders that update rapidly with `useDeferredValue` (e.g. the
  partial tool-call arguments streamed into the agent execution timeline).

### Composition

- Keep effects out of the render path; register providers and pane / action descriptors
  from effects, and create registries at module scope or in a ref — never during render.
