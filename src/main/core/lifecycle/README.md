# Lifecycle Module

IoC container + service lifecycle management with phased bootstrap and parallel initialization.

> **Full documentation** has moved to [docs/references/lifecycle/](../../../../docs/references/lifecycle/README.md).
> This file is a quick-reference pointer.

## Quick Links

| Topic | Reference Doc |
|-------|--------------|
| Decision: lifecycle vs singleton? | [Decision Guide](../../../../docs/references/lifecycle/lifecycle-decision-guide.md) |
| Architecture: phases, hooks, states | [Lifecycle Overview](../../../../docs/references/lifecycle/lifecycle-overview.md) |
| Application: bootstrap, shutdown, registry | [Application Overview](../../../../docs/references/lifecycle/application-overview.md) |
| Usage: decorators, error handling, platform | [Usage Guide](../../../../docs/references/lifecycle/lifecycle-usage.md) |
| Migrating old services | [Migration Guide](../../../../docs/references/lifecycle/lifecycle-migration-guide.md) |

## File Structure

```
lifecycle/
├── types.ts              # Phase, LifecycleState, ServiceMetadata, Pausable, errors
├── decorators.ts         # @Injectable, @ServicePhase, @DependsOn, @Priority, etc.
├── BaseService.ts        # Abstract base class with lifecycle hooks
├── event.ts              # Emitter<T>, Event<T>, Disposable — typed inter-service events
├── signal.ts             # Signal<T> — one-shot deferred value (PromiseLike)
├── ServiceContainer.ts   # IoC container with DI and conditional activation
├── DependencyResolver.ts # Topological sort, layered parallel resolution
├── LifecycleManager.ts   # Phased bootstrap, shutdown, pause/resume/stop/start
├── index.ts              # Barrel export
└── __tests__/            # Unit tests for all components
```
