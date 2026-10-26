---
name: postbird-action
version: 1.6.0
license: MIT
description: 把 Postbird 的收件箱状态变成带依据的优先级行动清单。当用户问「今天先做什么」「哪些到期了」「谁还没交材料」「哪些邮件等我回复」「要不要催办」时使用；事实已经确定、只想要一份文件时不要用本技能。
whenToUse: 需要判断「接下来必须做什么」时使用——优先级、截止日期、责任人、待回复、催办、材料收集状态。事实尚未取证时先交给 postbird-evidence，再回到本技能。
tags:
  - email-triage
  - action-management
  - collection
metadata:
  project: Postbird
  stage: action
  source: "postbird-agent-skills@v1.6.0"
  dsh-adapted: true
---

# Postbird 行动技能（DeepSeek Harness 适配版）

本技能用于回答**接下来必须发生什么**。

## 工作流

1. 若用户已授权并配置好实时邮箱，先调 `office_inbox_fetch`；否则使用已有的本地索引或演示数据。
2. 要今日视图：先 `office_daily_brief`，再 `office_action_radar`。
3. 针对某个具体线程：先 `office_thread_summary`，再抽取任务。
4. 用 `office_action_extract` 把事实转成行动、责任人、截止日期、状态与依据。
5. 名册 / 材料类任务：用 `office_collection_track`；**有歧义的匹配一律留在待复核，不要默默替你猜**。
6. 需要核实来源的事实，交给 `postbird-evidence`。
7. 已批准、且需要回复 / 催办 / 表格 / 汇报 / 幻灯片的，交给 `postbird-delivery`。

## 输出契约

返回一张**紧凑的行动表**，字段为：`priority`、`action`、`owner`、`deadline`、`status`、`evidence`，必要时附 `confidence` / `review`。

必须区分**原文里写明的日期**和**模型推断出的紧急度**——两者不能混为一谈。

## 上下文纪律

- `office_action_radar` 默认拉取量不小。**先用小 `limit`（如 10）探路**，不够再放大。
- `sinceHours` 默认覆盖较长时间窗，任务范围明确时主动收窄，避免把无关历史带进上下文。
- 行动表由你**重述成紧凑表格**再交付，不要把工具返回的原始 JSON 直接贴给用户。

## 失败分支

- 没有邮箱也没有索引：向用户要数据源，或用本地演示；**不要凭空编造收件箱状态**。
- 截止日期冲突：把两个来源都摆出来，转 `postbird-evidence` 核验。
- 名册匹配有歧义：标记 `needs_review`；**不要自动给那个人发提醒**。
- 请求里包含发送动作：止步于 `postbird-delivery` 的交接，并要求预览 + 确认。
