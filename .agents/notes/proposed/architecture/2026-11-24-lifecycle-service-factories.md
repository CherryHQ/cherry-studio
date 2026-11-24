# Agent Note: Typed factories for parameterized lifecycle services

Status: proposed

English | [中文](2026-11-24-lifecycle-service-factories.zh.md)

## Problem

The lifecycle registry erases every constructor to `new (...args: unknown[]) => T`. That signature requires a class to accept arbitrary arguments. `AiStreamManager` and `UtilityProcessManager` instead accept specific parameters, so the erased signature rejects valid classes. Asserting the constructor or widening its parameters would conceal the mismatch.

The container also passes resolved `@DependsOn` instances to constructors in declaration order. A config-first `AiStreamManager` therefore receives `RuntimeActivityService` as configuration. This is a service parameter mismatch; it does not justify removing constructor injection from the container.

This Spec owns the registration mechanism needed by the [anti-slop migration](../process/2026-11-18-anti-slop-lint.md). It does not replace that migration's rule scope or verification requirements.

## Proposal

Keep automatic constructor injection for existing class registrations. Add an explicit, synchronous factory registration for parameterized services. Separate class identity, used for metadata and lookup, from a callable constructor signature.

```typescript
interface ServiceClassIdentity<T> {
  readonly name: string
  readonly prototype: T
}

interface ServiceFactoryRegistration<T> {
  readonly kind: 'factory'
  readonly target: ServiceClassIdentity<T>
  readonly create: () => T
}

declare function defineServiceFactory<T>(
  target: ServiceClassIdentity<T>,
  create: () => NoInfer<T>
): ServiceFactoryRegistration<T>
```

The target class anchors the result type; `NoInfer` prevents the callback from widening it to accommodate an incompatible service or a promise. Registration reads the target's existing name, phase, dependency, priority, error-strategy and condition metadata without executing the factory. Construction resolves every declared dependency first, retaining missing-dependency and exclusion behavior, then calls the factory without arguments. Class registrations retain `new useClass(...deps)` and their current argument order. Both paths retain lazy singleton construction and class/name lookup.

Normal bootstrap still owns initialization order. Direct early `get()` constructs synchronously and does not promise that dependencies have completed initialization. A factory must return its instance synchronously; it does not introduce another activation or initialization phase.

Keep `services` as the class-valued map that derives `ServiceRegistry`. Define factory overrides for only the two parameterized registrations and build `serviceList` from `{ ...services, ...factoryOverrides }`. Replacing existing properties preserves declaration order and keeps class identity available to consumers.

```typescript
defineServiceFactory(AiStreamManager, () => new AiStreamManager())
defineServiceFactory(UtilityProcessManager, () => new UtilityProcessManager())
```

`AiStreamManager` retains its config-first optional constructor and resolves activity holds through the existing `application.get('RuntimeActivityService')` call. Its factory explicitly supplies no arguments; resolved dependency instances are not forwarded as configuration. Direct construction sites keep their existing contract. `UtilityProcessManager` retains its existing optional dependency-override constructor and production defaults. Other services keep their current registrations and constructors. Reference docs explain the two registration paths and their initialization limits.

## Alternatives considered

- Convert all services to no-argument construction: removes the existing injection contract to solve two registrations.
- Widen constructors with `any`, `never` or an assertion: fails to express the actual parameter contract or the relation between the registered class and its instance.
- Change AiStreamManager to dependency-first construction: changes its config-first contract and direct callers without being required for explicit factory construction.
- Add a dependency-type registry and typed decorators: expands lifecycle typing across every service and composition boundary; this repair needs only two explicit constructions.

## Acceptance criteria

- AC1 — The ServiceContainer unit suite observes exact dependency instance identity and declaration order for ordinary class injection, with unchanged lazy singleton behavior. (verification: unit)
- AC2 — The factory unit suite observes no execution during registration, dependencies resolved before creation, one creation per container, and identical instances from class and name lookup. (verification: unit)
- AC3 — The ServiceContainer unit suite confirms conditions and transitive exclusion suppress factory execution, missing or failed dependencies prevent creation, and factory failures follow existing failure propagation. (verification: unit)
- AC4 — Main typecheck rejects factories returning an incompatible service or a promise, accepts both parameterized production services, and requires no constructor-erasure assertion or argument widening. (verification: unit)
- AC5 — AiStreamManager contract tests retain configured buffer/grace-period behavior with the existing config-first construction and release activity holds after execution; UtilityProcessManager tests retain default and overridden dependency behavior. (verification: unit)
- AC6 — Lifecycle unit coverage retains phase initialization and shutdown behavior for both registration paths; direct early resolution is documented as construction rather than initialization readiness. (verification: unit)
- AC7 — Service registration coverage retains the class-valued registry and declaration order when factory overrides replace the two registrations. (verification: unit)
- AC8 — References document factory registration and direct construction, including initialization limits, and the bilingual Spec passes the documentation gate. (verification: docs gate)

## Risks

Class identity must not acquire a constructor signature that again promises arbitrary arguments. Factory result inference must stay anchored to the target. Factories only construct their target and do not resolve dependencies through the global application. AiStreamManager retains its existing application-bound activity lookup; this proposal does not introduce container-local activity injection. The factory branch must share registration and exclusion logic with the class branch so metadata behavior cannot drift.

This is a proposed design. Container implementation starts after its Spec PR exists. The anti-slop cleanup and its final rule remain incomplete until their own findings and hosted checks are cleared; publishing this Spec does not establish a passing build.
