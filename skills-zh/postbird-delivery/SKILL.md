---
name: postbird-delivery
version: 1.6.0
license: MIT
description: 把已核验的事实和行动做成可审阅的回复、催办函、Excel、Word、PPT、EML 与归档。当事实已经确定、用户要的是能直接用的产物或通信时使用；任何真实外发邮件必须先预览再明确确认。
whenToUse: 需要产出可用的文件或通信、而不只是一个答案时使用——回复草稿、催办通知、表格、报告、演示、归档导出。事实还不确定时先回 postbird-evidence 取证。
tags:
  - office-delivery
  - reply
  - human-in-the-loop
metadata:
  project: Postbird
  stage: delivery
  source: "postbird-agent-skills@v1.6.0"
  dsh-adapted: true
---

# Postbird 交付技能（DeepSeek Harness 适配版）

本技能用于**产出可用的产物或通信**，而不只是给一个答案。

## 与 DSH 内置 office 技能的分工

- 内容来自邮件 / 附件 / 台账 → 用 Postbird 的 `office_sheet` / `office_docgen` / `office_pptx`。
- 内容已经确定、只是排版 / 转换 / 公式刷新 / 渲染校验 → 优先用 DSH 内置的 `office-docx` / `office-xlsx` / `office-pptx` / `office-recalculate` / `office-render` 技能，它们对产物校验更严格。
- 需要可复用的版式模板 → `office_template`。

## 工作流

### 在 DSH 发一封普通邮件

1. 使用 `office_mail_preview({to: "person@example.com", subject: "主题", body: "正文"})`；有附件时增加 `attachments` 和明确的 `workDir`。不必为单封邮件创建 CSV。
2. 把工具返回的发件人、收件人、主题、完整正文和附件展示给用户，明确“尚未发送”，保留 `previewId`。正文、地址或附件变更后重新预览。
3. 用户明确确认这份预览后，调用 `office_mail_send({previewId: "实际预览ID", mode: "send", confirm: true})`。务必指定 `mode: "send"`；默认模式只保存 EML 草稿。
4. 按逐封回执说明成功和失败原因。“SMTP 已接受”不代表对方已收件或已读。部分失败不要重发整个批次；核对结果后，仅为未发送对象重新预览并确认。
5. 缺少 SMTP 配置时说明缺失项；不要向用户索取授权码放进聊天，也不要把草稿报告为发送成功。

### 其他交付

1. 先确认事实与收件人来自已批准上下文或 `postbird-evidence`。
2. 回复类：需要线程上下文用 `office_context_reply`；独立草稿用 `office_reply_draft`。
3. 表格交接用 `office_sheet`；报告 / 公文用 `office_docgen`；演示概览用 `office_pptx`。
4. 可复用版式用 `office_template`。
5. 归档 / 导出任务按需用 `office_archive_export`。
6. 外发邮件**永远先调 `office_mail_preview`**，并展示收件人、主题、正文、附件与批量数。
7. 只有用户**明确确认那一份预览**之后，才调 `office_mail_send`。
8. 宣布完成前，**核对生成的文件确实存在、且在 `workDir` 之内**。

## 输出契约

返回四件东西：已完成的文件 / 草稿、用到的事实、待复核的未决项、下一步需要人做的决定。

邮件类结果必须明确标注状态是 **drafted（已起草）**、**previewed（已预览）** 还是 **sent（已发送）**——三者在用户眼里完全不同，不能含糊。

## 上下文纪律

- 生成文件本身**不占模型上下文**，但要用的**数据**会。数据量大时用 `office_sheet` 的聚合能力先算好，别把整张明细表读进上下文再手算。
- 交付时只报**文件路径 + 关键结论**，不要把文件内容整段回吐。
- 批量发送前先确认批量数上限（插件有护栏），超限要停下说明。

## 失败分支

- 缺证据：回到 `postbird-evidence`。
- 缺收件人或附件：**不要发送**，把缺失字段摆出来。
- 批量数超过配置上限：停下并解释这条护栏。
- 用户尚未确认预览：**不要调用发送工具**。
