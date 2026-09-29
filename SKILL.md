---
name: postbird-campus-office
description: Use Postbird in DeepSeek Harness to turn campus email and local attachments into cited action lists, reviewable replies, collection ledgers, and Office deliverables. Trigger for campus inbox triage, deadlines, material collection, attachment questions, and office handoff.
---

# Postbird campus office workflow

Use the registered `office_*` tools in DeepSeek Harness. Run `npm run doctor` in the Postbird repository when a tool is unavailable. Ask for the mailbox or local working directory if the user has not identified the source.

## Route the request

1. For today's priorities, call `office_inbox_fetch` only when the user has authorized mailbox access and a live mailbox is configured. Then call `office_daily_brief` and `office_action_radar` on the local index.
2. For a specific thread, call `office_thread_summary` or `office_context_reply`. Retrieve full text only when the indexed snippet cannot answer the question. For a question about an attachment, call `office_attachment_ask` and retain its page, paragraph, slide, or row citation.
3. For material collection, call `office_collection_track` with the roster and required items. Surface missing or ambiguous matches for human review before drafting reminders.
4. For a deliverable, use `office_sheet`, `office_docgen`, or `office_pptx` with an explicit `workDir` and output path. Check generated files before claiming completion.
5. For any outbound mail, call `office_mail_preview` first. Show recipients, content, attachments, and batch size. Call `office_mail_send` only after the user explicitly confirms that exact preview.

## Output contract

Report the completed files, the next actions, and the source evidence. Distinguish deterministic extraction from the agent's interpretation. Never invent a deadline, sender, attachment citation, or successful send. The browser Live Demo uses simulated data; label it as a simulation.

## Boundaries

Keep inputs and outputs inside the chosen working directory. Do not put mailbox passwords or tokens in prompts or committed files. `office_inbox_fetch` is read-only; no mail is sent without the preview and confirmation workflow.

For tool names, installation, and examples, see [README.md](README.md) and [docs/GUIDE.zh-CN.md](docs/GUIDE.zh-CN.md).
