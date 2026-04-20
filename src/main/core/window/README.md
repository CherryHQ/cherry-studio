# WindowManager

Lifecycle-managed service for creating, tracking, and reusing application windows. Provides three lifecycle modes (default / singleton / pooled), inter-service events, IPC broadcast, and elastic pool reuse.

**For the full guide, see [docs/references/window-manager/](../../../../docs/references/window-manager/).**

Quick jumps:

- [Overview](../../../../docs/references/window-manager/window-manager-overview.md) — architecture, lifecycle modes, event timing
- [Usage Guide](../../../../docs/references/window-manager/window-manager-usage.md) — quick start, domain-service integration, consumer-vs-internal API layers
- [Pool Mechanics](../../../../docs/references/window-manager/window-manager-pool-mechanics.md) — two-axis pool model, GC, warmup, suspend/resume
- [Platform Configuration](../../../../docs/references/window-manager/window-manager-platform.md) — `platformOverrides` + `quirks`
- [API Reference](../../../../docs/references/window-manager/window-manager-api-reference.md) — full method reference
- [Migration Guide](../../../../docs/references/window-manager/window-manager-migration-guide.md) — converting direct `BrowserWindow` usage
