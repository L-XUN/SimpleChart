# simplechart

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

把**流程 / 层级 / 交互顺序 / 数据关系 / 系统分层**画成一张 PNG 图。

- 先量文字，再定框 → 文字不会溢出
- 连线走框边端口 + 回避框体 → 穿框直接判失败
- 出图后自动跑**几何 + 像素**自检 → 结果返回 PASS/FAIL，不是"看起来还行"
- 改图只改一份 JSON，重渲染幂等

支持 5 种图：

| `type` | 用来画 | 先说清什么 |
|---|---|---|
| `flowchart` | 审批流、操作步骤、判断分支 | 谁在什么条件下走到哪一步 |
| `mindmap` | 层级拆解、知识点结构 | 一个主题怎么分叉 |
| `sequence` | 调用顺序、消息传递、机制通路 | 谁先对谁说了什么 |
| `er` | 表结构、字段、一对多 | 数据怎么存、怎么连 |
| `arch` | 分层架构、模块组成、依赖 | 系统由什么组成 |

## 长什么样

**流程图**（判断双出口 + 退回回边）

![审批流示例](examples/approval-flow/approval-flow.png)

**架构图**（4 层 / 9 模块 / 8 条依赖）

![架构图示例](examples/service-arch/service-arch.png)

**时序图**（蓝光 → ipRGC → SCN → 松果体）

![时序图示例](examples/iprgc-sequence/iprgc-sequence.png)

更多见 [`examples/`](examples/)：思维导图、ER 图、20 节点压力用例，每个都带可直接运行的 `spec.json`。

## 安装

**作为 DSH skill**（推荐，`sharp`/`fontkit` 由 DSH 自带）：

```bash
git clone https://github.com/L-XUN/SimpleChart.git ~/.dsh/skills/simplechart
```

装完开新会话验证：问一句"你有哪些 skill"，或者直接打 `/simplechart 画一个三节点的流程图测试`。

> 目录层级必须是 `~/.dsh/skills/simplechart/SKILL.md`；再往下一层就扫不到了（加载器只认一层）。

**独立使用**（不接 agent，任意带 Node 的环境）：

```bash
git clone https://github.com/L-XUN/SimpleChart.git && cd SimpleChart
npm install                     # 装 sharp + fontkit
node scripts/render.mjs examples/approval-flow/spec.json out.png
```

## 用法

一份 JSON 描述图，一条命令出图：

```json
{
  "type": "flowchart",
  "title": "请假审批流程",
  "nodes": [
    { "id": "s",  "shape": "start",    "text": "提交申请",     "row": 0, "col": 0 },
    { "id": "p1", "shape": "process",  "text": "主管审批",     "row": 1, "col": 0 },
    { "id": "d1", "shape": "decision", "text": "≤ 3 天？",     "row": 2, "col": 0 },
    { "id": "e1", "shape": "end",      "text": "人事备案",     "row": 3, "col": 0 },
    { "id": "e2", "shape": "end",      "text": "驳回",         "row": 3, "col": 1 }
  ],
  "edges": [
    { "from": "s", "to": "p1" },
    { "from": "p1", "to": "d1" },
    { "from": "d1", "to": "e1", "label": "是" },
    { "from": "d1", "to": "e2", "label": "否" }
  ]
}
```

```bash
node scripts/render.mjs spec.json out.png            # 1x
node scripts/render.mjs spec.json out.png --scale 2  # 2x，用于 PPT / 打印
node scripts/check.mjs  spec.json out.png            # 只自检，不出图
```

命令会同时写出 `out.png` 和 `out.svg`，并打印自检报告：

```
simplechart 出图 · spec.json
  flowchart · 画布 391 × 505 px · 节点 5 · 连线 4 · 字体 SimHei 16
  [通过] 结构合法 — 5 节点 / 4 连线，起止与分支齐备
  [通过] 连线不穿框 — 4 条连线只在自己两端的框上落脚
  [失败] 判断必须有 2 个以上出口 — d1 只有 1 条出边
  结论：FAIL（1 项失败）
```

退出码：`0` 通过 / `1` 自检失败 / `2` 参数或依赖问题。适合直接接进 CI。

其余四种图的 `spec` 格式：`flowchart` 与 `mindmap` 见 [`SKILL.md`](SKILL.md)，`sequence` / `er` / `arch` 见 [`references/`](references/)。

## 自检在查什么

| 层 | 查的东西 |
|---|---|
| 结构 | 起止齐备、判断双出口且标条件、无孤立/断头节点、ER 基数两端、ER 主键、架构图模块在层内 |
| 几何 | 框不重叠、线不穿框、端点落在框边、文字按各自形状内切、标签不压框、线不与边框重合 |
| 像素 | 每处文字真渲染（防字体缺失）、整图不是空白 |

自检不通过时报告会直接指向违规项，不用自己找。

## 目录

```
SKILL.md              入口：类型路由表 + 通用规则 + spec 格式
references/           按类型的差异规则（sequence / er / arch）
scripts/              spec.mjs 路由 · layout-* 排版 · svg-* 绘制 · render / check
examples/             6 个可运行示例（spec.json + 成品 PNG）
docs/DESIGN.md        设计取舍、踩过的坑、已知技术债
CHANGELOG.md          更新记录
```

## 依赖与平台

- Node 18+
- `sharp`（SVG → PNG）、`fontkit`（精确量字宽）：DSH 环境自带，其他环境 `npm install`
- 中文字体：按 `SimHei → 微软雅黑 → 等线 → Noto Sans SC / PingFang` 顺序找；一个都找不到时会自动降级成估算字宽并告警 —— 此时必须回看图片确认没有豆腐块
- 已在 Windows 上完整验证；路径与字体候选对 macOS / Linux 做了回退

## 已知边界

- **网格排版**：流程图和 ER 图要自己给 `row` / `col`（ER 可用 `perRow` 自动排），不是自动图布局算法；排得不好线会绕远
- **布线是贪心的**：架构图按 `links` 顺序逐条走，换顺序可能得到不同走线
- **单层容器**：架构图不支持子层嵌套，每层一行模块（≤5 个）
- **时序图**：不支持激活条、`alt`/`loop` 组合框、消息序号；要分支请拆图或用流程图
- **一种字号**：想强调就用标题或拆图；不支持富文本、图标、图片节点
- 密图里边标签偶尔会压到别的连线（有背景色挖空，仍可读）

## 延伸阅读

[设计取舍与已知边界](docs/DESIGN.md) · [更新记录](CHANGELOG.md)

## License

MIT © 2026 L-XUN
