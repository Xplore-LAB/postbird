---
name: postbird-evidence
version: 1.0.0
license: MIT
description: Verify a Postbird conclusion against original email threads and local attachments, returning page/paragraph/slide/row-level evidence. Use when the user asks what a source says, why an action exists, or whether a draft is supported. Do not use for unsupported speculation.
tags:
  - evidence
  - attachment-reading
  - provenance
metadata:
  project: Postbird
  stage: evidence
---

# Postbird Evidence Skill

Use this skill when an answer must be **traceable to source material**.

## Workflow

1. Identify the exact claim to verify before reading more data.
2. For thread context, call `office_thread_summary`; retrieve full text only when the indexed snippet is insufficient.
3. For PDF/Word/PPT/Excel/text attachments, call `office_attachment_ask` and retain its page, paragraph, slide, row, or sheet locator.
4. Use `office_archive_search` for previously archived evidence and `office_archive_attach` only when the user asks to add material to an archive.
5. Return `claim → evidence → source locator → confidence`.
6. If evidence changes the action, hand the correction to `postbird-action`; if it validates a deliverable, hand the facts to `postbird-delivery`.

## Evidence rules

- Quote only what is needed; prefer a concise paraphrase plus locator.
- Never fabricate page numbers, attachment names, or message IDs.
- If sources conflict, report the conflict explicitly instead of merging them.
- Separate deterministic extraction from model interpretation.

## Failure branches

- Attachment unreadable: name the file and failure; do not infer its contents.
- No matching source: say the claim is unverified.
- Multiple candidate attachments: list them and request/derive a safe disambiguation from context.
