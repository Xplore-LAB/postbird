# Postbird English Guide

## Ordinary email in DSH

Preview one email with `office_mail_preview({to: "person@example.com", subject: "Meeting", body: "See you tomorrow at 3 PM."})`. Add `attachments` and an explicit `workDir` when needed. Show the sender, recipient, complete body and attachment list before requesting confirmation. After the user approves that preview, call `office_mail_send` with the returned `previewId`, `mode: "send"`, and `confirm: true`. The default mode writes EML drafts without sending. Report each recipient's SMTP acceptance or error; do not claim receipt or reading. For partial failure, prepare and confirm a new preview only for remaining recipients. Successful previews cannot be replayed.

[Back to README](../README.en.md) · [中文指南](GUIDE.zh-CN.md)

This guide covers installer options, optional mailbox access, all 22 tools, configuration, storage, and troubleshooting. For a first run, you only need the “Install and Verify” section.

## Install and Verify

### Requirements

- Node.js 20 or later
- DeepSeek Harness installed and launched at least once
- macOS, Linux, or Windows

### Automatic Setup

```bash
git clone https://github.com/Xplore-LAB/postbird.git
cd postbird
npm run setup
```

When one DeepSeek Harness profile exists, the installer selects it automatically. Select a profile explicitly when several are present:

```bash
npm run setup -- --profile web
```

The installer copies the plugin, installs runtime dependencies, registers `tool-office`, and backs up an existing `cordis.patch.yml` before changing it.

Preview the setup without writing files:

```bash
npm run setup -- --profile web --dry-run
```

Install files without changing `cordis.patch.yml`:

```bash
npm run setup -- --profile web --no-register
```

### One-command Doctor

```bash
npm run doctor -- --profile web
```

The doctor checks Node.js, plugin files, dependencies, DSH registration, local office tools, optional inbox access, and optional outbound delivery.

### Skill Catalog

The installer ships Postbird's own skills along with the plugin. After a DSH
restart the model can use these four Chinese skills directly:

| Skill | Purpose |
| --- | --- |
| `postbird-campus-office` | Campus entry point for choosing a workflow and its tools |
| `postbird-action` | Extracting to-dos, deadlines and evidence from mail |
| `postbird-delivery` | Drafting and delivering replies and bulk sends, preview first |
| `postbird-evidence` | Reading Office / PDF attachments with citations |

The plugin registers them at startup through `ctx.skills.registerProvider()`.
They come from the plugin's own `skills-zh/` directory, so nothing has to be
hand-copied into `~/.dsh/skills/`. The English originals stay in `skills/`
and the Chinese set wins on a name clash.
### Mailbox-free Demo

```bash
npm run demo -- --profile web
```

The demo reads `example/employees.csv` and creates a department workbook, six personalized Word files, and a PowerPoint summary in a new output folder.

Choose the output folder:

```bash
npm run demo -- --profile web --output ./my-postbird-demo
```

## Optional Mailbox Setup

Documents, presentations, spreadsheets, email drafts, local search, and analytics work without mailbox credentials. Add an account only when you need live inbox or delivery workflows.

Add account fields to the Postbird block in `~/.dsh/profiles/<profile>/cordis.patch.yml`:

```yaml
- insert:
    - id: tool-office
      name: '@local/dsh-plugin-office'
      config:
        imapUser: 'me@example.com'
        smtpUser: 'me@example.com'
        fromAddress: 'me@example.com'
```

Provide credentials through environment variables:

```bash
export DSH_IMAP_PASS='your app password'
export DSH_SMTP_PASS='your app password'
```

Restart DeepSeek Harness and run the doctor again.

### Provider Presets

| Provider | IMAP | SMTP | Suggested ports |
| --- | --- | --- | --- |
| QQ / Foxmail | `imap.qq.com` | `smtp.qq.com` | IMAP 993, SMTP 465 |
| 163 | `imap.163.com` | `smtp.163.com` | IMAP 993, SMTP 465 |
| 126 | `imap.126.com` | `smtp.126.com` | IMAP 993, SMTP 465 |
| Gmail | `imap.gmail.com` | `smtp.gmail.com` | IMAP 993, SMTP 465 |
| Outlook / Hotmail / Live | `outlook.office365.com` | `smtp.office365.com` | IMAP 993, SMTP 587 |

Use authorization codes for QQ, 163, and 126, and an app password for Gmail. Set `smtpSecure: false` when using Outlook on port 587. Custom providers require explicit `imapHost` and `smtpHost` values.

## Tasks You Can Run Directly

```text
Fetch my 30 newest messages and put the ones requiring a reply first.

Find recruiting messages with PDF attachments from the last month.

Archive this project's messages into handover/ with originals and an index.

Scan recruiting mail, update my application tracker, and export CSV.

Create personalized invitations from recipients.csv and preview them first.

Summarize employees.csv by department and create an Excel workbook.

Create one Word notice per row and a five-slide management presentation.
```

## All 22 Tools

The AI selects and combines these tools automatically. Their names document the available capability surface.

| Tool | Capability | Guardrail |
| --- | --- | --- |
| `office_mail_preview` | Validate recipients and render personalized mail | Domain allowlist, recipient cap, immutable preview ID |
| `office_mail_send` | Write `.eml` drafts or deliver through SMTP | Preview ID and explicit confirmation required |
| `office_inbox_fetch` | Fetch recent metadata and snippets | Read-only IMAP and PEEK body fetches |
| `office_inbox_triage` | Classify action items, notices, subscriptions, and personal mail | Evidence per classification and review queue |
| `office_daily_brief` | Build today's inbox action brief | Focus items, due states, review queue, and safety note |
| `office_action_radar` | Extract and rank actions from email | Action type, deadline, priority, and source evidence |
| `office_context_reply` | Prepare a reply from local thread context | Thread history, action signals, and three editable drafts |
| `office_thread_summary` | Summarize participants, commitments, questions, decisions, and attachments | Local snippets by default, optional read-only full text, citations on every signal |
| `office_action_extract` | Extract actions from a message, thread, or pasted notice | Deadline, priority, source, and responsibility signals |
| `office_reply_draft` | Create one selected-tone grounded reply | Review-only output; preview and explicit confirmation still gate sending |
| `office_collection_track` | Check a known roster or discover open-registration participants from a scoped mail subject | Missing items, repeat and unmatched submissions, source evidence, human corrections, CSV or XLSX export |
| `office_attachment_ask` | Read PDF, Word, PowerPoint, Excel, and text attachments | Work-directory confinement and page, paragraph, slide, or row citations |
| `office_archive_search` | Search by sender, subject, date, attachment, and category | Local index only |
| `office_archive_export` | Export original `.eml` files and `index.csv` | Read-only retrieval and message cap |
| `office_archive_attach` | Collect attachments from matched mail | Deduplicated names, extension filter, size cap |
| `office_stats_overview` | Summarize trends, contacts, and categories | Local index only |
| `office_stats_track` | Build a job application ledger | Forward-only automatic progress with manual correction |
| `office_inbox_clean` | Find high-volume subscriptions and unsubscribe links | Advice only, no delete or unsubscribe action |
| `office_docgen` | Generate one or many `.docx` files | Missing placeholders fail clearly, no silent overwrite |
| `office_pptx` | Generate one or many `.pptx` files | Output remains inside the working directory |
| `office_template` | Fill an existing Word template | Safe replacement across split text runs |
| `office_sheet` | Inspect, filter, aggregate, and split tabular data | Row cap and CSV or XLSX output |

## Full Configuration

Every field has a default. Add only the options you need.

```yaml
config:
  # Outbound mail
  smtpHost: ''
  smtpPort: 465
  smtpSecure: true
  smtpUser: ''
  smtpPassEnv: DSH_SMTP_PASS
  fromAddress: ''
  fromName: ''
  replyTo: ''
  maxRecipients: 50
  sendIntervalMs: 1500
  dailySendCap: 200
  allowDomains: []
  previewTtlMinutes: 60

  # Documents and spreadsheets
  maxDocRows: 100
  maxSheetRows: 20000

  # Inbox and archive
  imapHost: ''
  imapPort: 993
  imapUser: ''
  imapPassEnv: DSH_IMAP_PASS
  imapMailbox: INBOX
  maxInboxFetch: 200
  inboxSnippetChars: 300
  maxArchiveMessages: 200
  maxAttachmentMb: 25
  maxThreadMessages: 50
  maxThreadCharsPerMessage: 12000
  maxAttachmentReadMb: 50
```

An empty `allowDomains` accepts every valid domain. A list such as `['example.com', 'edu.cn']` blocks every other recipient domain during preview.

`previewTtlMinutes` limits how long a preview can be sent. Generate a fresh preview after expiration so the final recipients and content remain current.

## Data Storage

The default data directory is:

```text
~/.dsh/office/mail/
├── index.jsonl
├── sent-log.jsonl
├── job-track.json
├── collections/<id>.json
├── previews/
└── drafts/<id>/
```

- The index contains message metadata, bounded snippets, attachment names, and classification evidence.
- Full message text is fetched on demand over read-only IMAP and kept in memory. It is written only through an explicit `.eml` export.
- `collections/` stores material-tracking ledgers, mail citations, and human corrections.
- The send log is append-only.
- Set `DSH_OFFICE_HOME` to relocate all runtime data for testing or project isolation.

## Update and Uninstall

Update the checkout and rerun setup. Existing configuration remains in place.

```bash
git pull
npm run setup -- --profile web
```

To uninstall, remove the `tool-office` block from `cordis.patch.yml`, then remove the profile's `node_modules/@local/dsh-plugin-office` directory. Delete `~/.dsh/office/mail` only when you also want to erase local indexes, previews, drafts, and trackers.

## Troubleshooting

### Setup reports multiple profiles

Run `npm run setup -- --profile <name>`. Profile names are available under `~/.dsh/profiles/`.

### Local tools pass while mail is not ready

This is a valid partial setup. Add `imapUser` and `DSH_IMAP_PASS` for inbox access. Add `smtpUser`, `fromAddress`, and `DSH_SMTP_PASS` for live delivery.

### The mailbox connection fails

Check that IMAP and SMTP access are enabled by the provider, the app password is current, and host and port values match. Organization accounts may require administrator approval.

### Messages remain unread

That is expected. Postbird uses a read-only connection and PEEK body fetches, preserving server-side read state.

### Sending has two stages

The preview freezes recipients, subject, body, and attachments. Delivery validates its ID, expiration, and confirmation field to reduce bulk-send mistakes.

### An output file already exists

Postbird blocks silent overwrites. Choose a new output name or deliberately move the previous file before retrying.

## Development and Tests

```bash
npm install --legacy-peer-deps
npm test
```

The suite covers tool registration, office file generation, template replacement, mail preview and delivery guardrails, inbox triage, archives, analytics, job tracking, cleanup advice, installer idempotency, and dry-run behavior.
