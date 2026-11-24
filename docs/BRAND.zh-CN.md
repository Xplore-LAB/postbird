# Postbird 品牌与命名规范

本文档记录 Postbird 的四层身份、命名撞车排查结果，以及对外使用时的写法规范。改动品牌相关文案前先读它。

## 一、四层身份

| 层级 | 值 | 能否改动 | 说明 |
| --- | --- | --- | --- |
| 产品名 | Postbird 信鸽 | 可 | README 与产品界面可直接使用 Postbird |
| 仓库名 | `Xplore-LAB/postbird` | 已定 | 2026-09-05 由 `dsh-plugin-office` 改名而来 |
| 运行时包名 | `dsh-postbird` | 已定 | 2026-11-24 为接入 DSH 插件注册表改名；`cordis.patch.yml` 的 `name` 必须与之逐字一致 |
| npm 包名 | `dsh-postbird`（尚未发布） | 已定 | 与运行时包名统一；npm 实测为空名，不使用裸名 `postbird` |

## 二、撞车排查（2026-09-06）

| 已有名称 | 主体 | 是什么 | 冲突程度 | 处置 |
| --- | --- | --- | --- | --- |
| Mailbird | Contenga International | Windows / macOS 桌面邮件客户端，2012 年起，官网称 440 万用户，统一收件箱 + 30 余款应用集成 | 高 | 命名结构接近，视觉和产品表达保持独立 |
| Postbird（postbird.be） | Mailstreet，比利时 Hasselt | 实体信件打印装封投递 SaaS，带 API | 中 | 名称相同，产品边界保持在 AI 电子邮件与办公工作流 |
| `postbird`（npm） | 未占用 | 空 | 低 | 2026-11-24 复核仍为空；按硬规则不使用裸名，定名 `dsh-postbird` |

Mailbird 运营十余年且为商业产品，第 9 类与第 42 类商标大概率已注册；本结论未在 USPTO 或 EUIPO 做正式检索，属推断。若未来商业化或发行 npm 包，先做正式商标检索再定。

## 三、硬规则

1. **对外名称简洁。** README、仓库和产品界面直接使用 Postbird，说明文字中交代它服务于 DeepSeek Harness。
2. **账号带项目后缀。** 社交与发布账号优先使用 `postbird-dsh` 或 `@xplore-lab/postbird`，便于识别项目来源。
3. **视觉保持独立。** 品牌色与 Logo 走信鸽插画路线，保持原创的镜面信鸽和蓝青色视觉语言。
4. **聚焦电子办公。** 产品边界保持在电子邮件、校园行动与 Office 文件工作流。

## 四、写法规范

| 场景 | 写法 |
| --- | --- |
| 英文正文 | `Postbird`，首字母大写，其余小写，单字连写 |
| 中文正文 | `Postbird 信鸽` 或 `Postbird for DSH` |
| 错误写法 | `PostBird`（会被读成两个单词）、`postbird` 作句首、`Post Bird` |
| 命令行与包名 | 包名固定 `dsh-postbird`；`postbird` 仅出现在仓库名、目录名与 git clone 地址里 |

## 五、首屏写法

> Postbird 信鸽
>
> 把校园邮箱变成会行动的 AI 工作台。
