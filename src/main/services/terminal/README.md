# Terminal engine

The [shared Agent terminal Spec](../../../../.agents/notes/proposed/architecture/2026-11-14-shared-agent-terminal.md) assigns one lazy utility Host to each product conversation. This directory currently provides its headless Ghostty engine. Runtime tools and the renderer still use their existing execution paths; this layer does not launch commands or PTYs.

`ghostty/GhosttyRuntime.ts` instantiates the pinned WASM from supplied bytes, checks its embedded source revision, and routes terminal-generated replies without a view. A Host owns one runtime; there is no application-wide singleton. Its log callback must use the utility runtime's logger.

`ghostty/GhosttyTerminalCore.ts` owns per-terminal handles for VT parsing, cell snapshots, keyboard/paste/mouse encoding, selection, scrolling, and geometry. Browser events are normalized before entering it. Dispose individual cores before releasing their owning runtime. Disposing one core leaves sibling cores usable.

These are child-safe implementation modules with direct imports and no barrel. The future Main lifecycle owner supplies asset bytes using registered application paths; the engine imports neither the application container nor Electron. Binary provenance, licenses, and rebuild instructions live with the [assets](../../../../resources/terminal/ghostty/README.md).

Snapshots are local engine values, not the cross-process observation protocol. The engine has one mutable viewport; independent view projections, observation epochs, output quotas, the 5,000-line history limit, and the Host's aggregate 64 MiB accounting still belong to the Host layer. `scrollbackBytes` configures Ghostty's byte limit, not an RSS or aggregate-memory guarantee.

The execution backend must retain a verifiable managed-process scope through cleanup. Root-process exit does not prove descendant cleanup. In particular, Windows pipe execution needs a Job Object backend; ConPTY and PID-based `taskkill` are not substitutes for that ownership contract. Preserve unconfirmed cleanup and capacity until the backend can establish completion.
