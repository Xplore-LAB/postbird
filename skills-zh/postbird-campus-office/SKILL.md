---
name: postbird-campus-office
version: 1.6.0
license: MIT
description: Postbird 信鸽在 DeepSeek Harness 里的总路由，把校园邮箱与本地附件变成带依据的行动清单、可审阅的回复草稿和真实 Office 交付物。当用户提到收件箱、邮件里的截止日期、材料收集与谁交谁没交、附件里的格式与时间要求，或要起草回复、生成 Excel / Word / PPT / EML 时加载，并据此选择 action / evidence / delivery 子技能。
whenToUse: 任务跨越邮件收件箱分诊、截止日期、材料收集核对、附件取证、回复起草或文档交付时使用。只做纯文档排版或本地文件编辑时不要加载本技能，改用 DSH 内置的 office / office-docx / office-xlsx / office-pptx 技能。
tags:
  - agent-skills
  - email
  - office
  - campus
metadata:
  project: Postbird
  role: orchestrator
  source: "postbird-agent-skills@v1.6.0"
  dsh-adapted: true
---

# Postbird 信鸽 · 总路由（DeepSeek Harness 适配版）

Postbird 是一套**确定性的本地办公工具**（22 个 `office_*` 工具），把散落在邮件正文、长线程和附件里的要求，变成可执行、可回复、可统计、可交付的成果。

本技能是**路由层**：它不自己干活，只决定该调哪几个子技能。

> 本文件是 DeepSeek Harness 适配版。工具名、行为与上游 `postbird-agent-skills@v1.6.0` 完全一致；差别只在于用中文写清触发条件、路由顺序、与 DSH 内置技能的分工，以及失败分支。

## 子技能与分工

| 子技能 | 什么时候加载 | 典型交接 |
| --- | --- | --- |
| `postbird-action` | 要决定**接下来做什么**：优先级、截止日期、谁还缺材料、待回复、催办 | 行动清单 → 交给 evidence 或 delivery |
| `postbird-evidence` | 答案要**可追溯**到原文：某线程说了什么、附件哪一页哪一行、这条结论凭什么 | 有据事实 → 交给 action 或 delivery |
| `postbird-delivery` | 事实已确定，用户明确要**可用的产物或通信**：回复、催办函、Excel / Word / PPT / EML、归档 | 草稿或文件 → 人工审阅 → 发送 |

只加载**当前任务需要的最少子技能**；复合任务可以串起两个或三个。

## 路由策略

1. **先 action** —— 当请求是「我该做什么」「什么时候到期」「谁还没交」「哪些要跟进」时。
2. **再 evidence** —— 当答案取决于具体线程、附件、条款、页码、表格行或来源时。
3. **最后 delivery** —— 只有在事实已确定、且用户明确要回复 / 催办 / Office 文件 / 导出 / 归档时才走。
4. 复合请求（例如「统计奖学金材料，提醒缺材料学生，并生成学院汇总表」）按
   `postbird-action → postbird-evidence → postbird-delivery` 串行执行。
5. **确定性抽取与模型解读必须分开**。绝不编造截止日期、发件人、附件引用、材料状态，更不能谎称「已发送」。

## 与 DSH 内置 office 技能的分工

DSH 自带 `office` / `office-docx` / `office-xlsx` / `office-pptx` / `office-render` 等技能，负责**纯文档的创建、编辑与校验**。Postbird 的 `office_*` 工具负责**从邮件和附件里长出来的内容**。

- 内容来自邮件、附件或台账 → 用 Postbird 的 `office_*` 工具。
- 内容已经确定、只是排版 / 转换 / 校验 → 用 DSH 内置 office 技能，更稳更快。
- 两者都要时：先用 Postbird 取事实，再把事实交给内置技能出文件。

## 共享安全边界

- 邮箱读取默认**只读**（IMAP PEEK，不会把邮件标记为已读），除非用户明确要求交付。
- 任何外发邮件必须先 `office_mail_preview`，展示收件人、主题、正文、附件、批量数；只有在用户**明确确认那一份预览**之后，才可调用 `office_mail_send`。
- 附件读取、归档与生成文件都限制在所选 `workDir` 内。
- 绝不把邮箱密码、API key、token 写进提示词、提交的文件或截图。
- 浏览器 Live Demo 用的是模拟数据，引用时必须标注为**模拟**。

## 上下文纪律（DeepSeek 必读）

`office_*` 工具的返回值会**整体进入模型上下文**。为避免上下文膨胀触发压缩甚至超限：

- `office_action_radar` / `office_daily_brief` 这类聚合工具，**先用小 `limit` 探路**（例如 10），不够再放大；不要一上来就拉全量。
- 单线程问题优先 `office_thread_summary`，只有摘要答不上来时才取全文。
- 附件问答优先 `office_attachment_ask`（行级引用），不要整份读入。
- 一次只调**解决问题所需**的最小工具集合，别把 22 个工具都跑一遍。
- 拿到结论后**先复述要点再收尾**，不要把整段工具原始 JSON 回吐给用户。

## 工具速查（22 个）

| 能力组 | 工具 |
| --- | --- |
| 收件与行动 | `office_inbox_fetch`、`office_inbox_triage`、`office_daily_brief`、`office_action_radar`、`office_thread_summary`、`office_action_extract` |
| 回复与发送 | `office_context_reply`、`office_reply_draft`、`office_mail_preview`、`office_mail_send` |
| 材料与附件 | `office_collection_track`、`office_attachment_ask`、`office_archive_search`、`office_archive_export`、`office_archive_attach` |
| 洞察与整理 | `office_stats_overview`、`office_stats_track`、`office_inbox_clean` |
| Office 交付 | `office_sheet`、`office_docgen`、`office_pptx`、`office_template` |

## 首次使用与排障

如果 `office_*` 工具不可用，说明 Postbird 没装进当前 profile。在 Postbird 源码目录执行：

```bash
node scripts/postbird.mjs setup --profile <profile>
node scripts/postbird.mjs doctor --profile <profile>
```

然后重启 DSH。`doctor` 会逐项检查 Node 版本、插件文件、DSH 注册与运行时依赖。

若只想要一个零配置的本地样例（不需要邮箱），执行 `node scripts/postbird.mjs demo --profile <profile>`，它会用 `example/employees.csv` 产出 Excel、Word 与 PPT。
