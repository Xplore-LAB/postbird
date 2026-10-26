---
name: postbird-action
version: 1.0.0
license: MIT
description: Turn campus inbox state into prioritized, evidence-linked actions. Use for deadlines, today's priorities, missing materials, owners, waiting-for-reply items, reminders, and collection status. Do not use for pure document generation when the facts are already known.
tags:
  - email-triage
  - action-management
  - collection
metadata:
  project: Postbird
  stage: action
---

# Postbird Action Skill

Use this skill when the user needs to decide **what must happen next**.

## Workflow

1. If live mailbox access is authorized and configured, call `office_inbox_fetch`; otherwise use the existing local index or demo data.
2. For a daily view, call `office_daily_brief` and then `office_action_radar`.
3. For a specific thread, use `office_thread_summary` before extracting tasks.
4. Use `office_action_extract` to convert facts into action, owner, deadline, status, and evidence.
5. For roster/material tasks, call `office_collection_track`; keep ambiguous matches in review rather than silently guessing.
6. Hand facts that require source verification to `postbird-evidence`.
7. Hand approved actions that require a reply, reminder, spreadsheet, report, or deck to `postbird-delivery`.

## Output contract

Return a compact action table with: `priority`, `action`, `owner`, `deadline`, `status`, `evidence`, and `confidence/review` when relevant. Distinguish exact extracted dates from inferred urgency.

## Failure branches

- No mailbox/index: ask for a source or use the local demo; do not invent inbox state.
- Conflicting deadlines: surface both sources and route to evidence review.
- Ambiguous roster match: mark `needs_review`; do not auto-remind that person.
- Request includes sending: stop after hand-off to delivery and require preview + confirmation.
