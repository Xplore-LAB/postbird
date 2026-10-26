---
name: postbird-evidence
version: 1.6.0
license: MIT
description: 用原始邮件线程和本地附件核验 Postbird 的结论，返回页 / 段 / 幻灯片 / 表格行级依据。当用户问「原文到底怎么写的」「这条结论凭什么」「附件里对格式和时间有什么要求」「这份草稿有没有依据」时使用；无依据的推测不要用本技能。
whenToUse: 答案必须可追溯到原始材料时使用——线程上下文、附件事实、来源引用、结论核验。发现结论需要修正时，把更正交回 postbird-action；事实已确认时交给 postbird-delivery。
tags:
  - evidence
  - attachment-reading
  - provenance
metadata:
  project: Postbird
  stage: evidence
  source: "postbird-agent-skills@v1.6.0"
  dsh-adapted: true
---

# Postbird 取证技能（DeepSeek Harness 适配版）

本技能用于**答案必须可追溯到源头**的场景。

## 工作流

1. **先明确要核验的是哪条具体结论**，再去读数据。
2. 线程上下文：调 `office_thread_summary`；只有索引摘要不足以回答时，才取全文。
3. PDF / Word / PPT / Excel / 文本附件：调 `office_attachment_ask`，并保留它的页、段落、幻灯片、行或工作表定位信息。
4. 查历史归档证据用 `office_archive_search`；**只有用户明确要求归档时**才用 `office_archive_attach`。
5. 返回结构固定为 `结论 → 依据 → 来源定位 → 置信度`。
6. 若证据推翻了原行动，把更正交给 `postbird-action`；若证据支撑了交付物，把事实交给 `postbird-delivery`。

## 取证规则

- **只引用必要的部分**；优先「简明转述 + 定位信息」，不要大段复制原文。
- 绝不伪造页码、附件名或邮件 ID。
- 来源之间冲突时，**明确报告冲突**，不要合并成一个说法。
- 确定性抽取与模型解读必须分开陈述。

## 上下文纪律

- `office_attachment_ask` 返回的是**行级引用**，优先用它；不要把整份 PDF / Word 读进上下文。
- 取全文是最后手段，且只在摘要确实答不上来时使用。
- 引用时带上定位信息（如「第 3 页」「Sheet1 第 12 行」），用户才能自己复核。

## 失败分支

- 附件读不出来：说明文件名和失败原因；**不要猜测它的内容**。
- 找不到匹配来源：明确说这条结论**未经验证**。
- 有多个候选附件：列出来，并从上下文里做安全消歧，或请用户指定。
