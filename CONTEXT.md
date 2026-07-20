# Job Scheduling

This context defines the language for persistent scheduled work and its individual executions.

## Language

**Job Schedule**:
A persistent definition of when future Jobs are created and which execution configuration they receive. Editing execution configuration affects future fires without changing the existing cadence; changing the trigger changes the cadence.
_Avoid_: Job, scheduled job, timer

**Job**:
A single execution created from a Job Schedule or an explicit request.
_Avoid_: Job Schedule, task definition, timer

**Paused Job Schedule**:
A Job Schedule that cannot create Jobs autonomously. Explicit execution requests remain allowed, and existing Jobs are unaffected.
_Avoid_: Cancelled schedule, paused Job, disabled Job

**Schedule Fire**:
An autonomous occurrence of a Job Schedule's trigger that creates a Job and advances the Schedule's timing state.
_Avoid_: Job completion, timer callback

**Delivery Routing**:
The current set of channels selected when a Job begins execution and held stable for that execution. It is resolved independently from the Job's execution configuration and may therefore change while a Job is still queued.
_Avoid_: Job input, channel snapshot, Schedule trigger
