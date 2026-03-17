# Current Glide Flow — Pitch Tracker Prototype

This document explains how the current Glide-based Pitch Tracker prototype behaves from a user and system perspective. It is intended as migration reference for rebuilding the app on Vercel + Neon.

The purpose is not to preserve Glide-specific implementation details forever, but to preserve the user flow, naming conventions, and business logic that currently work.

---

# 1. Product Intent

The current prototype is designed for a coach running a live pitching practice session on a phone.

The coach needs to:

* start a practice session
* select which pitchers are involved
* choose the current active pitcher
* choose the current target zone
* record each pitch result quickly
* switch pitchers during the same session
* view current session stats for a selected pitcher
* eventually review historical player stats

The current Glide app proves that this workflow is viable, but it is too slow because it relies on Glide + Google Sheets + Apps Script + a separate web embed.

---

# 2. High-Level App Flow

## Step 1 — Start Practice

The coach starts a new session.

### What happens conceptually

* A new row is created in `Sessions`
* The session gets a `SessionID`
* `SessionStart` is populated
* `IsActive` is set to true
* Session participants may be initialized depending on the current legacy flow

### Legacy implementation notes

In the legacy system, Apps Script handled session creation and some participant setup.

---

## Step 2 — Open Session Detail / Practice Screen

This is the main screen used during practice.

The coach interacts with:

* current pitcher selector
* stats pitcher selector
* target zone selector
* pitch logging buttons
* session stats area
* heatmap

This screen is the most important screen in the whole app and should drive the rebuilt UX.

---

# 3. Main Concepts in the Current Glide App

## CurrentPitcherID

The pitcher currently selected for recording pitches.

This controls which pitcher new pitch rows are written for.

## StatsPitcherID

The pitcher currently selected for viewing stats.

This may be the same as `CurrentPitcherID`, but not necessarily.

This distinction is important and should be preserved in the rebuilt app.

## CurrentTargetZone

The currently selected intended target zone before a pitch result is recorded.

The coach chooses a target zone, then records a pitch result against that target.

---

# 4. Practice Screen Detail

## 4.1 Pitcher Selection

The coach selects a pitcher from a dropdown/list.

### In the current prototype

There are effectively two relevant pitcher states:

* `CurrentPitcherID`
* `StatsPitcherID`

The app may set one or both depending on the specific screen interaction.

### Behavior to preserve

The rebuilt app should support:

* selecting a current pitcher for entry
* selecting a pitcher for stats view
* fast switching between pitchers

---

## 4.2 Target Zone Selection

The coach selects one of nine zones in a 3x3 target grid.

### Meaning

This becomes the `TargetZone` on newly recorded pitch rows.

### Behavior to preserve

* clear visual selection state
* quick tap interaction
* mobile-friendly layout

---

## 4.3 Recording a Pitch

After choosing the current pitcher and target zone, the coach records the result of a pitch.

### Input options

* one of nine zones representing the actual location
* a separate `Ball` action

### Current business logic

Each recorded pitch creates one row in `Pitches`.

The important values are:

* `SessionID`
* `PitcherID`
* `TargetZone`
* `ActualZone` or blank for ball
* `IsBall`
* `Points`
* `Timestamp`

### Scoring rules

* direct hit = 3 points
* neighbor hit = 1 point
* miss = 0 points
* ball = 0 points

### Intended UX

This should be extremely fast and low-friction. The coach should be able to record live pitches without delays.

---

# 5. Session Stats Flow

## 5.1 What the user expects

When a pitcher is selected for stats, the app should show that pitcher’s stats for the current session.

This includes:

* total pitches
* strikes
* balls
* points
* direct hits
* neighbor hits
* misses
* per-zone heatmap stats

## 5.2 How the legacy prototype handled it

The Glide prototype used:

* raw data in `Pitches`
* Apps Script rollups into `SessionPitcherStats`
* selected stats copied back onto the `Sessions` row
* a generated `SessionStatsEmbedURL`
* a web embed component for the summary/heatmap UI

This architecture worked, but it was slow and fragile.

## 5.3 Behavior to preserve

The rebuilt app should keep the same *visible outcome*:

* selecting a pitcher updates displayed stats
* stats reflect only that pitcher within the current session
* heatmap updates accordingly

But the rebuild should do this natively in the app without Apps Script or embeds.

---

# 6. Heatmap Behavior

## Purpose

Show pitching efficiency by target zone in a 3x3 grid.

## Per-zone values

For each target zone 1–9, the system tracks:

* direct hits
* neighbor hits
* misses

## Efficiency formula

For each zone:

* `targeted = direct + neighbor + miss`
* `earned = (direct * 3) + neighbor`
* `possible = targeted * 3`
* `efficiency = earned / possible * 100`

## Display format

Each tile shows:

* a large centered percentage
* a slash line underneath in the format `direct / neighbor / miss`

## Styling direction

The current GitHub Pages heatmap repo is the visual reference and should be replicated directly in the rebuilt app.

Reference repo:

* `seanmcqueen-dev/crush-session_stats_heatmap`

---

# 7. Current Data Flow in Glide Prototype

## Session creation flow

1. User starts a session
2. Session row is created in `Sessions`
3. Session metadata is filled in

## Pitch logging flow

1. User selects target zone
2. User records pitch result
3. New row is added to `Pitches`
4. Legacy stat refresh may or may not run automatically depending on Apps Script behavior

## Stats display flow

1. User selects stats pitcher
2. Legacy refresh process recomputes pitcher stats
3. Stats are written to `SessionPitcherStats`
4. Selected stats are copied back to `Sessions`
5. `SessionStatsEmbedURL` is rebuilt
6. Web embed renders session summary/heatmap

## Main pain points

* slow sync
* Apps Script timing issues
* manual refresh requirements
* web embed overhead
* Google Sheets being used like a transactional backend

---

# 8. Key UX Elements to Preserve in Rebuild

## Visual style

The rebuilt app should look very similar to Glide:

* dark theme
* maroon/burgundy accents
* rounded cards
* compact stat cards
* mobile-first layout
* strong visual hierarchy

## Functional style

The rebuilt app should preserve:

* one-tap pitch logging
* fast pitcher switching
* clear current target selection
* live session stats
* clear heatmap visualization

## Terminology to preserve

Use the same names where practical:

* Session
* Pitcher
* CurrentPitcherID
* StatsPitcherID
* CurrentTargetZone
* TargetZone
* ActualZone
* IsBall
* Points

---

# 9. Rebuild Interpretation

The rebuilt Vercel version should preserve the user flow, but simplify the architecture.

## What to preserve exactly

* the core practice workflow
* the distinction between current pitcher and stats pitcher
* the 3x3 target grid interaction
* the points system
* the heatmap logic
* the visual style

## What to replace completely

* Google Sheets as source of truth
* Apps Script stat refresh logic
* `SessionStatsEmbedURL`
* web embed rendering
* manual sync/recompute dependency

---

# 10. Recommended Rebuilt Flow

## Start session

* create session record in Postgres

## Open live session screen

* load session state
* show current pitcher and target zone controls

## Record pitch

* insert pitch row into Postgres
* requery session/pitcher stats immediately
* rerender stats and heatmap instantly

## Change stats pitcher

* update selected stats pitcher
* requery stats immediately
* rerender stats and heatmap instantly

## Review player history

* use the same `pitches` table for historical stats and trends

---

# 11. Migration Guidance for Builder

When rebuilding, treat the Glide app as the UX prototype and business-rule reference, not as the system architecture to preserve.

The final app should feel like the same product, but faster and cleaner.

### Most important success criteria

* same mental model
* same visual feel
* same pitch-entry flow
* same stats behavior
* dramatically better speed and reliability
