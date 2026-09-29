<div align="center">

<img src="assets/brand/postbird-readme-hero-v3.png" alt="Postbird 信鸽" width="920" />

### 把校园邮箱变成会行动的 AI 工作台。

*一句话整理通知、追踪截止日期、汇总材料、起草回复，并交付真实的 Word、Excel、PPT 和邮件文件。*

[![在线体验](https://img.shields.io/badge/在线体验-打开%20Live%20Demo-55e5d5?style=for-the-badge&logo=github&logoColor=071426)](https://xplore-lab.github.io/postbird/demo/)
[![校园场景](https://img.shields.io/badge/校园场景-七类身份-50a6ff?style=for-the-badge)](#campus-scenes)
[![五分钟开始](https://img.shields.io/badge/五分钟开始-安装指南-9f86ff?style=for-the-badge)](#five-minute-start)

[![GitHub stars](https://img.shields.io/github/stars/Xplore-LAB/postbird?style=flat&label=stars&color=gold)](https://github.com/Xplore-LAB/postbird/stargazers)
[![release](https://img.shields.io/badge/release-v1.5.0-1683c4)](https://github.com/Xplore-LAB/postbird/releases)
[![tests](https://img.shields.io/badge/checks-npm%20test-32b643)](tests/)
[![tools](https://img.shields.io/badge/tools-22-7e35d5)](#all-tools)
[![license](https://img.shields.io/badge/license-MIT-1683c4)](LICENSE)
[![local first](https://img.shields.io/badge/data-local--first-1683c4)](#安全可控)
[![node](https://img.shields.io/badge/node-%3E%3D%2020-32b643)](package.json)

**简体中文** · [English](README.en.md)

**黑客松材料：** [项目报告书](docs/HACKATHON.zh-CN.md) · [Agent Skill](SKILL.md) · [Demo 录制脚本](docs/DEMO-SCRIPT.zh-CN.md) · [征文初稿](docs/ESSAY-DRAFT.zh-CN.md)

</div>

---

## ⚡ 一分钟看懂 Postbird

**Postbird 是 DeepSeek Harness 的本地优先 AI 邮箱与办公助手。** 它把散落在邮件正文、长线程和附件里的要求，继续变成可以执行、回复、统计和交付的成果。

> **你只需说：** “帮我开始今天的工作。”
>
> **Postbird 会交付：** 今日简报、行动雷达、带依据的线程摘要、回复草稿、材料台账，以及 `.eml`、`.csv`、`.xlsx`、`.docx`、`.pptx` 等真实文件。

打开 [Postbird Live Demo](https://xplore-lab.github.io/postbird/demo/)，无需安装和登录，选择一种校园身份即可模拟完整工作流。

| 核心能力 | 你只需这样说 | 一分钟内看到 |
| --- | --- | --- |
| ☀️ 每日简报 | “帮我开始今天的工作” | 今天最重要的事项、截止时间、待回复邮件 |
| ◎ 行动雷达 | “找出截止事项、等待回复和需要催办的邮件” | 任务、负责人、状态、优先级和原邮件依据 |
| ↩️ 上下文回复 | “读完这个线程，帮我准备回复” | 历史承诺、附件要求和可编辑回复草稿 |
| ◫ 材料追踪 | “统计谁已提交，谁还缺材料” | 已齐、缺件、未交名单和个性化提醒预览 |
| ◉ 附件问答 | “附件里对格式和时间有什么要求” | PDF 页、Word 段落、PPT 页、Excel 行级引用 |

每个判断都能回到原邮件或附件位置。任何邮件发送都要经过预览和明确确认。

<a id="campus-scenes"></a>

## 🎓 七类校园身份，一句话进入工作状态

| 使用者 | 直接这样说 | Postbird 交付 |
| --- | --- | --- |
| 本科生 | “帮我看看这周有哪些必须完成的事情” | 作业、考试、申请和回复组成的校园行动清单 |
| 研究生 | “导师最近让我修改了什么，帮我整理并起草回复” | 论文修改计划、附件出处、汇报节点和正式回复 |
| 辅导员 | “统计奖学金材料，提醒还缺材料的学生” | 提交台账、逐人缺失项、提醒预览和 Excel 汇总 |
| 行政老师 | “整理培训报名邮件，生成名单、提醒和汇报” | 去重名单、附件索引、Word 汇报与 PPT 概览 |
| 教学老师 | “汇总课程邮箱，告诉我需要处理什么” | 作业状态、补交与请假清单、分类回复和课程归档 |
| 教授 | “只保留最近三天需要我决策的邮件” | 论文节点、合作判断、学生审批和可委派事项 |
| 学生组织 | “整理活动报名和材料，告诉我现在最需要处理什么” | 报名台账、重复与缺件名单、活动推进表和归档目录 |

### 学生工作，从收报名表走到活动交接

Postbird 可以从指定主题的邮件直接发现报名者，合并重复提交，核对报名表、作品、签字页和活动材料，再继续处理审批、场地、宣传、排班、签到、报销、总结与换届归档。

> **你只需说：** “帮我整理校园文化节的报名和活动材料，告诉我现在最需要处理什么。”
>
> **Postbird 会交付：** 有效报名与候补名单、逐人缺件、重复提交、待完成审批、个性化补件草稿、Excel 活动台账和可移交归档目录。

查看 [学生工作与学生社团完整场景地图](docs/STUDENT-WORK-SCENARIOS.zh-CN.md)。

### 一个校园通知如何完成闭环

```text
扫描模拟收件箱
        ↓
识别身份和工作目标
        ↓
生成今日简报与行动雷达
        ↓
读取完整线程和本地附件
        ↓
准备回复、材料统计与交付文件
        ↓
展示来源依据和发送预览
        ↓
由用户确认下一步
```

## ✨ 从“看邮件”继续走到“完成工作”

<div align="center">
  <img src="assets/brand/postbird-readme-banner.png" alt="Postbird 从邮件与数据生成办公文件" width="920" />
</div>

Postbird 将邮件理解、行动管理和 Office 交付放进同一个对话入口：

1. **理解收件箱：** 分诊邮件，提取截止日期、负责人、问题、承诺和决策。
2. **还原上下文：** 聚合同一线程，按需通过只读 IMAP 获取完整正文。
3. **读懂附件：** 从 PDF、Word、PPT、Excel 和文本文件中返回带出处的证据。
4. **推进沟通：** 结合完整上下文生成回复，发送前展示收件人、正文和附件。
5. **跟踪收集：** 对照名单识别已齐、缺件和未交状态，保留人工校正。
6. **形成交付：** 输出真实的邮件、表格、Word、PPT 和可移交归档目录。

## 🧭 为何更易用

| 体验设计 | 用户获得的价值 |
| --- | --- |
| 自然语言入口 | 无需记住工具名或手工拼装步骤 |
| 七类身份模板 | 打开 Demo 即可看到贴近校园工作的结果 |
| 每项结论带依据 | 可以定位原邮件、PDF 页、Word 段落、PPT 页或表格行 |
| 完整工作流交付 | 从阅读、判断和回复继续走到统计、文档与归档 |
| 配置按需出现 | 文档和浏览器 Demo 无需邮箱，连接真实邮箱时再填授权码 |
| 人在回路中 | 低置信度结果进入复核队列，发送动作需要明确确认 |

<a id="all-tools"></a>

## 🧰 22 个工具协同工作

你可以一直使用自然语言。以下工具由 Postbird 按任务自动组合。

| 能力组 | 工具 |
| --- | --- |
| 收件与行动 | `office_inbox_fetch`、`office_inbox_triage`、`office_daily_brief`、`office_action_radar`、`office_thread_summary`、`office_action_extract` |
| 回复与发送 | `office_context_reply`、`office_reply_draft`、`office_mail_preview`、`office_mail_send` |
| 材料与附件 | `office_collection_track`、`office_attachment_ask`、`office_archive_search`、`office_archive_export`、`office_archive_attach` |
| 洞察与整理 | `office_stats_overview`、`office_stats_track`、`office_inbox_clean` |
| Office 交付 | `office_sheet`、`office_docgen`、`office_pptx`、`office_template` |

<a id="five-minute-start"></a>

## 🚀 五分钟开始

### 1. 安装

```bash
git clone https://github.com/Xplore-LAB/postbird.git
cd postbird
npm run setup
```

安装器会发现 DeepSeek Harness 配置、安装依赖并注册插件。

### 2. 检查

```bash
npm run doctor
```

### 3. 直接说出目标

```text
读取这份报名表，按学院统计，生成 Excel、Word 情况汇报和一份会议 PPT。
```

也可以先运行无需邮箱的本地 Office 示例：

```bash
npm run demo
```

<details>
<summary><strong>连接真实邮箱，可选</strong></summary>

Postbird 支持 QQ、163、126、Gmail、Outlook 及标准 IMAP、SMTP 邮箱。推荐使用邮箱授权码并放入环境变量：

```bash
export DSH_IMAP_PASS="your-app-password"
export DSH_SMTP_PASS="your-app-password"
```

随后在 DeepSeek Harness 的 `tool-office` 配置中填写邮箱地址。常见服务商会自动匹配服务器，完整步骤见[中文使用指南](docs/GUIDE.zh-CN.md#邮箱接入可选)。只读收件和本地分析可以单独启用，发件能力无需同时开放。

</details>

<details>
<summary><strong>多配置与手动安装</strong></summary>

存在多个 DeepSeek Harness 配置时：

```bash
npm run setup -- --profile web
```

需要查看安装器支持的全部选项：

```bash
node scripts/postbird.mjs setup --help
```

</details>

## 🛡️ 安全可控

| 设计 | 默认行为 |
| --- | --- |
| 本地优先 | 邮件索引、材料台账、附件和生成文件留在你的电脑上 |
| 收件只读 | IMAP 使用只读邮箱锁和 `BODY.PEEK`，不会把邮件标记为已读 |
| 正文最小留存 | 本地索引保存短摘要，完整正文按需读取并仅在当前内存中处理 |
| 路径隔离 | 附件读取、归档和生成文件都限制在指定工作目录内 |
| 发送确认 | 先生成预览，明确确认后才进入发送阶段 |
| 人工校正 | 材料状态与低置信度判断可以复核，确认结果会被保留 |
| 凭据隔离 | 授权码从环境变量读取，不进入代码仓库 |

详细威胁模型和边界见[安全策略](SECURITY.md)。

工具输出会进入当前 DeepSeek Harness Agent 上下文。处理敏感邮件前，请确认所选运行时与模型符合你的数据要求。

## 🌱 我们的愿景

让每个人现有的邮箱和本地文件，直接获得一层可信、可控、可交付的 AI 办公能力。

面向个人，Postbird 帮你找回注意力，把时间留给判断与创造。面向团队，它把材料收集、群发、归档、交接和批量制表沉淀为可复核、可重复执行的工作流。

## 📚 继续探索

| 文档 | 内容 |
| --- | --- |
| [中文使用指南](docs/GUIDE.zh-CN.md) | 安装、邮箱接入、22 个工具与排障 |
| [English Guide](docs/GUIDE.en.md) | Complete English setup, tool reference, and troubleshooting |
| [产品介绍](docs/PRODUCT-INTRO.zh-CN.md) | 产品定位、校园价值与能力边界 |
| [邮件场景](docs/MAIL-SCENARIOS.zh-CN.md) | 七类校园身份与典型工作流 |
| [学生工作场景](docs/STUDENT-WORK-SCENARIOS.zh-CN.md) | 招新、报名、活动材料、审批、签到、报销、年审与换届交接 |
| [竞品分析](docs/COMPETITORS.zh-CN.md) | 市场定位与差异化 |
| [推广策略](docs/STRATEGY.zh-CN.md) | 对外传播与增长策略 |

## 🙏 致谢

Postbird 的实现受益于 DeepSeek Harness 生态，以及 [Nodemailer](https://nodemailer.com/)、[ImapFlow](https://imapflow.com/)、[MailParser](https://nodemailer.com/extras/mailparser/)、[PDF.js](https://mozilla.github.io/pdf.js/)、[docx](https://docx.js.org/)、[PptxGenJS](https://gitbrent.github.io/PptxGenJS/) 和 [ExcelJS](https://github.com/exceljs/exceljs) 等优秀开源项目。

如果 Postbird 帮你节省了时间，欢迎点亮 ⭐，也欢迎提交 [Issue](https://github.com/Xplore-LAB/postbird/issues) 或 Pull Request。

## 📄 许可证

[MIT](LICENSE)
