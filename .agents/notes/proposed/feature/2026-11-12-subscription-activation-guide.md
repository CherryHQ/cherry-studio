# Agent Note: Subscription activation guide

Status: proposed

English | [中文](2026-11-12-subscription-activation-guide.zh.md)

## Problem

A user subscribes to a Cherry Cloud plan in the external browser and returns to the app. The only feedback is a transient "{{plan}} activated" toast, which the China edition suppresses while the notification center is live. The plan's models are already synced into the chat header model selector, but nothing tells the user where they are or lets them start using one.

## Proposal

- When the existing reminder detects a fresh transition to an active paid plan, the main window opens an activation dialog instead of the toast. The dialog is plan-agnostic: it never shows the plan name, its header is a neutral illustration of a model menu, and its body lists the plan's chat models that are already available locally (at most three rows, the rest summarized as a count) plus the period end when the entitlement has one.
- The first model is preselected. "Start chatting" records the chosen model and opens the chat tab; an optional "Also set as default model" checkbox writes `chat.default_model_id` through `useDefaultModel`. Closing the dialog records the new models without a choice.
- The active chat tab consumes the recorded choice once and applies it through the chat header's existing model-selection handler, so assistant settings reconciliation stays in one place.
- The same chat tab then shows a one-time guide: the page is dimmed except for the header model trigger, and an anchored popover previews the new models and explains that the trigger switches models. Dismissing it, opening the trigger, or pressing Escape clears the record so it never repeats.
- If none of the plan's models are available locally, keep the existing toast. While the China edition's notification center is live, it alone announces the activation, as it does today; neither the dialog nor the toast is shown. Analytics and plan detection are unchanged.

## Alternatives considered

- Keep the toast and only add a coachmark: the toast disappears before users act and does not let them choose a model.
- Switch the model from the main-window dialog directly: there is no global active-conversation owner, so it would duplicate the assistant settings reconciliation done by the chat header.
- Show plan-specific artwork or model logos in the header: plans and their models change, and plans target different users who must not see each other's names.

## Acceptance criteria

- AC1 — A fresh transition to an active paid plan opens the activation dialog listing the plan's locally available chat models without any plan name, and no activation toast is shown. (verification: renderer)
- AC2 — When none of the plan's models are available locally, the existing activation toast is shown instead of the dialog; while the China edition's notification center is live, neither is shown. (verification: renderer)
- AC3 — "Start chatting" switches the active chat conversation to the selected model through the header selection handler, and the checkbox additionally sets the default assistant model. (verification: renderer)
- AC4 — After the dialog closes, the next active chat tab shows the spotlight guide on the header model trigger once; dismissing it by button, trigger, or Escape prevents it from showing again. (verification: renderer)
- AC5 — Dialog and guide use shared UI primitives, remain legible in light and dark themes, and every visible string is localized in all renderer locales. (verification: Electron + i18n gate)

## Risks

- China-edition users with a live notification center do not get the dialog or the chat guide; they rely on the notification center entry.
- The model list depends on `plan.models` or the entitlement quota pools; if the server omits both, users fall back to the toast.
