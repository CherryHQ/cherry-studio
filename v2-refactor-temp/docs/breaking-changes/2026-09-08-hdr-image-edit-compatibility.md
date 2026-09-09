---
title: HDR reference photos are converted for image editing
category: changed
severity: notice
introduced_in_pr: '#20261'
date: 2026-09-08
---

## What changed

Local JPEG reference photos with a recognized HDR gain map are automatically converted to ordinary SDR JPEG upload copies before image editing. Original files, masks, and remote image URLs are unchanged; ordinary images pass through except that local JPEG inputs exceeding 100 million pixels are rejected before decoding.

## Why this matters to the user

This avoids sending HDR auxiliary images to providers that reject them. Pixel coordinates, EXIF display orientation, and full resolution are preserved so paired masks remain aligned, but HDR brightness and wide-gamut colors may look different in the SDR copy.

## What the user should do

Nothing — automatic.
