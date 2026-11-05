/**
 * check.mjs — simplechart 自检
 *
 * 它检查的是"画出来的东西"是否违反 SKILL.md 里的硬规则：
 *   结构（图的语义对不对）→ 几何（框/线/字会不会打架）→ 像素（字到底有没有画上去）
 *
 * 用法：
 *   node check.mjs spec.json            # 只做几何检查
 *   node check.mjs spec.json out.png    # 顺带做像素检查（需要有 PNG）
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULTS, parseHex, requireOptional } from "./layout.mjs";
import { buildLayout } from "./spec.mjs";

const TOL = 1.5;

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------
function inflate(box, d) {
  return { x: box.x - d, y: box.y - d, w: box.w + d * 2, h: box.h + d * 2 };
}

function inside(box, p) {
  return p.x >= box.x - TOL && p.x <= box.x + box.w + TOL && p.y >= box.y - TOL && p.y <= box.y + box.h + TOL;
}

function onBorder(box, p) {
  const inX = p.x >= box.x - TOL && p.x <= box.x + box.w + TOL;
  const inY = p.y >= box.y - TOL && p.y <= box.y + box.h + TOL;
  if (!inX || !inY) return false;
  const dLeft = Math.abs(p.x - box.x);
  const dRight = Math.abs(p.x - (box.x + box.w));
  const dTop = Math.abs(p.y - box.y);
  const dBottom = Math.abs(p.y - (box.y + box.h));
  return Math.min(dLeft, dRight, dTop, dBottom) <= TOL;
}

/** 把折线/贝塞尔按固定步长采样成点序列。 */
function samplePoints(edge, step = 2) {
  const pts = [];
  const p = edge.points;
  if (edge.kind === "curve") {
    const [a, b, c, d] = p;
    const total = Math.hypot(d.x - a.x, d.y - a.y) + Math.hypot(b.x - a.x, b.y - a.y) * 0.5;
    const n = Math.max(24, Math.ceil(total / step));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const mt = 1 - t;
      pts.push({
        x: mt * mt * mt * a.x + 3 * mt * mt * t * b.x + 3 * mt * t * t * c.x + t * t * t * d.x,
        y: mt * mt * mt * a.y + 3 * mt * mt * t * b.y + 3 * mt * t * t * c.y + t * t * t * d.y,
        t,
      });
    }
    return { pts, closed: false };
  }
  for (let i = 0; i < p.length - 1; i++) {
    const a = p[i];
    const b = p[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 0; k < n; k++) {
      pts.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
    }
  }
  pts.push({ x: p[p.length - 1].x, y: p[p.length - 1].y });
  return { pts, closed: false };
}

// ---------------------------------------------------------------------------
// 文字是否真的装在框里（每种形状用各自的几何，不是简单内缩）
// ---------------------------------------------------------------------------
function textFit(node, theme) {
  const { padXMin, padYMin } = DEFAULTS;
  const halfW = node.textW / 2;
  const halfH = node.textH / 2;
  const shape = node.shape;
  const problems = [];

  if (node.textH > node.h - padYMin * 2 + 0.01) {
    problems.push(`文字高度 ${node.textH.toFixed(1)}px 超过框高 ${node.h}px（需留 ${padYMin}px 上下留白）`);
  }

  if (shape === "decision") {
    const a = node.w / 2 - 2;
    const b = node.h / 2 - 2;
    const ratio = halfW / a + halfH / b;
    if (ratio > 1) problems.push(`文字超出菱形斜边（占满度 ${(ratio * 100).toFixed(0)}%，需 ≤100%）`);
    return problems;
  }

  if (shape === "start" || shape === "end") {
    const rx = node.h / 2;
    const midHalf = node.w / 2 - rx;
    const room = midHalf + Math.sqrt(Math.max(0, rx * rx - halfH * halfH));
    if (halfW > room - padXMin) {
      problems.push(`文字被胶囊两端圆弧切到（可用半宽 ${room.toFixed(1)}px，需要 ${(halfW + padXMin).toFixed(1)}px）`);
    }
    return problems;
  }

  if (shape === "io") {
    const slant = DEFAULTS.slant;
    const room = (node.w - slant) / 2;
    if (halfW > room - padXMin) {
      problems.push(`文字被平行四边形斜边切到（可用半宽 ${room.toFixed(1)}px，需要 ${(halfW + padXMin).toFixed(1)}px）`);
    }
    return problems;
  }

  // 矩形 / 圆角矩形 / 子流程：普通留白
  if (halfW > node.w / 2 - padXMin) {
    problems.push(`文字宽度 ${node.textW.toFixed(1)}px 超过框宽 ${node.w}px（需留 ${padXMin}px 左右留白）`);
  }
  return problems;
}

// ---------------------------------------------------------------------------
// 主检查
// ---------------------------------------------------------------------------
export function runChecks(spec, layout) {
  const items = [];
  const add = (level, label, detail) => items.push({ level, label, detail });
  const theme = layout.theme;
  const nodes = layout.nodes;
  const edges = layout.edges;
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // ---- 1. 内容 ----
  const unitNodes = layout.type === "sequence" ? "参与者" : layout.type === "er" ? "实体" : layout.type === "arch" ? "模块" : "节点";
  const emptyText = nodes.filter((n) => !String(n.text ?? "").trim());
  if (emptyText.length) add("FAIL", "标签不能为空", `这些${unitNodes}没写文字：${emptyText.map((n) => n.id).join(", ")}`);
  else add("PASS", "标签完整", `${nodes.length} 个${unitNodes}都有文字`);

  const tooManyLines = nodes.filter((n) => (n.lines ?? []).length > DEFAULTS.maxLines);
  if (tooManyLines.length) {
    add("WARN", "单框文字过多", `建议拆成多个${unitNodes}：${tooManyLines.map((n) => `${n.id}(${n.lines.length} 行)`).join(", ")}`);
  }

  // ---- 2. 结构 ----
  const structStart = items.length;
  if (layout.type === "flowchart") {
    const malformed = edges.filter((e) => e.from === e.to);
    if (malformed.length) add("FAIL", "不能自连", `这些边首尾相同：${malformed.map((e) => e.from).join(", ")}`);

    const dup = new Map();
    for (const e of edges) {
      const k = `${e.from}->${e.to}`;
      dup.set(k, (dup.get(k) ?? 0) + 1);
    }
    const dupList = [...dup.entries()].filter(([, c]) => c > 1).map(([k]) => k);
    if (dupList.length) add("FAIL", "不能有重复边", dupList.join(", "));

    const inDeg = new Map(nodes.map((n) => [n.id, 0]));
    const outDeg = new Map(nodes.map((n) => [n.id, 0]));
    for (const e of edges) {
      inDeg.set(e.to, inDeg.get(e.to) + 1);
      outDeg.set(e.from, outDeg.get(e.from) + 1);
    }
    layout._degrees = { inDeg, outDeg };

    const starts = nodes.filter((n) => n.shape === "start");
    const ends = nodes.filter((n) => n.shape === "end");

    if (starts.length !== 1) add("FAIL", "必须有且只有 1 个开始", `现在有 ${starts.length} 个（shape=start）`);
    else {
      const s = starts[0];
      if (outDeg.get(s.id) === 0) add("FAIL", "开始节点是孤立的", `${s.id} 没有任何出边`);
      if (inDeg.get(s.id) > 0) add("FAIL", "开始节点不能有入边", `${s.id} 有 ${inDeg.get(s.id)} 条入边`);
    }

    if (ends.length === 0) add("FAIL", "至少要有 1 个结束节点", "用 shape=end 标记");
    for (const e of ends) {
      if (outDeg.get(e.id) > 0) add("FAIL", "结束节点不能有出边", `${e.id} 有 ${outDeg.get(e.id)} 条出边`);
    }

    const decisions = nodes.filter((n) => n.shape === "decision");
    for (const d of decisions) {
      if (outDeg.get(d.id) < 2) add("FAIL", "判断必须有 2 个以上出口", `${d.id} 只有 ${outDeg.get(d.id)} 条出边`);
      const unlabeled = edges.filter((e) => e.from === d.id && !e.label);
      if (unlabeled.length) {
        add("FAIL", "判断的出口必须标条件", `${d.id} → ${unlabeled.map((e) => e.to).join(" / ")} 缺少 label（如 是/否）`);
      }
    }

    const orphans = nodes.filter((n) => n.shape !== "start" && inDeg.get(n.id) === 0);
    if (orphans.length) add("FAIL", "节点必须可达", `这些节点没有入边：${orphans.map((n) => n.id).join(", ")}`);
    const deadEnds = nodes.filter((n) => n.shape !== "end" && outDeg.get(n.id) === 0);
    if (deadEnds.length) add("FAIL", "非结束节点必须有出边", `这些节点没有出边：${deadEnds.map((n) => n.id).join(", ")}`);

    if (!edges.length) add("FAIL", "没有任何连线", "流程图至少要连一条线");
    if (!items.slice(structStart).some((i) => i.level === "FAIL")) {
      add("PASS", "结构合法", `${nodes.length} 节点 / ${edges.length} 连线，起止与分支齐备`);
    }
  } else if (layout.type === "sequence") {
    // 时序图：参与者 + 消息序列（没有折线边，检查项完全不同）
    const seq = layout.sequence;
    const msgs = seq.messages;
    if (nodes.length < 2) add("FAIL", "至少要有 2 个参与者", `现在 ${nodes.length} 个`);

    const touched = new Set();
    for (const m of msgs) {
      touched.add(m.from);
      touched.add(m.to);
    }
    const idle = nodes.filter((n) => !touched.has(n.id));
    if (idle.length) add("WARN", "有参与者没发过消息", `这些只出现在图例里：${idle.map((n) => n.id).join(", ")}`);

    const unlabeled = msgs.filter((m) => !m.label);
    if (unlabeled.length) {
      add("FAIL", "消息必须写内容", `第 ${unlabeled.map((m) => m.index + 1).join(", ")} 条消息没有 label（时序图的箭头本身就是"发生了什么"）`);
    }

    const dup = new Map();
    for (const m of msgs) {
      const k = `${m.from}->${m.to}:${m.label}`;
      dup.set(k, (dup.get(k) ?? 0) + 1);
    }
    const dupList = [...dup.entries()].filter(([, c]) => c > 1).map(([k]) => k);
    if (dupList.length) add("WARN", "疑似重复消息", dupList.join("；"));

    const lonely = msgs.filter((m) => m.from === m.to && m.style !== "self");
    if (lonely.length) add("FAIL", "自调用消息的样式应为 self", lonely.map((m) => `${m.from}→${m.to}`).join(", "));

    // 标签不能压到参与者框，也不能超出画布
    const offCanvas = [];
    const onActor = [];
    for (const m of msgs) {
      if (!m.labelBox) continue;
      const b = m.labelBox;
      if (b.x < 0 || b.y < 0 || b.x + b.w > layout.width || b.y + b.h > layout.height) offCanvas.push(`#${m.index + 1}`);
      for (const a of nodes) {
        if (b.x < a.x + a.w && a.x < b.x + b.w && b.y < a.y + a.h && a.y < b.y + b.h) onActor.push(`#${m.index + 1} 压在 ${a.id} 上`);
      }
    }
    if (offCanvas.length) add("FAIL", "消息标签超出画布", offCanvas.join(", "));
    if (onActor.length) add("FAIL", "消息标签压到参与者框", onActor.join("；"));

    if (!items.slice(structStart).some((i) => i.level === "FAIL")) {
      add("PASS", "结构合法", `${nodes.length} 参与者 / ${msgs.length} 条消息，顺序自上而下`);
    }
  } else if (layout.type === "er") {
    // ER：实体 + 字段 + 关系基数
    const rels = layout.er.relations;

    const noFields = nodes.filter((n) => !n.fields || n.fields.length === 0);
    if (noFields.length) add("FAIL", "实体必须有字段", `这些实体是空的：${noFields.map((n) => n.id).join(", ")}`);

    const emptyField = nodes.flatMap((n) => (n.fields ?? []).filter((f) => !f.name).map((f) => `${n.id}.f${f.index + 1}`));
    if (emptyField.length) add("FAIL", "字段必须有名字", emptyField.join(", "));

    const noPk = nodes.filter((n) => !(n.fields ?? []).some((f) => f.pk));
    if (noPk.length) add("WARN", "实体没有主键", `确认是有意为之：${noPk.map((n) => n.id).join(", ")}`);

    const fat = nodes.filter((n) => (n.fields ?? []).length > 8);
    if (fat.length) add("WARN", "字段太多", `超过 8 个，建议只留关键字段：${fat.map((n) => `${n.id}(${n.fields.length})`).join(", ")}`);

    const unlabeled = rels.filter((r) => !r.label);
    if (unlabeled.length) add("WARN", "关系建议写动词", `第 ${unlabeled.map((r) => r.index + 1).join(", ")} 条没有 label`);

    const dup = new Map();
    for (const r of rels) {
      const k = [r.from, r.to].sort().join("<->");
      dup.set(k, (dup.get(k) ?? 0) + 1);
    }
    const dupList = [...dup.entries()].filter(([, c]) => c > 1).map(([k]) => k);
    if (dupList.length) add("WARN", "同一对实体有多条关系", dupList.join("；") + "（合并成一条，或在 label 里写清区别）");

    // 基数标签：不出画布、不压实体
    const offCanvas = [];
    const onEntity = [];
    for (const r of rels) {
      for (const c of r.cardLabels) {
        const b = c.box;
        if (b.x < 0 || b.y < 0 || b.x + b.w > layout.width || b.y + b.h > layout.height) offCanvas.push(`第 ${r.index + 1} 条`);
        for (const e of nodes) {
          if (b.x < e.x + e.w && e.x < b.x + b.w && b.y < e.y + e.h && e.y < b.y + b.h) onEntity.push(`第 ${r.index + 1} 条的 "${c.text}"`);
        }
      }
    }
    if (offCanvas.length) add("FAIL", "基数标签超出画布", offCanvas.join(", "));
    if (onEntity.length) add("FAIL", "基数标签压到实体框", onEntity.join("；"));

    if (!items.slice(structStart).some((i) => i.level === "FAIL")) {
      add("PASS", "结构合法", `${nodes.length} 实体 / ${rels.length} 关系，两端基数齐全`);
    }
  } else if (layout.type === "arch") {
    // 架构图：层容器 + 模块 + 依赖连线
    const bands = layout.arch.bands;

    // 容器不变式：模块必须落在自己的层里
    const outside = [];
    for (const n of nodes) {
      const band = n.band;
      if (!band) continue;
      const ok =
        n.x >= band.x - 1 &&
        n.y >= band.y - 1 &&
        n.x + n.w <= band.x + band.w + 1 &&
        n.y + n.h <= band.y + band.h + 1;
      if (!ok) outside.push(`${n.id} ↔ ${band.name}`);
    }
    if (outside.length) add("FAIL", "模块必须落在所在层内", outside.slice(0, 6).join("；"));

    const tooMany = bands.filter((b) => layout.arch.layers.find((l) => l.name === b.name)?.count > 5);
    const counts = layout.arch.layers.filter((l) => l.count > 5);
    if (counts.length) add("WARN", "单层模块过多", counts.map((l) => `${l.name}(${l.count})`).join("、") + "，建议 ≤5");
    if (bands.length > 6) add("WARN", "层数偏多", `现在 ${bands.length} 层，建议 ≤6`);

    const rels = edges;
    const selfLink = rels.filter((r) => r.from === r.to);
    if (selfLink.length) add("FAIL", "模块不能连自己", selfLink.map((r) => r.from).join(", "));

    const dup = new Map();
    for (const r of rels) {
      const k = `${r.from}->${r.to}`;
      dup.set(k, (dup.get(k) ?? 0) + 1);
    }
    const dupList = [...dup.entries()].filter(([, c]) => c > 1).map(([k]) => k);
    if (dupList.length) add("WARN", "重复连接", dupList.join("；") + "（双向依赖请写成两条，不要重复同一个方向）");

    const unlabeled = rels.filter((r) => !r.label);
    if (unlabeled.length) add("WARN", "连接建议标协议或动作", `第 ${unlabeled.map((r) => r.index + 1).join(", ")} 条没有 label`);

    // 退化线段：零长度，或贴着模块边框走（看起来像框线加粗，最容易漏看）
    const degenerate = [];
    for (const r of rels) {
      for (let i = 0; i < r.points.length - 1; i++) {
        const a = r.points[i];
        const b = r.points[i + 1];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len < 1) {
          degenerate.push(`第 ${r.index + 1} 条有零长度段`);
          break;
        }
        const horizontal = Math.abs(a.y - b.y) < 0.5;
        const vertical = Math.abs(a.x - b.x) < 0.5;
        const onEdge = nodes.some((n) => {
          if (horizontal && (Math.abs(a.y - n.y) < 0.5 || Math.abs(a.y - (n.y + n.h)) < 0.5)) {
            const lo = Math.min(a.x, b.x);
            const hi = Math.max(a.x, b.x);
            return lo < n.x + n.w - 1 && hi > n.x + 1;
          }
          if (vertical && (Math.abs(a.x - n.x) < 0.5 || Math.abs(a.x - (n.x + n.w)) < 0.5)) {
            const lo = Math.min(a.y, b.y);
            const hi = Math.max(a.y, b.y);
            return lo < n.y + n.h - 1 && hi > n.y + 1;
          }
          return false;
        });
        if (onEdge) {
          degenerate.push(`第 ${r.index + 1} 条贴着模块边框走`);
          break;
        }
      }
    }
    if (degenerate.length) add("FAIL", "连线不能和模块边框重合", degenerate.slice(0, 5).join("；"));

    // 层名留白带是给层名专用的，连线不许从里面穿
    const inGutter = [];
    for (const r of rels) {
      for (const b of bands) {
        const gx0 = b.x;
        const gx1 = b.x + (b.gutter ?? 0);
        for (let i = 0; i < r.points.length - 1; i++) {
          const a = r.points[i];
          const c = r.points[i + 1];
          const lo = Math.min(a.x, c.x);
          const hi = Math.max(a.x, c.x);
          if (hi > gx0 + 1 && lo < gx1 - 1 && Math.min(a.y, c.y) < b.y + b.h && Math.max(a.y, c.y) > b.y) {
            inGutter.push(`第 ${r.index + 1} 条穿过「${b.name}」的层名带`);
            break;
          }
        }
      }
    }
    if (inGutter.length) add("FAIL", "连线不能穿过层名留白带", [...new Set(inGutter)].slice(0, 5).join("；"));

    const offCanvas = [];
    const onModule = [];
    for (const r of rels) {
      if (!r.labelBox) continue;
      const b = r.labelBox;
      if (b.x < 0 || b.y < 0 || b.x + b.w > layout.width || b.y + b.h > layout.height) offCanvas.push(`第 ${r.index + 1} 条`);
      for (const n of nodes) {
        if (b.x < n.x + n.w && n.x < b.x + b.w && b.y < n.y + n.h && n.y < b.y + b.h) onModule.push(`第 ${r.index + 1} 条`);
      }
    }
    if (offCanvas.length) add("FAIL", "连接标签超出画布", offCanvas.join(", "));
    if (onModule.length) add("FAIL", "连接标签压到模块框", onModule.join(", "));

    if (!items.slice(structStart).some((i) => i.level === "FAIL")) {
      add("PASS", "结构合法", `${bands.length} 层 / ${nodes.length} 模块 / ${rels.length} 条连接`);
    }
  } else {
    // 思维导图：树 + 深度 + 分支数
    const N = nodes.length;
    if (edges.length !== N - 1) add("FAIL", "思维导图必须是一棵树", `节点 ${N}，连线 ${edges.length}（应为 ${N - 1}）`);
    const inDeg = new Map(nodes.map((n) => [n.id, 0]));
    for (const e of edges) inDeg.set(e.to, inDeg.get(e.to) + 1);
    const root = nodes.find((n) => n.depth === 0);
    const badParents = nodes.filter((n) => n.depth > 0 && inDeg.get(n.id) !== 1);
    if (root && inDeg.get(root.id) !== 0) add("FAIL", "中心主题不能有上级", `${root.id} 有 ${inDeg.get(root.id)} 条入边`);
    if (badParents.length) add("FAIL", "每个分支只能有一个上级", badParents.map((n) => n.id).join(", "));
    if ((layout.branchCount ?? 0) < 2) add("FAIL", "思维导图至少要有 2 条主分支", `现在 ${layout.branchCount ?? 0} 条`);
    const deepest = Math.max(...nodes.map((n) => n.depth));
    if (deepest > 4) add("WARN", "层级偏深", `最深 ${deepest} 层，建议压缩到 4 层以内`);
    if (!items.slice(structStart).some((i) => i.level === "FAIL")) {
      add("PASS", "结构合法", `中心 1 + 分支 ${layout.branchCount} / 共 ${N} 节点，最深 ${deepest} 层`);
    }
  }

  // ---- 3. 几何：框不能重叠 ----
  const overlaps = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      const inter =
        a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1;
      if (inter) overlaps.push(`${a.id} × ${b.id}`);
    }
  }
  if (overlaps.length) add("FAIL", "线框不能重叠", overlaps.slice(0, 6).join(", ") + (overlaps.length > 6 ? ` 等 ${overlaps.length} 处` : ""));
  else add("PASS", "线框不重叠", "全部框两两不相交");

  // ---- 4. 几何：连线不穿框 + 端点落在框边（时序图的箭头不是折线边，跳过） ----
  const crossing = [];
  const badAnchor = [];
  if (layout.type !== "sequence") {
  for (const e of edges) {
    const s = byId.get(e.from);
    const t = byId.get(e.to);
    if (!s || !t) continue;
    if (!onBorder(s, e.points[0])) badAnchor.push(`${e.from} 的起点不在框边`);
    if (!onBorder(t, e.points[e.points.length - 1])) badAnchor.push(`${e.to} 的终点不在框边`);

    const { pts } = samplePoints(e, 2);
    // 掐掉两端各 8px，避免把"贴着自己框的端头"判成穿框
    const trimmed = pts.filter((_, i) => i > 4 && i < pts.length - 5);
    for (const n of nodes) {
      if (n.id === e.from || n.id === e.to) continue;
      const box = inflate(n, -DEFAULTS.edgeGap);
      if (trimmed.some((p) => inside(box, p))) {
        crossing.push(`${e.from}→${e.to} 穿过 ${n.id}`);
        break;
      }
    }
  }
  if (crossing.length) add("FAIL", "连线不得穿过线框", crossing.slice(0, 6).join("；") + (crossing.length > 6 ? ` 等 ${crossing.length} 处` : ""));
  else if (layout.type === "flowchart" || layout.type === "er" || layout.type === "arch") add("PASS", "连线不穿框", `${edges.length} 条连线只在自己两端的框上落脚`);
  if (badAnchor.length) add("FAIL", "连线端点必须落在框边", badAnchor.slice(0, 6).join("；"));
  }

  // ---- 5. 几何：文字不超框（按形状算，不是简单内缩） ----
  const overflow = [];
  for (const n of nodes) {
    for (const p of textFit(n, theme)) overflow.push(`${n.id}: ${p}`);
  }
  if (overflow.length) add("FAIL", "文字必须完整在框内", overflow.slice(0, 5).join("；") + (overflow.length > 5 ? ` 等 ${overflow.length} 处` : ""));
  else add("PASS", "文字在框内", "逐个框按几何内切计算，全部有留白");

  // ---- 6. 颜色可读性（文字 vs 填充的对比度） ----
  const lowContrast = [];
  for (const n of nodes) {
    const fill = parseHex(n.fill);
    const txt = parseHex(n.textFill ?? theme.text);
    const lum = (c) => {
      const f = (v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
    };
    const l1 = lum(fill);
    const l2 = lum(txt);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    if (ratio < 4.5) lowContrast.push(`${n.id} ${ratio.toFixed(1)}:1`);
  }
  if (lowContrast.length) add("WARN", "文字对比度偏低", `低于 4.5:1：${lowContrast.join(", ")}`);

  // ---- 7. 画布尺寸 ----
  if (layout.width > 2400 || layout.height > 3200) {
    add("WARN", "画布偏大", `${layout.width}×${layout.height}px，建议拆分或缩小`);
  }

  return {
    ok: !items.some((i) => i.level === "FAIL"),
    items,
    stats: {
      width: layout.width,
      height: layout.height,
      nodes: nodes.length,
      edges: layout.type === "sequence" ? layout.sequence.messages.length : edges.length,
      font: layout.font,
      type: layout.type,
      layers: layout.type === "arch" ? layout.arch.bands.length : undefined,
    },  };
}

// ---------------------------------------------------------------------------
// 像素级检查：确认每个框的文字区域真的画上了字（防字体缺失/文字丢失）
// ---------------------------------------------------------------------------
export async function pixelChecks(pngPath, layout, scale = 1) {
  const items = [];
  const sharp = requireOptional("sharp");
  if (!sharp) {
    items.push({ level: "WARN", label: "跳过像素检查", detail: "没找到 sharp，无法读取 PNG" });
    return items;
  }
  const { data, info } = await sharp(pngPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const expectW = Math.round(layout.width * scale);
  const expectH = Math.round(layout.height * scale);
  if (width !== expectW || height !== expectH) {
    items.push({ level: "WARN", label: "画布尺寸不一致", detail: `${width}×${height}px（期望 ${expectW}×${expectH}px）` });
  }

  const sample = (x, y) => {
    const px = Math.max(0, Math.min(width - 1, Math.round(x)));
    const py = Math.max(0, Math.min(height - 1, Math.round(y)));
    const i = (py * width + px) * channels;
    return { r: data[i], g: data[i + 1], b: data[i + 2] };
  };
  const dist = (a, b) => Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b));

  // 逐个"有字的地方"统计墨迹：节点标签 + 时序图的消息标签
  const targets = layout.nodes.map((n) => ({ id: n.id, box: n.textBox, fill: n.fill }));
  for (const ink of layout.inkBoxes ?? []) targets.push({ id: ink.id, box: ink.box, fill: ink.fill });

  const blank = [];
  for (const t of targets) {
    const fill = parseHex(t.fill ?? layout.theme.bg);
    const tb = t.box;
    let ink = 0;
    const x0 = (tb.x - 1) * scale;
    const y0 = (tb.y - 1) * scale;
    const x1 = (tb.x + tb.w + 1) * scale;
    const y1 = (tb.y + tb.h + 1) * scale;
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        if (dist(sample(x, y), fill) > 55) ink += 1;
      }
    }
    if (ink < 12) blank.push(t.id);
  }
  if (blank.length) items.push({ level: "FAIL", label: "文字没有真正画出来", detail: `这些区域没有墨迹：${blank.join(", ")}` });
  else items.push({ level: "PASS", label: "文字已落到像素上", detail: `逐处统计，${targets.length} 处文字都有墨迹` });

  // 整图不能是空白页
  let total = 0;
  for (let y = 0; y < height; y += 4) {
    for (let x = 0; x < width; x += 4) {
      if (dist(sample(x, y), parseHex(layout.theme.bg)) > 20) total += 1;
    }
  }
  const ratio = total / ((width / 4) * (height / 4));
  if (ratio < 0.005) items.push({ level: "FAIL", label: "成品图几乎是空白", detail: `墨迹占比 ${(ratio * 100).toFixed(3)}%` });
  else items.push({ level: "PASS", label: "成品图有内容", detail: `墨迹占比约 ${(ratio * 100).toFixed(1)}%` });

  return items;
}

// ---------------------------------------------------------------------------
// 报告输出
// ---------------------------------------------------------------------------
export function formatReport(title, result, items) {
  const lines = [];
  const s = result.stats;
  const unitNodes = s.type === "sequence" ? "参与者" : s.type === "er" ? "实体" : s.type === "arch" ? "模块" : "节点";
  const unitEdges = s.type === "sequence" ? "消息" : s.type === "er" ? "关系" : s.type === "arch" ? "连接" : "连线";
  lines.push(`${title}`);
  const counts =
    s.type === "arch"
      ? `${s.layers} 层 · ${unitNodes} ${s.nodes} · ${unitEdges} ${s.edges}`
      : `${unitNodes} ${s.nodes} · ${unitEdges} ${s.edges}`;
  lines.push(
    `  ${s.type} · 画布 ${s.width} × ${s.height} px · ${counts} · 字体 ${s.font.family} ${s.font.size}${s.font.exact ? "" : "（估算字宽）"}`
  );
  for (const it of items) {
    const tag = it.level === "PASS" ? "[通过]" : it.level === "WARN" ? "[注意]" : "[失败]";
    lines.push(`  ${tag} ${it.label}${it.detail ? ` — ${it.detail}` : ""}`);
  }
  const fails = items.filter((i) => i.level === "FAIL").length;
  const warns = items.filter((i) => i.level === "WARN").length;
  lines.push(`  结论：${fails === 0 ? "PASS" : "FAIL"}${fails ? `（${fails} 项失败）` : ""}${warns ? `（${warns} 项提醒）` : ""}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const specPath = args[0];
  if (!specPath) {
    console.error("用法: node check.mjs <spec.json> [out.png] [--scale N]");
    process.exit(2);
  }
  const pngArg = args[1] && !args[1].startsWith("--") ? args[1] : undefined;
  const scaleIdx = args.indexOf("--scale");
  const scale = scaleIdx >= 0 ? Number(args[scaleIdx + 1]) || 1 : 1;

  const spec = JSON.parse(readFileSync(resolve(specPath), "utf8").replace(/^\uFEFF/, ""));
  const layout = buildLayout(spec);
  if (layout.warnings?.length) for (const w of layout.warnings) console.error(`注意: ${w}`);

  const result = runChecks(spec, layout);
  let items = result.items;
  if (pngArg && existsSync(resolve(pngArg))) {
    items = items.concat(await pixelChecks(resolve(pngArg), layout, scale));
  }
  console.log(formatReport(`simplechart 自检 · ${specPath}`, result, items));
  process.exit(items.some((i) => i.level === "FAIL") ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`自检失败: ${err.message}`);
    process.exit(2);
  });
}
