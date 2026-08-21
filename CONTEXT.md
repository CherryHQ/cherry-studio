# Conversation Activity Context

Shared language for user-visible AI interactions whose current activity may be surfaced outside their conversation view.

## Language

**Conversation Activity**:
An in-progress or recently changed interaction belonging to either an Assistant Conversation or an Agent Session.
_Avoid_: Task, stream, request

**Primary Activity**:
The single Conversation Activity currently presented when several activities are eligible for attention.
_Avoid_: Latest task, active stream

**Assistant Conversation**:
A user conversation with an assistant, organized as a topic.
_Avoid_: Chat task, agent task

**Agent Session**:
A goal-oriented conversation executed by an agent.
_Avoid_: Assistant conversation, background task

**Conversation Island**:
A macOS-only transient surface at the top of a display that presents the Primary Activity without replacing the conversation itself.
_Avoid_: System notification, activity list, Dynamic Island clone

**Awaiting Confirmation**:
A Conversation Activity that cannot continue until the user responds to a confirmation or other required interaction.
_Avoid_: Awaiting approval when the interaction may be a question or plan review
