<div align="center">

<img src="assets/brand/postbird-readme-hero-v3.png" alt="Postbird" width="920" />

### Turn the campus inbox into an AI workspace that takes action.

*Organize notices, track deadlines, collect materials, draft replies, and deliver real Word, Excel, PowerPoint, and email files from one request.*

[![Live Demo](https://img.shields.io/badge/Live%20Demo-Try%20Postbird-55e5d5?style=for-the-badge&logo=github&logoColor=071426)](https://xplore-lab.github.io/postbird/demo/)
[![Campus Roles](https://img.shields.io/badge/Campus%20Roles-Seven%20Experiences-50a6ff?style=for-the-badge)](#seven-campus-roles)
[![Quick Start](https://img.shields.io/badge/Quick%20Start-Five%20Minutes-9f86ff?style=for-the-badge)](#five-minute-start)

[![GitHub stars](https://img.shields.io/github/stars/Xplore-LAB/postbird?style=flat&label=stars&color=gold)](https://github.com/Xplore-LAB/postbird/stargazers)
[![release](https://img.shields.io/badge/release-v1.8.0-1683c4)](https://github.com/Xplore-LAB/postbird/releases)
[![tests](https://img.shields.io/badge/checks-npm%20test-32b643)](tests/)
[![tools](https://img.shields.io/badge/tools-22-7e35d5)](#22-tools-working-together)
[![license](https://img.shields.io/badge/license-MIT-1683c4)](LICENSE)
[![local first](https://img.shields.io/badge/data-local--first-1683c4)](#safe-by-default)
[![node](https://img.shields.io/badge/node-%3E%3D%2020-32b643)](package.json)

[简体中文](README.md) · **English**

</div>

---

## ⚡ Understand Postbird in One Minute

For ordinary email in DSH, ask to preview a message with its recipient, subject and body. The plugin supports `to`, `subject`, `body` and optional attachments without a recipient spreadsheet. After explicit confirmation, `office_mail_send` with `mode: "send"` submits it over SMTP; its default draft mode only saves EML files. Native tool results include the complete preview and per-recipient outcomes. SMTP acceptance does not prove receipt or reading.

**Postbird is a local-first AI inbox and office assistant for DeepSeek Harness.** It turns requirements scattered across messages, long threads, and attachments into actions, replies, trackers, and finished deliverables.

> **You say:** “Help me start today.”
>
> **Postbird delivers:** A daily brief, action radar, cited thread summary, reply drafts, collection tracker, and real `.eml`, `.csv`, `.xlsx`, `.docx`, and `.pptx` files.

Open the [Postbird Live Demo](https://xplore-lab.github.io/postbird/demo/), choose a campus role, and experience the full workflow without installing or signing in.

| Core experience | Say this | See this in one minute |
| --- | --- | --- |
| Daily Brief | “Help me start today” | Priorities, deadlines, and replies that need attention |
| Action Radar | “Find every deadline, follow-up, and overdue request” | Ranked actions with owners, states, and source evidence |
| Context Reply | “Read this thread and prepare my reply” | Previous commitments, attachment requirements, and editable drafts |
| Collection Tracker | “Show who submitted and what is missing” | Complete, partial, and pending rosters with reminder previews |
| Attachment Q&A | “What format and deadline does the attachment require?” | Cited PDF pages, Word paragraphs, slides, and spreadsheet rows |

Every conclusion links back to its source. Outbound email always requires a preview and explicit confirmation.

## Seven Campus Roles

| Role | Say this | Postbird delivers |
| --- | --- | --- |
| Undergraduate | “What must I complete this week?” | A campus action list spanning coursework, exams, applications, and replies |
| Graduate student | “What did my advisor ask me to revise? Draft a reply.” | Revision plan, attachment citations, meeting date, and grounded reply |
| Counselor | “Track scholarship materials and remind students with missing items.” | Submission tracker, missing items, reminder previews, and Excel export |
| Administrator | “Organize training registrations and create a report.” | Deduplicated roster, attachment index, Word report, and presentation |
| Instructor | “Summarize student email for this course.” | Assignment status, late requests, leave requests, replies, and archive |
| Professor | “Keep only messages that need my decision.” | Research milestones, collaboration decisions, approvals, and delegated work |
| Student organizer | “Organize activity registrations and materials, then show what needs attention.” | Registration tracker, duplicates, missing items, activity progress, and handover archive |

### Student activities, from registration to handover

Postbird can discover applicants from mail matching an activity subject, merge repeat submissions, check forms and supporting files, and continue through approvals, venue preparation, publicity, shifts, attendance, reimbursement, reporting, and annual handover.

See the detailed [Student Work and Organization Scenario Map](docs/STUDENT-WORK-SCENARIOS.zh-CN.md) in Chinese.

```text
Scan inbox
    ↓
Identify role and goal
    ↓
Build the brief and action radar
    ↓
Read threads and local attachments
    ↓
Prepare replies, trackers, and deliverables
    ↓
Show evidence and outbound preview
    ↓
Wait for the user's decision
```

## ✨ From Reading Email to Finishing Work

<div align="center">
  <img src="assets/brand/postbird-readme-banner.png" alt="Postbird turns email and data into office deliverables" width="920" />
</div>

1. **Understand the inbox:** Classify messages and extract deadlines, owners, questions, commitments, and decisions.
2. **Recover context:** Group a whole thread and optionally fetch full text over read-only IMAP.
3. **Read attachments:** Retrieve cited evidence from PDF, Word, PowerPoint, Excel, and text files.
4. **Move communication forward:** Draft a grounded reply and show recipients, body, and attachments before sending.
5. **Track collection work:** Compare a roster with incoming mail, preserve human corrections, and export results.
6. **Deliver real work:** Produce standard email, spreadsheet, Word, PowerPoint, and archive files.

## Why It Feels Simple

| Experience | Benefit |
| --- | --- |
| Natural-language entry | No tool names or manual orchestration to memorize |
| Seven role-based demos | Visitors immediately see a workflow that resembles their own work |
| Evidence on every result | Open the source message, PDF page, Word paragraph, slide, or sheet row |
| End-to-end delivery | Continue from reading and deciding to reports, documents, and archives |
| Configuration on demand | Demo and local documents work first; mailbox credentials come later |
| Human review | Low-confidence results are surfaced and every send requires confirmation |

## 22 Tools Working Together

| Capability | Tools |
| --- | --- |
| Inbox and actions | `office_inbox_fetch`, `office_inbox_triage`, `office_daily_brief`, `office_action_radar`, `office_thread_summary`, `office_action_extract` |
| Replies and sending | `office_context_reply`, `office_reply_draft`, `office_mail_preview`, `office_mail_send` |
| Materials and attachments | `office_collection_track`, `office_attachment_ask`, `office_archive_search`, `office_archive_export`, `office_archive_attach` |
| Insights and organization | `office_stats_overview`, `office_stats_track`, `office_inbox_clean` |
| Office deliverables | `office_sheet`, `office_docgen`, `office_pptx`, `office_template` |

You can keep using natural language. Postbird composes these tools for each task.

## Five-Minute Start

```bash
git clone https://github.com/Xplore-LAB/postbird.git
cd postbird
npm run setup
npm run doctor
```

Restart DeepSeek Harness and describe an outcome:

```text
Read this registration sheet, summarize it by department,
and create an Excel workbook, a Word report, and a presentation.
```

Try the local Office workflow without a mailbox:

```bash
npm run demo
```

<details>
<summary><strong>Connect a real mailbox, optional</strong></summary>

Postbird supports QQ Mail, 163, 126, Gmail, Outlook, and standard IMAP and SMTP services. Store app passwords in environment variables:

```bash
export DSH_IMAP_PASS="your-app-password"
export DSH_SMTP_PASS="your-app-password"
```

Then provide the mailbox address in the DeepSeek Harness `tool-office` configuration. Common services use built-in server presets. See the [English guide](docs/GUIDE.en.md#optional-mailbox-setup) for full instructions. Read-only inbox workflows and outbound delivery can be enabled independently.

</details>

## 🧠 Skills Ship With the Plugin

Installing Postbird installs more than the 22 tools: it also installs the
**working method** that goes with them. Four Chinese skills appear in DSH's
skill catalog, telling the model when to reach for which tool and how to use it:

| Skill | When it applies |
| --- | --- |
| `postbird-campus-office` | Campus entry point: which workflow to run, which tools to call |
| `postbird-action` | Extracting to-dos and deadlines from mail, each with source evidence |
| `postbird-delivery` | Drafting replies, bulk sends and delivery, with preview-then-confirm |
| `postbird-evidence` | Reading Word / PPT / Excel / PDF attachments with citations |

The skill files live in `skills-zh/` (the DSH-adapted Chinese set); `skills/`
keeps the original English ones, and `skills-zh/` wins on a name clash. The
plugin registers them through `ctx.skills.registerProvider()`, so **the tools
and their instructions ship in the same version and cannot drift apart**.

Restart DSH after upgrading to pick up new skills.
## Safe by Default

| Design | Default behavior |
| --- | --- |
| Local first | Indexes, trackers, attachments, and generated files stay on your computer |
| Read-only inbox | IMAP uses a read-only lock and `BODY.PEEK`, preserving unread state |
| Minimal body retention | The index stores snippets; full text is fetched on demand and kept only in memory |
| Path confinement | Attachment reads, exports, and generated files stay inside the chosen work directory |
| Confirm before send | Postbird previews first and sends only after explicit confirmation |
| Human correction | Collection status and low-confidence decisions remain reviewable |
| Isolated credentials | App passwords come from environment variables and stay out of the repository |

See the [security policy](SECURITY.md) for the threat model and detailed boundaries.

Tool output enters the active DeepSeek Harness agent context. Before processing sensitive mail, confirm that your selected runtime and model meet your data requirements.

## Vision

Give every existing mailbox and local file collection a trustworthy, controllable, and deliverable AI office layer. Postbird helps individuals recover attention and helps teams turn collection, mail merge, archiving, handover, and reporting into reviewable workflows.

## Explore More

| Document | What it covers |
| --- | --- |
| [中文使用指南](docs/GUIDE.zh-CN.md) | Chinese setup, tool reference, and troubleshooting |
| [English Guide](docs/GUIDE.en.md) | Setup, mailbox access, all 22 tools, and troubleshooting |
| [Product Introduction](docs/PRODUCT-INTRO.zh-CN.md) | Product direction and capability boundaries in Chinese |
| [Mail Scenarios](docs/MAIL-SCENARIOS.zh-CN.md) | Seven campus roles and workflow examples in Chinese |
| [Student Work Scenarios](docs/STUDENT-WORK-SCENARIOS.zh-CN.md) | Recruitment, registrations, activity materials, approvals, attendance, reimbursement, annual review, and handover |
| [Competitive Analysis](docs/COMPETITORS.zh-CN.md) | Market positioning and differentiation in Chinese |
| [Promotion Strategy](docs/STRATEGY.zh-CN.md) | Public messaging and growth strategy in Chinese |

## Acknowledgements

Postbird is built on the DeepSeek Harness ecosystem and excellent open-source projects including [Nodemailer](https://nodemailer.com/), [ImapFlow](https://imapflow.com/), [MailParser](https://nodemailer.com/extras/mailparser/), [PDF.js](https://mozilla.github.io/pdf.js/), [docx](https://docx.js.org/), [PptxGenJS](https://gitbrent.github.io/pptxgenjs/), and [ExcelJS](https://github.com/exceljs/exceljs).

If Postbird saves you time, consider giving the project a ⭐. Issues and pull requests are welcome.

## License

[MIT](LICENSE)
