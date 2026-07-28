---
name: demand-first-review
description: Use when reviewing a PR, API, IPC channel, endpoint, parameter, type, config, or architectural extension point that adds or expands shared surface area, especially when consumers are absent, exports are unused or speculative, existing consumers are hack-heavy, forward compatibility is claimed, or multiple similar APIs may express one demand.
---

# Demand-First Review

## Principle

Audit this causal chain before implementation quality:

`root outcome or invariant → normalized demand → owning layer → contract → consumer`

A call site proves usage, not legitimacy or shape. No call site raises the burden of proof, not an automatic rejection. Real demand may still have the wrong consumer or abstraction.

## Workflow

Apply every step to each added API, channel, parameter, type, field, config, or extension point.

### 1. Reconstruct the demand

List every new surface and exact consumed dimension; one valid consumer does not justify unused fields. Trace current and linked consumers to their user outcome, business rule, or system invariant. Inspect adjacent implementations, then ask: without the current API and history, would the demand remain and would this contract still be natural? Do not rely only on the PR description.

### 2. Audit consumer legitimacy

- **Legitimate**: uses the correct owner and boundary.
- **Compensating**: uses the nearest API and adds workarounds because the right capability is missing.
- **Legacy-shaped**: reflects obsolete formats, transitional architecture, or history.
- **Misplaced**: serves real demand in the wrong layer.

Parsing, retries, sequencing, duplicated state, check-then-act, or cross-layer access signal compensation. Treat these as unmet upstream demand, never endorsement of the current surface.

### 3. Normalize related demands

Strip names, historical formats, and workarounds from demand statements. Cluster by outcome, source of truth, owner, transaction, security, and lifecycle. Consolidate historical or caller-specific differences; keep contracts separate for genuine ownership, permission, atomicity, lifecycle, side-effect, or failure differences. Prefer a stable core with thin adapters, not duplicated workflows or a lowest-common-denominator API.

### 4. Classify evidence

- **Direct**: a legitimate current consumer uses the dimension.
- **Committed**: a concrete consumer exists in the same change or linked near-term work.
- **Architectural**: a minimal seam must precede consumers to protect a concrete invariant.
- **Unsupported speculation**: only a possible future is named, without a concrete scenario, owner, or omission cost.

Direct consumption proves pressure, not placement or shape.

### 5. Test architectural demand

For a surface without a legitimate current consumer, require all five:

1. A concrete consumer class or extension scenario;
2. The owning layer and protected invariant;
3. A causal omission cost, such as boundary violations, duplicated mechanisms, incompatible implementations, security gaps, or migration lock-in;
4. Why the seam must exist before its first consumer; and
5. The smallest stable mechanism that protects the invariant.

Reject "future features", "flexibility", "centralization", "technical constraints", or "migration risk" without linked evidence and a causal failure. If the test fails, defer or remove. If it passes, preserve only the minimal paved road and remove guessed dimensions.

### 6. Check responsibility and overlap

Place behavior by ownership, not line count. Centralize security, permissions, transactions, invariants, and shared policy; leave presentation and caller-specific composition in consumers. Prefer try-the-operation when the owner can enforce atomically.

Compare contracts by semantics, owner, permissions, exposure, atomicity, lifecycle, failure model, and cost. Shared data alone does not prove duplication; reuse only when these are equivalent.

### 7. Decide, then review implementation

Choose one outcome per surface or normalized group:

- **Keep**: demand and shape are justified.
- **Narrow**: remove unsupported dimensions.
- **Split**: separate a valid core from unrelated concerns.
- **Consolidate**: merge surfaces expressing one demand.
- **Replace**: keep the demand, change consumer, owner, or abstraction.
- **Defer**: do not commit a possible demand yet.
- **Remove**: no demand remains or an equivalent contract owns it.

Report root outcome, evidence, consumer legitimacy, essential differences, owner, alternatives, and decision first. Review implementation quality only for survivors.

## Rationalization Guards

| Claim | Response |
|---|---|
| "The API is clean; the types are elegant." | Quality cannot justify existence. |
| "It has consumers." | Verify legitimacy and exact consumption; workarounds endorse nothing. |
| "It has no consumers." | Run the five-part architectural test; absence alone decides nothing. |
| "The export is unused; add a test." | Tests verify behavior; they do not create demand. |
| "The architecture will need it." | Name the invariant, causal omission cost, consumer class, why now, and minimal seam. |
| "A technical constraint requires it." | Trace the constraint to root demand; constraints are not axioms. |
| "Existence is the architect's call." | Authority neither exempts demand review nor reduces it to a nit. |
| "The caller can compute it in one line." | Place policy by ownership and invariants, not code length. |
| "The existing API returns the same data." | Compare full semantics before declaring duplication. |
| "These consumers differ slightly." | Prove differences are semantic, not historical or caller-specific. |
| "It is forward-compatible or additive." | Keep only concrete needs; additive contracts carry permanent cost. |

## Red Flags

Pause and restart from Step 1 when:

- Implementation comments accumulate before stating root demand, evidence, and legitimate consumers.
- A call site is treated as proof that the contract belongs here or has the right shape.
- Zero current consumption is treated as automatic rejection or permission to accept an architectural claim.
- A compensating or hack-heavy consumer is used to freeze its workaround into the shared contract.

## Calibration

- Linked independent modules would otherwise import privileged internals: **keep the minimal registration seam; remove guessed knobs**.
- A renderer parses raw errors and retries because no atomic operation exists: **replace the abstraction rather than expand the error taxonomy**.
