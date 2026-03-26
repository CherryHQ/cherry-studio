# Application

Application is the top-level orchestrator that ties together the lifecycle system and the Electron app.

> **Full documentation** has moved to [docs/en/references/lifecycle/](../../../../docs/en/references/lifecycle/README.md).
> This file is a quick-reference pointer.

## Quick Links

| Topic | Reference Doc |
|-------|--------------|
| Application architecture & bootstrap flow | [Application Overview](../../../../docs/en/references/lifecycle/application-overview.md) |
| Lifecycle internals (phases, hooks, states) | [Lifecycle Overview](../../../../docs/en/references/lifecycle/lifecycle-overview.md) |
| Full usage guide | [Usage Guide](../../../../docs/en/references/lifecycle/lifecycle-usage.md) |
| Migrating old services | [Migration Guide](../../../../docs/en/references/lifecycle/lifecycle-migration-guide.md) |

## File Structure

```
application/
├── Application.ts      # Application singleton + lazy proxy
├── serviceRegistry.ts  # Central service registry (add services here)
└── index.ts            # Barrel export
```
