---
title: Image-generation model & parameters moved into the prompt bar toolbar
category: moved
severity: notice
introduced_in_pr: 16326
date: 2026-06-24
---

## What changed

On the Paintings page, the left settings panel is gone. The image-generation **model selector** and the **generation parameter list** (size, seed, etc.) now live in a toolbar at the bottom of the prompt input — the model as a dropdown, the parameters behind a settings (⚙) popover. The prompt box itself is now the shared rich-text composer (with image-input attach/paste/drag for edit-image models).

## Why this matters to the user

The Paintings layout changes from three columns (settings panel · canvas · history) to canvas + history, with model/params controls relocated into the prompt bar. Users who previously adjusted parameters in the always-visible left panel now open the ⚙ popover in the toolbar instead.

## What the user should do

Nothing — automatic. The same model picker and parameters are available; they are reached from the prompt bar toolbar rather than the left panel.

## Notes for release manager

UI-only relocation; no data migration. Painting generation behavior, parameters, and history are unchanged. Related: part of the v2 composer unification (the generic composer moved to `components/composer/`).
