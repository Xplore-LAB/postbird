# Postbird 中文使用指南

[返回 README](../README.md) · [English Guide](GUIDE.en.md)

这份指南收录安装选项、邮箱接入、完整配置、22 个工具和常见问题。首次体验只需阅读“安装与验证”。

## 安装与验证

### 环境要求

- Node.js 20 或更高版本
- 已安装并至少启动过一次 DeepSeek Harness
- macOS、Linux 或 Windows 环境

### 自动安装

```bash
git clone https://github.com/Xplore-LAB/postbird.git
cd postbird
npm run setup
```

只有一个 DeepSeek Harness profile 时，安装器会自动选择。存在多个 profile 时指定名称：

```bash
npm run setup -- --profile web
```

安装器会完成以下操作：

1. 把插件文件复制到选定 profile 的 `node_modules/@local/dsh-plugin-office`。
2. 安装运行依赖。
3. 在 `cordis.patch.yml` 中注册 `tool-office`。
4. 修改已有配置前创建带时间戳的备份。

可先查看计划，不写入任何文件：

```bash
npm run setup -- --profile web --dry-run
```

只安装文件，不修改 `cordis.patch.yml`：

```bash
npm run setup -- --profile web --no-register
```

### 一键自检

```bash
npm run doctor -- --profile web
```

自检分别报告：

- Node.js、插件文件、依赖和 DSH 注册状态
- Word、PPT、表格、本地检索和草稿能力
- 可选的实时收件能力
- 可选的实时发件能力

### 技能目录

安装器会把插件自带的技能一并装进 DSH。重启 DSH 后，模型能直接用这 4 个中文技能：

| 技能 | 用途 |
| --- | --- |
| `postbird-campus-office` | 校园场景总入口，帮你选工作流和工具 |
| `postbird-action` | 从邮件提取待办、截止时间与证据 |
| `postbird-delivery` | 起草与投递回复、群发，走预览—确认流程 |
| `postbird-evidence` | 读 Office / PDF 附件并标注来源 |

技能由插件在启动时通过 `ctx.skills.registerProvider()` 注册，来源在插件目录的 `skills-zh/`，不依赖手工往 `~/.dsh/skills/` 里拷文件。英文原版在 `skills/`，同名时以中文版为准。
### 零邮箱演示

```bash
npm run demo -- --profile web
```

演示会读取仓库中的 `example/employees.csv`，并在新目录中生成：

- `department-summary.xlsx`
- 6 份个性化 Word 通知
- `demo-summary.pptx`

指定输出目录：

```bash
npm run demo -- --profile web --output ./my-postbird-demo
```

## 邮箱接入，可选

文档、PPT、表格、邮件草稿、本地检索和统计无需邮箱凭据。需要读取或发送真实邮件时再完成本节。

在 `~/.dsh/profiles/<profile>/cordis.patch.yml` 的 Postbird 配置中增加邮箱账号：

```yaml
- insert:
    - id: tool-office
      name: '@local/dsh-plugin-office'
      config:
        imapUser: 'me@qq.com'
        smtpUser: 'me@qq.com'
        fromAddress: 'me@qq.com'
```

凭据通过环境变量提供：

```bash
export DSH_IMAP_PASS='邮箱授权码'
export DSH_SMTP_PASS='邮箱授权码'
```

重启 DeepSeek Harness 后运行自检：

```bash
npm run doctor -- --profile web
```

### 常用邮箱预设

Postbird 会根据邮箱后缀自动识别服务器。

| 邮箱 | IMAP | SMTP | 端口建议 |
| --- | --- | --- | --- |
| QQ / Foxmail | `imap.qq.com` | `smtp.qq.com` | IMAP 993，SMTP 465 |
| 163 | `imap.163.com` | `smtp.163.com` | IMAP 993，SMTP 465 |
| 126 | `imap.126.com` | `smtp.126.com` | IMAP 993，SMTP 465 |
| Gmail | `imap.gmail.com` | `smtp.gmail.com` | IMAP 993，SMTP 465 |
| Outlook / Hotmail / Live | `outlook.office365.com` | `smtp.office365.com` | IMAP 993，SMTP 587 |

QQ、163、126 通常使用邮箱后台生成的授权码。Gmail 通常使用应用专用密码。Outlook 使用 587 端口时配置 `smtpSecure: false`。

自定义邮箱需要显式填写 `imapHost` 和 `smtpHost`。

## 直接可用的任务

安装完成后可以直接向 DeepSeek Harness 描述结果。

### 邮件与收件箱

```text
拉取最近 30 封邮件，把真正需要我回复的放在最前面。

找出最近一个月带 PDF 附件的招聘邮件，列出公司和主题。

把这个项目的邮件导出到 handover/，保留原始邮件和索引。

统计这个月的常用联系人、邮件趋势和订阅来源。

扫描求职邮件，更新申请台账，并导出 CSV。

读完导师关于论文修改的完整线程，列出要求和历史承诺。

对照学生名单统计奖学金材料，标出缺件和未交人员。

阅读附件中的要求，并注明 PDF 页码或 Word 段落位置。
```

### 群发与草稿

```text
按 recipients.csv 生成个性化邀请邮件，称呼使用 name 列，先给我预览。

把预览保存成 .eml 草稿，我稍后自己发送。

确认发送刚才的预览，并返回逐封投递结果。
```

### 文档、PPT 与表格

```text
看看 employees.csv 有哪些列和数据类型。

按部门汇总 salary 和 bonus，输出 department-summary.xlsx。

按 employees.csv 每行生成一份 Word 通知，文件名包含 name。

把汇总结果做成一份五页以内的管理层汇报 PPT。

用 contract.docx 作为模板，按 clients.csv 批量填充合同。
```

## 22 个工具

AI 会自动选择并组合这些工具。表格用于说明能力边界，日常使用无需记忆工具名。

| 工具 | 能力 | 关键保护 |
| --- | --- | --- |
| `office_mail_preview` | 校验名单并渲染个性化邮件 | 域名白名单、收件人数上限、返回预览 ID |
| `office_mail_send` | 写出 `.eml` 草稿或通过 SMTP 投递 | 必须提供预览 ID 和明确确认 |
| `office_inbox_fetch` | 拉取最新邮件的元数据与摘要 | 只读 IMAP，正文使用 PEEK |
| `office_inbox_triage` | 分为待办、通知、订阅和私信 | 每条提供分类依据，保留待复核项 |
| `office_daily_brief` | 生成今日邮件行动简报 | 重点事项、到期状态、待复核项和安全说明 |
| `office_action_radar` | 提取并排序邮件中的行动 | 行动类型、截止时间、优先级和原邮件依据 |
| `office_context_reply` | 读取本地线程上下文并准备回复 | 线程脉络、行动信号和三种可编辑草稿 |
| `office_thread_summary` | 汇总线程中的参与者、承诺、问题、决策和附件 | 默认使用本地摘要，可选只读获取完整正文，每项带邮件引用 |
| `office_action_extract` | 从邮件线程或粘贴文本中提取行动 | 返回截止时间、优先级、来源和责任线索 |
| `office_reply_draft` | 生成一种指定语气的上下文回复 | 只生成待审草稿，仍需预览和明确确认才能发送 |
| `office_collection_track` | 按已有名单核验材料，或按指定主题发现开放报名者 | 标记缺件、重复提交和名单外来件，保存来源证据与人工校正，可导出 CSV 或 XLSX |
| `office_attachment_ask` | 阅读 PDF、Word、PPT、Excel 与文本附件 | 文件限制在工作目录，返回页、段落、幻灯片或表格行引用 |
| `office_archive_search` | 按发件人、主题、日期、附件和分类检索 | 只读本地索引 |
| `office_archive_export` | 导出原始 `.eml` 和 `index.csv` | 只读重新获取，限制数量 |
| `office_archive_attach` | 批量收取匹配邮件的附件 | 文件名去重、类型筛选、大小上限 |
| `office_stats_overview` | 统计趋势、联系人与分类构成 | 只读取本地索引 |
| `office_stats_track` | 构建求职申请台账 | 状态自动向前推进，支持人工修正 |
| `office_inbox_clean` | 识别高频订阅与退订链接 | 仅给建议，不执行删除或退订 |
| `office_docgen` | 单份或按行批量生成 `.docx` | 缺少占位符时明确报错，避免静默覆盖 |
| `office_pptx` | 生成单份或批量 `.pptx` | 输出锁定在工作目录 |
| `office_template` | 填充现有 Word 模板 | 支持跨 run 占位符替换 |
| `office_sheet` | 查看、筛选、汇总、拆分表格 | 行数上限，输出 CSV 或 XLSX |

## 完整配置

所有字段均有默认值。只需填写希望启用或调整的项目。

```yaml
config:
  # 发件
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

  # 文档与表格
  maxDocRows: 100
  maxSheetRows: 20000

  # 收件与归档
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

`allowDomains` 为空时允许所有有效域名。填写 `['edu.cn', 'example.com']` 后，其他域名会在预览阶段被拦截。

`previewTtlMinutes` 控制预览有效期。超时后需要重新生成，避免内容或名单变化后误发。

## 数据存储

默认数据目录：

```text
~/.dsh/office/mail/
├── index.jsonl
├── sent-log.jsonl
├── job-track.json
├── collections/<id>.json
├── previews/
└── drafts/<id>/
```

- `index.jsonl` 保存邮件元数据、有限长度摘要、附件名和分类依据。
- 邮件全文按需通过只读 IMAP 获取，仅在当前内存中使用；只有明确导出 `.eml` 时才写入工作目录。
- `collections/` 保存材料收集台账、邮件引用与人工校正。
- `sent-log.jsonl` 为追加式发送记录。
- 可通过 `DSH_OFFICE_HOME` 更改整个数据目录，便于测试或隔离项目。

## 更新与卸载

更新代码后再次执行安装命令即可覆盖插件文件并保留配置：

```bash
git pull
npm run setup -- --profile web
```

卸载步骤：

1. 从 `cordis.patch.yml` 移除 `tool-office` 配置块。
2. 删除 profile 下的 `node_modules/@local/dsh-plugin-office` 目录。
3. 如需清理运行数据，再删除 `~/.dsh/office/mail`。

删除运行数据会清除本地索引、预览、草稿和台账，请先备份需要保留的文件。

## 常见问题

### 安装器提示存在多个 profile

使用 `npm run setup -- --profile <名称>` 明确选择。可在 `~/.dsh/profiles/` 查看已有名称。

### 文档工具可用，邮箱工具显示未就绪

这是正常的分层状态。添加 `imapUser` 与 `DSH_IMAP_PASS` 后启用收件，添加 `smtpUser`、`fromAddress` 与 `DSH_SMTP_PASS` 后启用发件。

### 邮箱连接失败

依次检查邮箱后台是否启用 IMAP / SMTP、授权码是否有效、服务器和端口是否匹配，并重新运行 `doctor`。企业或学校邮箱可能需要管理员开启协议权限。

### 邮件为什么没有被标记为已读

Postbird 的收件能力使用只读连接和 PEEK 拉取，保持服务器端邮件状态不变。

### 为什么发送需要两步

预览阶段固定收件人、主题、正文和附件。发送阶段校验预览 ID、有效期与确认字段，帮助降低批量误发风险。

### 输出文件已经存在

Postbird 会阻止静默覆盖。请更换输出名称或明确整理旧文件后重试。

## 开发与测试

```bash
npm install --legacy-peer-deps
npm test
```

测试覆盖 22 个工具的注册与核心行为、文档和附件引用、材料追踪、邮件预览与发送护栏、收件分类、归档、统计、安装器幂等性，以及浏览器 Demo。
