# Chat UI Design & Conventions

How the renderer chat UI under `src/renderer/components/chat` is divided by
responsibility, and the conventions every module follows. Import from the package entry
`@renderer/components/chat`, not deep paths, except when working inside a module.

## Design division

The UI is split by responsibility, not by feature. Each kind of module owns one concern
and nothing else:

- **Presentation** (`primitives/`, `tokens/`) — stateless, themed through
  `@cherrystudio/ui`. No business logic, no data access; everything arrives through props.
- **View state** (React contexts such as `layout/`) — small, self-contained pieces of
  *interface* state (layout mode, viewport insets, navbar visibility). Never holds
  business or persisted data.
- **Contracts** (`adapters/`) — pure projections of business entities (topic / session /
  message) into stable UI shapes, plus the pane / action registries. Fetches nothing,
  owns no cache; it is the single boundary between business hooks and shared UI. See
  [Chat Adapters](./adapters.md).
- **Content** (`messages/`, `composer/`) — renders a conversation from the projected
  shapes; owns no send/stop/persistence, only the rendering.
- **Orchestration** (`shell/`, `panes/`, `resources/`, `settings/`, `actions/`, and the
  `pages/`) — wires the above into screens. Owns composition, not rendering details.

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
