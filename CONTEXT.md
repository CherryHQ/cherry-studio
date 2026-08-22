# Conversation Activity Context

Shared language for user-visible AI interactions whose current activity may be surfaced outside their conversation view.

## Language

**Conversation Activity**:
An in-progress or recently changed interaction belonging to either an Assistant Conversation or an Agent Session.
_Avoid_: Task, stream, request

**Primary Activity**:
The single Conversation Activity prioritized in the compact Conversation Island when several activities are eligible for attention.
_Avoid_: Latest task, active stream

**Assistant Conversation**:
A user conversation with an assistant, organized as a topic.
_Avoid_: Chat task, agent task

**Agent Session**:
A goal-oriented conversation executed by an agent.
_Avoid_: Assistant conversation, background task

**Conversation Island**:
A macOS-only transient surface at the top of a display that presents the Primary Activity compactly and eligible Conversation Activities when expanded, without replacing the conversation itself.
_Avoid_: System notification, Dynamic Island clone

**Awaiting Confirmation**:
A Conversation Activity that cannot continue until the user responds to a confirmation or other required interaction.
_Avoid_: Awaiting approval when the interaction may be a question or plan review

## Ownership Boundaries

Conversation Activity is shared domain language, not a new application-wide event source or notification contract.

`ConversationIslandService` exclusively owns continuous Conversation Activity observation, topic-to-target projection, title fallback, presentation state, and the transient window. The service is conditionally registered only on macOS. `NotificationService` continues to own completion and confirmation notification delivery; it does not observe the continuous status stream for Conversation Island.

On Windows and Linux, Conversation Island registers no lifecycle service and runs no Cache, Preference, display, timer, geometry, or window work. Packaging excludes its feature-only preload, renderer HTML, and renderer entry chunk. Shared compile-time types plus inert IPC and window metadata remain in the common main bundle; the feature does not introduce a platform-specific Vite build or registry variant.
