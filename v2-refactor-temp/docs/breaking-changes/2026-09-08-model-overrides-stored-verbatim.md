---
title: Model edits are stored exactly as made
category: changed
severity: notice
introduced_in_pr: "#17383"
date: 2026-09-08
---

## What changed

Editing a catalog model in the drawer now stores only the field that was edited, as an override of the catalog value. Until now every edit also re-sent the model's name, group and streaming flag, and the app compared each value with the catalog to decide whether it "counted" as a change. A value that happened to equal the catalog was silently dropped; a value that differed only in list order was silently frozen.

The classification section's reset now hands capabilities and input modalities back to the catalog instead of re-saving the current values. A field that follows the catalog keeps following it when the catalog updates; a field that was edited keeps the edited value until it is reset.

An upgrade migration turns the old add form's "no modality chosen" marker back into "unset", so those models pick up the catalog's input modalities again. A one-time pass on first launch also hands back every stored value that equals today's catalog value, since such a value changed nothing and only blocked future catalog updates.

The drawer's "Overrides" card lists the fields a catalog model overrides; removing one makes that field follow the catalog again.

Two smaller consequences. Turning an operation off on a catalog model no longer copies the catalog's endpoint list into the model; the list narrows itself while it stays inherited. And the Preferred Endpoint picker only appears once a model declares endpoints, since pinning an undeclared endpoint used to silently write the provider's whole endpoint list into the model.

## Why this matters to the user

Catalog updates reach models that were opened in the drawer but not actually changed, and a reordered capability list no longer pins a model to a stale catalog entry.

## What the user should do

Nothing. A model whose capabilities or modalities were edited by hand and should follow the catalog again can be reset from the drawer's classification section.
