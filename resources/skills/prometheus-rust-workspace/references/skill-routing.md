# Rust skill routing

Use `rust-router` first when it is available. Select the minimum relevant set and do
not repeatedly load overlapping baseline skills.

## Baseline

- `rust-guidelines` — API design, architecture, idioms, errors, crate organization,
  documentation, FFI, and safety.
- `rust-skills` — ownership, errors, async, concurrency, performance, memory,
  testing, and unsafe-code guidance.
- `coding-guidelines` — naming, conventions, API consistency, and general quality.
- `rust-best-practices` — general Rust implementation and review.
- `rust-async-patterns` — Tokio, async I/O, concurrency, cancellation, and async
  debugging.
- `rust-mcp-server-generator` — Rust MCP server and transport work. Apply its
  patterns to an existing server and validate examples against pinned SDK versions.

## Language mechanics

- `m01-ownership` — ownership, borrowing, lifetimes, moves, E0382, E0505, E0515,
  E0597, and unnecessary cloning.
- `m02-resource` — `Box`, `Rc`, `Arc`, `Weak`, `Cell`, `RefCell`, allocation, and
  shared ownership.
- `m03-mutability` — mutable borrowing, interior mutability, aliasing, E0499,
  E0502, and E0596.
- `m04-zero-cost` — traits, generics, monomorphization, dynamic dispatch,
  `impl Trait`, and `dyn Trait`.
- `m05-type-driven` — newtypes, typestate, enums, `PhantomData`, sealed traits, and
  invalid-state prevention.
- `m06-error-handling` — `Result`, `Option`, `?`, panic policy, custom errors,
  `thiserror`, `anyhow`, and propagation.
- `m07-concurrency` — async/await, Tokio, threads, tasks, channels, locks, atomics,
  `Send`, `Sync`, cancellation, and structured concurrency.

## Design and architecture

- `m09-domain` — domain modeling, entities, value objects, aggregates, and DDD.
- `m10-performance` — profiling, benchmarking, allocations, throughput, latency,
  cache behavior, and optimization.
- `m11-ecosystem` — crate evaluation, dependency selection, Cargo features,
  compatibility, maintenance, and conventions.
- `m12-lifecycle` — RAII, `Drop`, initialization, cleanup, guards, pools, and lazy
  initialization.
- `m13-domain-error` — domain errors, retries, idempotency, recovery, circuit
  breakers, and failure ownership.
- `m14-mental-model` — explanations and conceptual diagnosis.
- `m15-anti-pattern` — unnecessary clones, excessive `Arc<Mutex<_>>`, stringly
  typed APIs, unwrap abuse, and overused dynamic dispatch.

## Codebase analysis and refactoring

- `rust-code-navigator` — implementations, modules, definitions, references, and
  code paths.
- `rust-symbol-analyzer` — structs, enums, traits, functions, and relationships.
- `rust-trait-explorer` — implementations, bounds, associated types, blanket impls,
  and resolution.
- `rust-call-graph` — callers, callees, execution paths, and change impact.
- `rust-deps-visualizer` — workspace and crate dependencies.
- `rust-refactor-helper` — renames, extraction, moves, API changes, and impact.
- `rust-learner` — current Rust and crate information when version accuracy matters.
- `meta-cognition-parallel` — complex problems that need simultaneous domain,
  design, and language-mechanics analysis.

## Unsafe Rust

Use `unsafe-checker` for unsafe blocks, functions, traits, or impls; raw pointers;
manual `Send` or `Sync`; FFI; `MaybeUninit`; `ManuallyDrop`; unions; transmutation;
custom allocation; pinning or self-references; or lock-free structures. Document each
safety invariant. Collect appropriate Miri, sanitizer, fuzzing, or Loom checks, then
run them at the next applicable phase or safety boundary. A skill review is not a
soundness proof.

## Domain skills

- `domain-cli` — command-line apps, configuration precedence, terminal UX, exit
  codes, and shell integration.
- `domain-web` — HTTP services, Axum, Actix, Tower, Hyper, middleware, and latency.
- `domain-cloud-native` — containers, Kubernetes, observability, health checks,
  shutdown, distributed systems, and twelve-factor apps.
- `domain-embedded` — `no_std`, microcontrollers, fixed memory, interrupts,
  peripherals, and real-time constraints.
- `domain-iot` — devices, gateways, telemetry, offline operation, power, and device
  security.
- `domain-fintech` — money, decimal precision, ledgers, audit trails, transactions,
  consistency, and financial systems.
- `domain-ml` — tensors, inference, GPU acceleration, numerical work, and
  memory-intensive workloads.

When routing to a testing, review, performance, safety, or verification skill,
collect its recommended checks but defer execution until the next phase boundary
unless an immediate check is necessary to unblock implementation.
