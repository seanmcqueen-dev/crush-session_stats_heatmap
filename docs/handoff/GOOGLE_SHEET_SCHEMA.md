# Google Sheet Schema — Pitch Tracker Prototype

This document captures the current Google Sheets prototype schema used in the Glide-based Pitch Tracker app. It exists as migration reference material for rebuilding the app on Vercel + Neon.

The Google Sheet prototype should be treated as a **legacy reference**, not the long-term source of truth.

## Purpose

This schema documents:

* current table/tab names
* important column names
* column meanings
* which columns are operational vs derived
* how the current Glide prototype thinks about state

The goal is to preserve business logic and naming conventions during the rebuild.

---

# Workbook / Tabs

Current important tabs:

* `Players`
* `Sessions`
* `Pitches`
* `SessionPitcherStats`
* `Zones`
* `PracticeSetup`
* `TargetModeOptions`
* `Users` (if present in Glide source)

Not every tab necessarily needs a direct one-to-one replacement in the new Vercel app.

---

# 1. Players

## Purpose

Stores the player roster used for pitcher selection and later player-level stats.

## Core columns

Expected / observed important fields:

* `PlayerID`
* `FirstName`
* `LastName`
* `JerseyNumber`
* optional display / lookup / derived fields used by Glide

## Meaning

* `PlayerID`

  * canonical player identifier
  * current format is like `P-01`, `P-02`, etc.
  * this format should be preserved in the rebuild where practical

* `FirstName`

  * player first name

* `LastName`

  * player last name

* `JerseyNumber`

  * numeric jersey used to help generate player code in legacy scripts

## Notes

Legacy Apps Script included a helper that populated `PlayerID` from jersey number using zero-padded format:

* jersey `1` -> `P-01`
* jersey `2` -> `P-02`

This naming convention is worth preserving in the rebuilt app to reduce confusion.

---

# 2. Sessions

## Purpose

Stores one row per practice session and also holds the currently displayed stats for the selected pitcher in that session.

This table acts as both:

* session metadata
* current UI/session state
* a display/cache location for selected pitcher stats in the Glide prototype

## Observed header row

```txt
SessionID
SessionStart
SessionEnd
IsActive
SessionName
TargetMode
PitchesPerPlayer
SelectedPlayerIDs
CurrentPitcherID
CurrentTargetZone
StatsPitcherID
StatsTotalPitches
StatsStrikes
StatsBalls
StatsPoints
StatsDirectHits
StatsNeighborHits
StatsMisses
T1_Direct
T1_Neighbor
T1_Miss
T2_Direct
T2_Neighbor
T2_Miss
T3_Direct
T3_Neighbor
T3_Miss
T4_Direct
T4_Neighbor
T4_Miss
T5_Direct
T5_Neighbor
T5_Miss
T6_Direct
T6_Neighbor
T6_Miss
T7_Direct
T7_Neighbor
T7_Miss
T8_Direct
T8_Neighbor
T8_Miss
T9_Direct
T9_Neighbor
T9_Miss
SessionStatsEmbedURL
```

## Column meanings

### Session identity / lifecycle

* `SessionID`

  * unique session identifier
  * in practice this may be UUID-like in Glide rows
  * older Apps Script session creation also used generated IDs like `S-YYYYMMDD-HHMMSS`

* `SessionStart`

  * timestamp when session begins

* `SessionEnd`

  * timestamp when session ends

* `IsActive`

  * boolean indicating active session

* `SessionName`

  * display name for session
  * often effectively the formatted date/time in the prototype

### Session configuration

* `TargetMode`

  * current targeting mode for the practice session
  * prototype currently appears to use `Manual`

* `PitchesPerPlayer`

  * expected pitch count target per pitcher for the session

* `SelectedPlayerIDs`

  * list of players selected for the session
  * legacy / Glide-specific field
  * may not need direct one-to-one storage in rebuilt app depending on final session design

### Live session state

* `CurrentPitcherID`

  * currently active pitcher for pitch entry
  * this drives who pitches are being recorded for

* `CurrentTargetZone`

  * currently selected target zone
  * used when recording each pitch result

* `StatsPitcherID`

  * currently selected pitcher for stat viewing
  * can be different from `CurrentPitcherID`
  * very important concept to preserve

### Selected pitcher stat display fields

These were written by Apps Script in the prototype for the currently selected stats pitcher:

* `StatsTotalPitches`
* `StatsStrikes`
* `StatsBalls`
* `StatsPoints`
* `StatsDirectHits`
* `StatsNeighborHits`
* `StatsMisses`

These should not necessarily remain as stored fields in the rebuilt app. They can be computed on demand from the `pitches` table.

### Heatmap per-zone stat fields

For each target zone 1 through 9, the selected pitcher’s session stats were broken into:

* direct hits
* neighbor hits
* misses

Fields:

* `T1_Direct`, `T1_Neighbor`, `T1_Miss`
* `T2_Direct`, `T2_Neighbor`, `T2_Miss`
* ...
* `T9_Direct`, `T9_Neighbor`, `T9_Miss`

These were used to drive the current heatmap UI.

### Legacy embed field

* `SessionStatsEmbedURL`

  * generated URL used by the Glide web embed
  * this should be eliminated in the rebuilt Vercel version because the heatmap should render natively in the app

## Notes

The `Sessions` tab in the legacy system carried too many responsibilities. In the rebuilt app, split these concerns more cleanly:

* session metadata
* live session UI state
* stats computed from pitches

---

# 3. Pitches

## Purpose

Stores one row per recorded pitch.

This is the most important transactional table in the prototype.

## Observed important fields from Glide data view

* `PitchID`
* `SessionID`
* `PitcherID`
* `TargetZone`
* `ActualZone`
* `IsBall`
* `Timestamp`
* `IsDeleted`
* `Points`

There are also Glide relation / lookup columns that are UI-specific and should not be treated as core schema.

## Column meanings

* `PitchID`

  * unique pitch identifier
  * generally a UUID in the prototype

* `SessionID`

  * foreign key to session

* `PitcherID`

  * foreign key to player / pitcher

* `TargetZone`

  * intended target zone at time of pitch
  * integer 1–9

* `ActualZone`

  * actual zone result if pitch was not a ball
  * integer 1–9 when applicable
  * blank for balls

* `IsBall`

  * boolean
  * `TRUE` if pitch is recorded as a ball

* `Timestamp`

  * time pitch was recorded

* `IsDeleted`

  * soft-delete flag
  * prototype scripts ignored any pitch where this was truthy

* `Points`

  * integer score for the pitch
  * scoring rules:

    * direct hit = `3`
    * neighbor hit = `1`
    * miss = `0`
    * ball = `0`

## Notes

This table should become the cleanest core source table in the rebuilt app.

The rebuilt app should preserve the business meaning of:

* target zone
* actual zone
* ball / non-ball
* points

---

# 4. SessionPitcherStats

## Purpose

Legacy rollup table storing one row per `SessionID + PitcherID` combination.

This was introduced to support faster stat display and selected-pitcher stats in the Glide prototype.

## Expected schema from legacy Apps Script

```txt
SessionID
PitcherID
TotalPitches
Strikes
Balls
Points
DirectHits
NeighborHits
Misses
T1_Direct
T1_Neighbor
T1_Miss
T2_Direct
T2_Neighbor
T2_Miss
T3_Direct
T3_Neighbor
T3_Miss
T4_Direct
T4_Neighbor
T4_Miss
T5_Direct
T5_Neighbor
T5_Miss
T6_Direct
T6_Neighbor
T6_Miss
T7_Direct
T7_Neighbor
T7_Miss
T8_Direct
T8_Neighbor
T8_Miss
T9_Direct
T9_Neighbor
T9_Miss
```

## Meaning

This table is a rollup of all non-deleted pitch rows for a given session and pitcher.

## Notes

In the rebuilt app, this table is optional.

Recommended initial approach:

* do **not** store this as a physical table initially
* compute stats from `pitches` on demand
* add a materialized summary later only if performance requires it

---

# 5. Zones

## Purpose

Reference table for the 3x3 strike-zone grid.

## Expected use

Likely used by Glide to display/select zone values 1–9.

## Migration note

In the rebuilt app, this may not need its own database table unless you want configurable zone metadata.
A static UI config in code may be enough.

---

# 6. PracticeSetup

## Purpose

Prototype support/config table used by Glide for app flow.

## Migration note

Treat as legacy support structure. Only carry over fields that map to real domain concepts.

---

# 7. TargetModeOptions

## Purpose

Reference/options table for target mode selection.

## Migration note

May remain as:

* a database lookup table
* or just an enum/config in code

If only `Manual` is currently used, start with a code enum and expand later.

---

# 8. Users

## Purpose

Glide/user access context table if present.

## Migration note

Replace with a proper application `users` table and role-based permissions in the rebuilt app.

---

# Business Logic Summary

## CurrentPitcherID vs StatsPitcherID

This distinction is important and should be preserved:

* `CurrentPitcherID`

  * the pitcher currently being used for pitch entry

* `StatsPitcherID`

  * the pitcher currently selected for viewing stats

They may be the same, but they do not have to be.

This allows a coach to:

* continue recording pitches for one pitcher
* inspect stats for another pitcher

## Points system

* direct hit = 3 points
* neighbor hit = 1 point
* miss = 0 points
* ball = 0 points

## Strike logic

* any non-ball pitch counts as a strike in the current prototype
* any ball pitch counts as a ball

## Miss logic

Misses include:

* non-ball pitches worth 0 points
* balls

## Heatmap efficiency logic

For each target zone:

* `targeted = direct + neighbor + miss`
* `earned = (direct * 3) + neighbor`
* `possible = targeted * 3`
* `efficiency percent = earned / possible * 100`

Display format:

* large centered percent
* raw slash line underneath in `direct / neighbor / miss`

---

# Recommended Mapping to New Database

## Keep as real tables

* `players`
* `sessions`
* `pitches`
* `users`

## Optional

* `session_players`
* `target_mode_options`

## Do not preserve as-is unless needed

* `SessionPitcherStats` as physical table
* `SessionStatsEmbedURL`
* Glide-specific lookup/relation/helper columns

---

# Suggested Next Documentation

This schema doc should be paired with:

* `PROJECT_BRIEF.md`
* `CURRENT_GLIDE_FLOW.md`
* legacy Apps Script files for business-rule reference
* sample data exports or example rows for `Sessions`, `Pitches`, and `Players`
