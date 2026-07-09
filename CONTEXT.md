# Cherry Studio Context

Cherry Studio is an AI conversation application. This glossary names product and UI concepts whose meanings need to stay consistent across chat and agent work.

## Language

**Composer**:
The user input surface for drafting and sending a chat or agent-session turn.
_Avoid_: Input box, inputbar, prompt box

**Pane**:
A secondary chat surface attached to a conversation shell for related context such as sessions, files, status, trace, or branches.
_Avoid_: Sidebar, drawer, panel

**Maximized Pane Overlay**:
A pane presentation across conversation surfaces that expands over the conversation center while remaining behind the composer when the composer is visible. Its surface may continue behind the composer, but its primary content remains readable above the composer.
_Avoid_: Fullscreen pane, modal, file preview overlay

**Composer Safe Area**:
The visible region reserved for the composer when another conversation surface expands behind it. Concrete scroll containers consume this area so primary content remains readable.
_Avoid_: Bottom gap, overlay padding, composer offset
