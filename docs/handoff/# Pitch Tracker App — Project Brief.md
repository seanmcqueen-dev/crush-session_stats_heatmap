# Pitch Tracker App — Project Brief

## Overview

We are rebuilding a working prototype of a youth baseball pitching practice tracker that currently exists in **Glide + Google Sheets + Apps Script + a separate GitHub Pages heatmap embed**. The current prototype works, but it is too slow and too dependent on Google Sheets synchronization, Apps Script refresh timing, and a web embed.

The new goal is to move the app to a proper web stack on **Vercel with Neon/Postgres as the source of truth**, while preserving the current user experience and visual style as closely as possible.

## Product Summary

This app is used to run a pitching practice session. A coach starts a session, selects a pitcher, selects a target zone, records each pitch result, and then views pitcher-specific stats and a 3x3 target efficiency heatmap. The app should feel fast, immediate, and mobile-first.

The current Glide app has these basic flows:

1. **Start Practice**
   A session is created with a timestamp and active status.

2. **Practice Detail Screen**
   A coach can:

   * choose the current pitcher
   * choose the target zone
   * record pitch outcomes
   * switch to another pitcher
   * review session stats for the selected pitcher

3. **Player Stats Screen**
   We will eventually want historical player-level stats across many sessions, not just the current session.

The app is intended to be simple enough to use during live practice on a phone.

## Current Prototype Behavior to Preserve

The rebuilt app should preserve these concepts and behaviors:

* Session-based workflow
* Multiple pitchers within a single session
* One selected pitcher at a time for viewing stats
* One selected target zone at a time when recording pitches
* 3x3 zone grid for pitch result entry
* Separate Ball button
* Points scoring system:

  * direct hit = 3
  * neighbor hit = 1
  * miss = 0
  * ball = 0 and counted separately
* Pitcher-specific session stats:

  * total pitches
  * strikes
  * balls
  * points
  * direct hits
  * neighbor hits
  * misses
* Heatmap by target zone showing efficiency and raw slash line
* Strong mobile-first design
* The rebuilt app should visually resemble the current Glide UI as closely as possible

## Current Heatmap / Embed Repo

The current session stats heatmap is hosted separately and should be used as the reference for styling and logic when rebuilding the stats screen directly in the Vercel app.

* GitHub repo: `seanmcqueen-dev/crush-session_stats_heatmap`
* Current deployed base URL: `https://seanmcqueen-dev.github.io/crush-session_stats_heatmap/`

That repo currently contains the session summary / heatmap UI and should be treated as the visual and logic reference for the new in-app stats component.

## Recommended Tech Stack

Use:

* **Next.js** (App Router)
* **TypeScript**
* **Vercel** for hosting and preview deployments
* **Neon Postgres** as the primary database
* **Drizzle ORM**
* **Tailwind CSS**
* **shadcn/ui** for base components where useful
* **Simple role-based auth** to start, with room to grow later

## Recommended Architecture

Do not carry forward the Glide + Google Sheets + Apps Script architecture. Rebuild this as a normal transactional web app.

### Source of Truth

Neon/Postgres should be the only source of truth.

### Stats Strategy

Do not start with precomputed rollup tables unless necessary. For this app’s scale, compute stats on demand from the `pitches` table for a given session and pitcher. That keeps the system simple and removes sync problems.

Later, if performance becomes an issue, add cached rollups or materialized summaries.

### Frontend Behavior

The stats screen and heatmap should render directly in the Next.js app. Do not use a web embed in the rebuilt version.

## Roles and Permissions

We want role behavior similar to Glide if possible, but implemented in the app.

### Admin

Can:

* manage players
* manage sessions
* view all sessions
* edit/delete pitches if needed
* view all stats
* manage user roles

### Coach

Can:

* start a session
* select pitcher
* select target zone
* record pitches
* view session stats
* view player historical stats
* end a session

### Viewer

Can:

* view stats and completed sessions
* no write access

Optional later:

### Parent / Athlete

Can:

* log in and view only their own player stats/history

Recommended implementation: store a `role` on the user record with values like:

* `admin`
* `coach`
* `viewer`
* optional `player_parent`

## UI / Visual Design Direction

The app should look very close to the current Glide app.

### Design Goals

* mobile-first
* dark mode by default
* strong maroon / burgundy header accent like the current app
* compact cards
* rounded corners
* soft borders
* subtle depth / shadow
* clear tap targets for pitch entry
* minimal clutter

### Color Palette

```txt
Background:        #111214
Background Top:    #131519
Panel:             #1A1C20
Panel 2:           #20232A
Border:            #2D3138
Primary Text:      #F1F3F5
Muted Text:        #A7ADB7
Muted Text 2:      #7D8591

Header / Accent Maroon:
Deep Maroon:       #5A001F
Glide-like Maroon: #680326
Highlight Pink:    #D75569

Heat colors:
Heat 0:            #1B1D21
Heat 1:            #2A2023
Heat 2:            #452228
Heat 3:            #61232D
Heat 4:            #7A1F2B
Heat 5:            #9A2A39
Heat 6:            #B9384A
Heat 7:            #D75569
Heat 8:            #EE7C8F
```

### Typography

Use **Inter** or a clean system stack.

### Component Style

* rounded containers: 16px to 24px
* compact metric cards
* dark segmented buttons
* maroon header bar
* soft white text on dark background
* very light borders
* no bright saturated blues

## Core Screens to Build

### 1. Practice Sessions List

Shows sessions, active and completed.

### 2. Start Practice

Create a new session.

### 3. Session Detail / Live Practice Screen

This is the main operational screen.

Must include:

* session header
* selected/current pitcher dropdown
* target zone selector
* pitch entry buttons
* live pitch count
* current selected pitcher stats
* heatmap

### 4. Player Stats Screen

View per-player stats.

Initially:

* session-level stats
* totals
* strike rate
* points
* direct / neighbor / miss counts

Later:

* historical charts
* session history list
* trends over time

### 5. Admin / Setup

Manage players and user access.

## Recommended Database Model

### users

* id
* email
* name
* role
* created_at
* updated_at

### players

* id
* player_code like `P-01`
* first_name
* last_name
* jersey_number
* is_active
* created_at
* updated_at

### sessions

* id
* session_name nullable
* started_at
* ended_at nullable
* is_active
* target_mode
* pitches_per_player nullable
* current_pitcher_id nullable
* current_target_zone nullable
* selected_stats_pitcher_id nullable
* created_by_user_id nullable
* created_at
* updated_at

### session_players

Optional if needed early; otherwise skip at first.

* id
* session_id
* player_id
* is_active
* created_at

### pitches

* id
* session_id
* pitcher_id
* target_zone
* actual_zone nullable
* is_ball boolean
* points integer
* created_at
* created_by_user_id nullable
* deleted_at nullable

## Stats Logic

For a selected pitcher in a selected session:

* total pitches = count of pitches
* strikes = count where `is_ball = false`
* balls = count where `is_ball = true`
* points = sum(points)
* direct hits = count where `points = 3`
* neighbor hits = count where `points = 1`
* misses = count where `points = 0`, including balls and non-ball misses

For target-zone heatmap, for each target zone 1–9:

* direct = count of pitches for that target zone with 3 points
* neighbor = count of pitches for that target zone with 1 point
* miss = count of pitches for that target zone with 0 points
* efficiency percent = `(direct*3 + neighbor) / (targeted_count*3) * 100`

Display:

* large percentage centered
* slash line under it in `direct / neighbor / miss` format

## Performance Expectations

This version should feel instant compared to Glide.

Targets:

* selecting a pitcher updates stats immediately
* recording a pitch updates stats immediately
* no manual refresh button in the final Vercel version
* no background Sheets sync
* no Apps Script dependency
* no embedded heatmap iframe

## Repo Direction

Create a new repo for the Vercel app.

Recommended name:

* `crush-pitch-tracker`

Use the current heatmap repo as a styling and logic reference only:

* `seanmcqueen-dev/crush-session_stats_heatmap`

Do not keep the heatmap as a separate deploy in the final product. Move that UI into the app.

## Environment Notes

Assume the current Windows-based development flow already being used in the Field Scheduling project:

* development from Windows terminal / local machine
* VS Code
* GitHub repo-based workflow
* Vercel project connection through GitHub
* Neon database connection
* preference for direct, step-by-step implementation
* preference for preserving visual behavior from the existing Glide prototype

Neon project name:

* `pitch-tracker-app`

## Implementation Phases

### Phase 1 — Foundation

* create Next.js app
* configure Tailwind
* configure dark theme tokens
* connect Neon
* add schema with Drizzle
* seed a few players
* create basic session creation

### Phase 2 — Live Practice Screen

* session detail page
* pitcher selector
* target zone selector
* pitch entry actions
* live stats query
* live heatmap

### Phase 3 — Player Stats

* player detail page
* session history
* aggregate stats

### Phase 4 — Auth and Roles

* add role-based protection
* admin vs coach vs viewer views

### Phase 5 — Polish

* make UI match Glide as closely as possible
* improve transitions
* improve mobile spacing and touch targets

## Specific Instruction to Builder

Build the app to visually and behaviorally mirror the existing Glide prototype as closely as possible, especially:

* dark theme
* maroon header treatment
* compact metric cards
* mobile-first layout
* 3x3 pitch result buttons
* heatmap styling and logic from the existing GitHub Pages session stats repo

Where possible, preserve naming conventions from the Glide/Sheets version so the mental model stays the same:

* Session
* Pitcher
* CurrentPitcherID
* CurrentTargetZone
* StatsPitcherID
* TargetZone
* ActualZone
* IsBall
* Points

Do not overcomplicate the first version. Prioritize:

* speed
* correctness
* mobile usability
* same look and feel as Glide
