---
icon: git-branch
---

# Multiple models and conversation branches

A question can have several answers, and each answer can lead to its own discussion path. The selected answer determines the path for the next message. Switching does not merge conclusions or undo completed tool actions.

## Ask several models at once

1. Open the model picker in a local text conversation and enter multi-select mode.
2. Choose **2–8 text models**, return to the composer, and send a question.
3. Read each response, then select one to continue.

Multi-selection affects subsequent sends immediately but **does not replace the agent's default model**. Leaving multi-select returns to the agent model; an ordinary single-model choice updates that agent.

Each response incurs its own model usage and uses that model's default reasoning level. Image-generation models cannot join parallel text responses.

## Read and continue an answer

Choose the presentation in **Settings → General → Multi-model reply cards**. Cards open full reading and allow switching between answers; standard presentation also offers answer-version selection.

Select the answer before asking a follow-up. Other answers and their follow-up paths remain. Sharing reads the chosen path and selected messages, not every alternative.

Parallel responses use a restricted read-only tool set. Automatic approval does not allow file writes or calendar changes in this mode. Select an answer and continue with one model for actual modifications.

## Regenerate or add another model's answer

The old rule that regeneration replaces the only answer no longer applies:

* **Answer again**, or adding another model's answer to the same question, preserves selectable answer paths.
* Where the answer area offers an additional-model action, choose a model and request its answer, then continue its own path.
* Busy, running, or unsupported messages may not offer these operations. Wait or stop as the screen allows.

Regeneration is a new request and can incur new charges. Retained paths do not roll back edited files or sent content; inspect the actual destination.

## Edit a sent question or answer

* **Edit question:** use the sent question's menu, revise, and resubmit. This creates a branch there while retaining the original question, answers, and subsequent conversation.
* **Edit answer:** when a completed local answer offers editing and the conversation is idle, revise its final text and save. The edited text participates in later turns and branches. This neither calls the model again nor repeats or reverses old tool actions.
* **Branch into a new chat:** copy the context up to that point into an independent conversation, retaining the original.

Handle unsaved-change prompts before leaving the answer editor. To reference only an excerpt, select answer text and insert a quote. Several quotes can be interleaved with your own questions, and a sent quote can return to its source.

## Tree or flat sidebar display

**Settings → General → Branch conversation tree view** controls presentation and is enabled by default. Disabling it lists conversations by recent activity without deleting or merging branches. Grouping recent items by agent/session is separate.

## Queue, take back, and Steer

Submit follow-ups while a response is running. Open a queued item for complete text and attachments. Remove an unstarted item or take it back to the composer for editing; handle draft-conflict notices rather than overwriting newer input.

When **Steer** is offered, send a queued requirement into the active task so it can be considered at a subsequent execution boundary. It does not rewrite already completed output and differs from a separately queued turn.

Queues can recover with conversation state. Leaving the page is not cancellation. Inspect execution, waiting, and approval states before stopping or resending. See [Chat and files](chat-and-files.md) for attachments.
