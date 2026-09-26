# UI/UX working contract

Use boss-ux for new or changed visible workflows. Read DESIGN.md, .impeccable.md, packages/ui/docs/design-token-system.md, variable-catalog.md and the relevant component/stories. Keep existing calm, neutral, content-first direction and @cherrystudio/ui. UX owns design artifacts; renderer owns feature/component implementation. A shared token/API change needs lead assignment and its wider callers checked with Compass/source.

Load `prometheus-ui-ux` for boss-ux and boss-renderer UI work using the entrypoint
in `skill-bindings.json`. Follow the project `.agents/UI_UX_PROTOCOL.md` if present,
otherwise the bundled protocol. This operational desktop application defaults to
Operate mode. Its incumbent design authority remains the files above: focused
UI/UX Pro Max recommendations do not replace its tokens, fonts or `DESIGN.md`.
Refinement loads no taste skill. New surfaces or an explicitly authorized redesign
may select one taste skill and at most one requested overlay; select `gpt-taste`
only for an actual GPT-family model. Use React/platform guidance relevant to this
Electron renderer; retain the tracked Electron workflow below.

boss-verifier loads `prometheus-ui-review` only for completed UI boundaries, in
an independent context, with no taste-driven redesign and no bypass of user-only
skills. Batch findings into one correction/confirmation cycle; unresolved blocking
findings remain blocking. Backend-only work does not load these UI workflows.

1. State the user task, evidence and success/failure criteria. Separate supplied observations from assumptions; public web research is not a customer interview.
2. Map navigation, state transitions and the shortest useful path. For agent flows include effective connection state, tool approval, streaming, cancellation, interrupted work and recovery where relevant. Preserve entered values on failures. Specify keyboard order and accessible names alongside visual design.
3. Reuse real components and tokens. Design for both themes, constrained window sizes, long paths, translations, reduced motion and supported text scaling. Do not introduce generic dashboard decoration or palette/font replacements.
4. Hand off exact states, component APIs and acceptance criteria; implement the whole coherent flow before its verification boundary.
5. Use cherry-electron-dev to discover/reuse a verified tracked Electron instance. Inspect actual UI via available CDP/DevTools/Playwright, capture before/after screenshots with matching size/theme and walk Tab/Shift-Tab/Enter/Escape. Inspect DOM/accessibility tree, console/network and main logs when needed. Check contrast from resolved colors, non-color status cues, visible focus, error recovery and cancellation. Automated accessibility checks supplement manual checks; record checks not possible in the environment.
6. Independent verifier checks completed evidence; UX recommendations are not user-tested conclusions. Screen-reader and native Windows/install behavior require actual platform evidence. Missing tool/vision/platform support remains a recorded acceptance gap.

Optional tools: Figma retrieval when connected and a design file is provided; design edits only under scoped authorization. Image generation may explore an explicitly requested concept; it does not prove usability. Browser performance profiles are for observed latency/jank. Never expose credentials in screenshots, videos or traces. The repository regression skill explicitly avoids traces for credential-bearing cases.
