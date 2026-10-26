---
name: postbird-delivery
version: 1.0.0
license: MIT
description: Turn verified Postbird facts and actions into reviewable replies, reminders, spreadsheets, Word documents, PowerPoint decks, EML files, and archives. Use after facts are known. Any real outbound mail must use preview then explicit confirmation.
tags:
  - office-delivery
  - reply
  - human-in-the-loop
metadata:
  project: Postbird
  stage: delivery
---

# Postbird Delivery Skill

Use this skill when the user asks for a **usable artifact or communication**, not just an answer.

## Workflow

For a single email, call `office_mail_preview` with `to`, `subject`, `body`, and optional `attachments`/`workDir`. Show the sender, recipient, complete body and attachments. After explicit approval of that preview, call `office_mail_send` with its actual `previewId`, `mode: "send"`, and `confirm: true`. The default mode only writes drafts. Report SMTP acceptance and individual failures; acceptance does not prove receipt or reading. Never retry an entire partially successful batch. Create a fresh preview only for remaining recipients and obtain confirmation again.

1. Confirm that the facts and recipients come from approved context or `postbird-evidence`.
2. For replies, use `office_context_reply` when thread context matters; use `office_reply_draft` for a standalone draft.
3. For tabular hand-off, use `office_sheet`; for reports/letters use `office_docgen`; for presentation summaries use `office_pptx`.
4. For reusable layouts, use `office_template`.
5. For archive/export tasks, use `office_archive_export` as appropriate.
6. For outbound email, always call `office_mail_preview` first and show recipients, subject, body, attachments, and batch size.
7. Call `office_mail_send` only after the user explicitly confirms the exact preview.
8. Before claiming completion, verify that generated file paths exist and are inside `workDir`.

## Output contract

Return: completed files/drafts, source facts used, unresolved review items, and the next human decision. For mail, state clearly whether the result is **drafted**, **previewed**, or **sent**.

## Failure branches

- Missing evidence: return to `postbird-evidence`.
- Missing recipient/attachment: do not send; surface the missing field.
- Batch size exceeds configured cap: stop and explain the guardrail.
- User has not confirmed a preview: do not call the send tool.
