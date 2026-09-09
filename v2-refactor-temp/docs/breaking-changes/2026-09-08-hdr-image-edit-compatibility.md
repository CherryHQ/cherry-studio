---
title: HDR reference photos are converted for image editing
category: changed
severity: notice
introduced_in_pr: TBD
date: 2026-09-08
---

## What changed

Local JPEG reference photos with a recognized HDR gain map are automatically converted to ordinary SDR JPEG upload copies before image editing. Original files, ordinary images, masks, and remote image URLs are unchanged.

## Why this matters to the user

This avoids sending HDR auxiliary images to providers that reject them. Photo orientation and full resolution are preserved, but HDR brightness and wide-gamut colors may look different in the SDR copy.

## What the user should do

Nothing — automatic.
