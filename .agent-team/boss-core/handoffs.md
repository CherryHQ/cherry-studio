# Product, design and cross-project handoffs

Use agent-team-handoff for changes of role or harness within the local team, preserving task/state revision, Git HEAD/dirty paths, completed work, evidence, remaining work and acceptance. It does not stop the source process; stop/reconcile active writers before acceptance. The local ledger only transfers to its own declared roles; a UAR role ID is not automatically a valid local destination.

For a peer project, draft a packet under .agent-team/boss-core/handoffs and let the authorized destination team create/accept its own task. Include: request ID, source and destination project/role, intent/non-goals, repository revisions, actual vs planned connection, protocol version, affected types/events, ownership, test vectors, cancellation/error/recovery semantics, evidence links, unresolved decisions and acknowledgement status. A draft is not delivery or acceptance.

| Boss responsibility | UAR peer | Contract |
| --- | --- | --- |
| lead + product | uar-lead | outcome, scope, priorities, dependency milestones and acceptance |
| runtime | uar-runtime | run/session identity, ordering, cancellation, resume, lifecycle |
| security + runtime | uar-trust-tools | approval authority, tools, workspace bounds, identity and redaction |
| providers | uar-providers | IDs, capabilities, streaming/tool wire fidelity and budgets |
| data | uar-state | persistence, recovery, memory scope and ownership |
| UX + renderer | uar-console | operator terminology and cross-surface journeys, not shared UI architecture |
| verifier | uar-verifier | independently reproduced contract and integration evidence |

Product-to-UX: evidence-backed user job, constraints, priorities, acceptance criteria and unknowns. UX-to-renderer: journey/state/component/accessibility contract. Implementation-to-verifier: cumulative artifacts/diff, requirements, actual command/platform receipts and known gaps; omit producer reasoning and preferred verdict. User retains decisions on priorities and external commitments. Do not contact people or other projects without explicit authorization.

