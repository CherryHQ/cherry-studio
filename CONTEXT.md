# Conversation Ownership

This context describes how conversation containers relate to the configurable entities that provide their behavior.

## Language

**Unlinked Session**:
An active Session whose associated Agent is not currently active. It cannot run until reassigned, and may retain its former ownership link so that restoring the Agent restores the relationship.
_Avoid_: Orphan Session, ownerless Session

**Unlinked Agent group**:
The display group that collects Unlinked Sessions. It is not an Agent and cannot own or run a Session.
_Avoid_: Default Agent, virtual Agent

**Unlinked Topic**:
An active Topic whose associated Assistant is not currently active. It may be reassigned to an active Assistant or recover its former relationship when that Assistant is restored.
_Avoid_: Orphan Topic, ownerless Topic

**Unlinked Assistant group**:
The display group that collects Unlinked Topics. It is not an Assistant and cannot own a Topic.
_Avoid_: Default Assistant, virtual Assistant

**Standalone deletion**:
A deletion that moves only the selected Agent or Assistant to the Recycle Bin while its Sessions or Topics remain active and become unlinked.
_Avoid_: Non-cascade deletion, owner-only cascade

**Cascade deletion**:
A single reversible deletion that moves an Agent or Assistant and its currently active Sessions or Topics to the Recycle Bin together. Restoring the parent restores exactly the still-trashed children moved by that deletion; children may be restored independently, and permanent deletion remains item-scoped.
_Avoid_: Bulk deletion, recursive deletion
