/**
 * layout-arch.mjs — 架构图排版（层容器 + 模块行 + 依赖连线）
 *
 * 与前面几类的区别：多了一层"容器"概念——模块必须落在自己的层里。
 * 连线布线是第三份同类逻辑（流程图、ER、这里），下一次改动应当抽成 routing.mjs；
 * 按"先扩展、后重构"的原则，这一版先保持独立，避免动到已回归通过的流程图。
 */
import { DEFAULTS, createContext, finishLayout, wrapText, mix } from "./layout.mjs";

const ARCH = {
  bandPadX: 20,
  bandPadY: 16,
  bandGapY: 24,
  moduleGapX: 56,
  labelGap: 10, // 层名与模块之间
  techSize: 0.82,
};

export function buildArch(spec) {
  const env = createContext(spec);
  return finishLayout(placeArch(spec, env.ctx), env, "arch");
}

function placeArch(spec, ctx) {
  const F = ctx.fontSize;
  const lh = ctx.lh;
  const techF = Math.round(F * ARCH.techSize);
  const techLh = techF * DEFAULTS.lineHeightRatio;

  const rawLayers = Array.isArray(spec.layers) ? spec.layers : [];
  if (rawLayers.length === 0) throw new Error("arch 需要 layers 数组（每层至少一个模块）");

  const seen = new Set();
  let moduleCount = 0;

  // --- 1. 先把每层的模块量成盒子 ---
  const layers = rawLayers.map((rawLayer, li) => {
    const name = String(rawLayer?.name ?? `第 ${li + 1} 层`).trim();
    const rawModules = Array.isArray(rawLayer?.modules) ? rawLayer.modules : [];
    const modules = rawModules.map((m, mi) => {
      const id = String(m?.id ?? `m${li + 1}_${mi + 1}`);
      if (seen.has(id)) throw new Error(`模块 id 重复: ${id}`);
      seen.add(id);
      const mname = String(m?.name ?? id).trim();
      const tech = String(m?.tech ?? "").trim();
      const nameLines = wrapText(mname, 170, ctx.measure, F);
      const techLines = tech ? wrapText(tech, 170, ctx.measure, techF) : [];
      const nameW = Math.max(...nameLines.map((l) => ctx.measure(l, F)), 1);
      const techW = techLines.length ? Math.max(...techLines.map((l) => ctx.measure(l, techF)), 1) : 0;
      const textW = Math.max(nameW, techW);
      const textH = nameLines.length * lh + (techLines.length ? 2 + techLines.length * techLh : 0);
      moduleCount += 1;
      return {
        id,
        name: mname,
        text: mname, // 通用检查用
        tech,
        nameLines,
        techLines,
        lines: nameLines,
        layerIndex: li,
        textW,
        textH,
        w: Math.round(textW + DEFAULTS.padX * 2 + 8),
        h: Math.round(textH + DEFAULTS.padY * 2 + 6),
        x: 0,
        y: 0,
        shape: "process",
        fill: m?.fill ?? ctx.theme.palette.module ?? "#FFFFFF",
        stroke: m?.stroke ?? ctx.theme.stroke,
        textFill: ctx.theme.text,
      };
    });
    return { index: li, name, modules };
  });

  const emptyLayer = layers.find((l) => l.modules.length === 0);
  if (emptyLayer) throw new Error(`第 ${emptyLayer.index + 1} 层（${emptyLayer.name}）里没有模块`);

  // --- 2. 统一带宽：所有层等宽，视觉才齐 ---
  const bandHeights = layers.map((l) => {
    const maxModuleH = Math.max(...l.modules.map((m) => m.h));
    // 层名竖排，长名字也要放得下
    const labelLen = Math.ceil(ctx.measure(l.name, F)) + 24;
    return Math.round(Math.max(maxModuleH + ARCH.bandPadY * 2, labelLen));
  });
  const bandInner = layers.map((l) => l.modules.reduce((sum, m) => sum + m.w, 0) + ARCH.moduleGapX * (l.modules.length - 1));
  // 层名竖排在左侧的独立留白带里：这样连线永远不会穿过层名
  const GUTTER = 38;
  const contentW = Math.max(
    Math.round(F * 6), // 最小宽度
    ...bandInner.map((w) => w + GUTTER + ARCH.bandPadX * 2)
  );

  // --- 3. 落位 ---
  const title = spec.title ? String(spec.title) : "";
  const titleSize = Math.round(F * DEFAULTS.titleSize);
  const titleH = title ? Math.round(titleSize * 2.2) : 0;

  const bands = [];
  let y = DEFAULTS.margin + titleH;
  layers.forEach((layer, li) => {
    const bandH = bandHeights[li];
    const band = {
      id: layer.name,
      name: layer.name,
      x: DEFAULTS.margin,
      y,
      w: contentW,
      h: bandH,
      fill: mix(ctx.theme.stroke, ctx.theme.bg, 0.94),
      stroke: mix(ctx.theme.stroke, ctx.theme.bg, 0.78),
      gutter: GUTTER,
      labelBox: { x: DEFAULTS.margin, y, w: GUTTER, h: bandH },
    };

    const rowW = bandInner[li];
    const innerW = contentW - GUTTER - ARCH.bandPadX; // 留白带右侧可用宽度
    let x = DEFAULTS.margin + GUTTER + Math.round((innerW - rowW) / 2);
    const moduleTop = y + ARCH.bandPadY;
    for (const m of layer.modules) {
      m.x = Math.round(x);
      m.y = Math.round(moduleTop + (bandHeights[li] - ARCH.bandPadY * 2 - m.h) / 2);
      m.band = band;
      m.textBox = {
        x: m.x + (m.w - m.textW) / 2,
        y: m.y + (m.h - m.textH) / 2,
        w: m.textW,
        h: m.textH,
      };
      if (m.techLines.length) {
        const techW = Math.max(...m.techLines.map((t) => ctx.measure(t, techF)));
        m.techBox = {
          x: m.textBox.x + (m.textW - techW) / 2,
          y: m.textBox.y + m.nameLines.length * lh + 2,
          w: techW,
          h: m.techLines.length * techLh,
        };
      }
      x += m.w + ARCH.moduleGapX;
    }
    bands.push(band);
    y += bandH + ARCH.bandGapY;
  });

  const modules = layers.flatMap((l) => l.modules);
  const byId = new Map(modules.map((m) => [m.id, m]));

  // --- 4. 连线 ---
  const rawLinks = Array.isArray(spec.links) ? spec.links : [];

  // 先把每条链路的进出口侧定下来，再按 (模块, 边) 摊开端口，
  // 否则"两个客户端都连网关"会画成两条重合的线。
  const prepared = rawLinks.map((l, i) => {
    const from = byId.get(String(l?.from));
    const to = byId.get(String(l?.to));
    if (!from || !to) throw new Error(`第 ${i + 1} 条连接引用了不存在的模块: ${l?.from} -> ${l?.to}`);
    const sides = chooseArchSides(from, to);
    return { index: i, from, to, exit: sides.exit, entry: sides.entry, label: String(l?.label ?? "").trim() };
  });

  const bounds0 = {
    minX: Math.min(...modules.map((m) => m.x)),
    maxX: Math.max(...modules.map((m) => m.x + m.w)),
    minY: Math.min(...modules.map((m) => m.y)),
    maxY: Math.max(...modules.map((m) => m.y + m.h)),
  };
  const bandLabels = bands.map((b) => b.labelBox);
  const bounds = { ...bounds0, bandMinX: Math.min(...bands.map((b) => b.x)), bandMaxX: Math.max(...bands.map((b) => b.x + b.w)) };

  // 同一段层间空隙里的多条线，错开各自的横向通道（否则会连成一条长"搁板"）
  const gapGroups = new Map();
  for (const p of prepared) {
    if (p.from.y === p.to.y) {
      p.midShift = 0;
      continue;
    }
    const upper = p.from.y < p.to.y ? p.from : p.to;
    const lower = p.from.y < p.to.y ? p.to : p.from;
    const key = Math.round((upper.y + upper.h + lower.y) / 2);
    const arr = gapGroups.get(key) ?? [];
    arr.push(p);
    gapGroups.set(key, arr);
  }
  for (const arr of gapGroups.values()) {
    arr.forEach((p, i) => {
      p.midShift = (i - (arr.length - 1) / 2) * 9;
    });
  }

  // 端口摊开 + 选边会互相影响（over/under 会改用上下边），迭代到稳定为止
  let links = [];
  let stable = false;
  for (let iter = 0; iter < 4 && !stable; iter++) {
    const usedKey = prepared.map((p) => `${p.usedExit ?? p.exit}|${p.usedEntry ?? p.entry}`).join(",");

    const buckets = new Map();
    for (const p of prepared) {
      for (const [node, side] of [
        [p.from, p.usedExit ?? p.exit],
        [p.to, p.usedEntry ?? p.entry],
      ]) {
        const key = `${node.id}:${side}`;
        const arr = buckets.get(key) ?? [];
        arr.push(p);
        buckets.set(key, arr);
      }
    }
    const offsetFor = (node, side, link) => {
      const arr = buckets.get(`${node.id}:${side}`) ?? [];
      if (arr.length <= 1) return 0;
      // 按"另一端"的坐标排序后再分配，线才不会一出门就互相交叉
      const other = (p) => (p.from.id === node.id ? p.to : p.from);
      const horizontalSide = side === "top" || side === "bottom";
      const sorted = [...arr].sort((a, b) => {
        const oa = other(a);
        const ob = other(b);
        return horizontalSide ? oa.x + oa.w / 2 - (ob.x + ob.w / 2) : oa.y + oa.h / 2 - (ob.y + ob.h / 2);
      });
      const i = sorted.indexOf(link);
      const span = horizontalSide ? node.w : node.h;
      const step = Math.min(24, Math.max(12, span - 36) / arr.length);
      return (i - (arr.length - 1) / 2) * step;
    };

    const routed = [];
    links = prepared.map((p) => {
      const route = routeLink(p, modules, routed, bounds, bandLabels, offsetFor);
      routed.push(route.points);
      return {
        index: p.index,
        from: p.from.id,
        to: p.to.id,
        fromModule: p.from,
        toModule: p.to,
        label: p.label,
        kind: route.kind,
        points: route.points,
      };
    });

    const nextKey = prepared
      .map((p, i) => {
        const r = links[i];
        const exit = sideAt(p.from, r.points[0]) ?? p.usedExit ?? p.exit;
        const entry = sideAt(p.to, r.points[r.points.length - 1]) ?? p.usedEntry ?? p.entry;
        return `${exit}|${entry}`;
      })
      .join(",");

    if (nextKey === usedKey) {
      stable = true;
    } else {
      prepared.forEach((p, i) => {
        const r = links[i];
        p.usedExit = sideAt(p.from, r.points[0]) ?? p.usedExit ?? p.exit;
        p.usedEntry = sideAt(p.to, r.points[r.points.length - 1]) ?? p.usedEntry ?? p.entry;
      });
    }
  }

  placeLinkLabels(links, modules, ctx);

  // --- 5. 画布 ---
  let width = Math.round(DEFAULTS.margin * 2 + contentW);
  let height = Math.round(y - ARCH.bandGapY + DEFAULTS.margin);
  for (const l of links) {
    if (!l.labelBox) continue;
    width = Math.max(width, Math.ceil(l.labelBox.x + l.labelBox.w + DEFAULTS.margin));
    height = Math.max(height, Math.ceil(l.labelBox.y + l.labelBox.h + DEFAULTS.margin));
  }

  const inkBoxes = [
    ...modules.filter((m) => m.techBox).map((m) => ({ id: `${m.id}.tech`, box: m.techBox, fill: m.fill })),
    ...links.filter((l) => l.labelBox).map((l) => ({ id: `link${l.index + 1}`, box: l.labelBox, fill: ctx.theme.bg })),
  ];

  return {
    width,
    height,
    title,
    titleSize,
    titleAnchor: { x: DEFAULTS.margin, y: DEFAULTS.margin + titleSize },
    nodes: modules,
    edges: links,
    inkBoxes,
    arch: { bands, layers: layers.map((l) => ({ name: l.name, count: l.modules.length })), moduleCount },
  };
}

/** 进出口选边：朝空隙更大的那条轴走 */
const OPPOSITE = { bottom: "top", top: "bottom", left: "right", right: "left" };

function chooseArchSides(s, t) {
  const gaps = {
    bottom: t.y - (s.y + s.h),
    top: s.y - (t.y + t.h),
    right: t.x - (s.x + s.w),
    left: s.x - (t.x + t.w),
  };
  const positive = Object.entries(gaps).filter(([, g]) => g >= 0.5);
  let exit;
  if (positive.length) {
    exit = positive.sort((a, b) => b[1] - a[1])[0][0];
  } else {
    const dx = t.x + t.w / 2 - (s.x + s.w / 2);
    const dy = t.y + t.h / 2 - (s.y + s.h / 2);
    exit = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? "right" : "left") : dy >= 0 ? "bottom" : "top";
  }
  const entryGaps = {
    top: t.y - (s.y + s.h),
    bottom: s.y - (t.y + t.h),
    left: t.x - (s.x + s.w),
    right: s.x - (t.x + t.w),
  };
  const entryPositive = Object.entries(entryGaps).filter(([, g]) => g >= 0.5);
  const entry = entryPositive.length ? entryPositive.sort((a, b) => b[1] - a[1])[0][0] : OPPOSITE[exit];
  return { exit, entry };
}

function portPoint(m, side, offset) {
  const span = side === "top" || side === "bottom" ? m.w : m.h;
  const limit = Math.max(0, span / 2 - 18);
  const d = Math.max(-limit, Math.min(limit, offset));
  if (side === "bottom") return { x: m.x + m.w / 2 + d, y: m.y + m.h };
  if (side === "top") return { x: m.x + m.w / 2 + d, y: m.y };
  if (side === "right") return { x: m.x + m.w, y: m.y + m.h / 2 + d };
  return { x: m.x, y: m.y + m.h / 2 + d };
}

function axisOf(side) {
  return side === "top" || side === "bottom" ? "v" : "h";
}

/** 端口点落在框的哪条边上（用于第二遍摊端口） */
function sideAt(m, p) {
  if (Math.abs(p.y - m.y) < 1.5) return "top";
  if (Math.abs(p.y - (m.y + m.h)) < 1.5) return "bottom";
  if (Math.abs(p.x - m.x) < 1.5) return "left";
  if (Math.abs(p.x - (m.x + m.w)) < 1.5) return "right";
  return null;
}

/** 连线：端口直连 / Z 型 / 上下绕行 / 侧边绕行，按"穿框→交叉→拐点→长度"打分 */
function routeLink(link, modules, routed, bounds, bandLabels, offsetFor) {
  const s = link.from;
  const t = link.to;
  const exitSide = link.usedExit ?? link.exit;
  const entrySide = link.usedEntry ?? link.entry;
  const p1 = portPoint(s, exitSide, offsetFor(s, exitSide, link));
  const p2 = portPoint(t, entrySide, offsetFor(t, entrySide, link));
  const axExit = axisOf(exitSide);
  const axEntry = axisOf(entrySide);
  const cands = [];

  if (axExit === "v" && axEntry === "v") {
    if (Math.abs(p1.x - p2.x) < 1) cands.push({ kind: "v", points: [p1, p2] });
    else if (Math.abs(p1.y - p2.y) > 8) {
      const midY = (p1.y + p2.y) / 2 + (link.midShift ?? 0);
      cands.push({ kind: "vhv", points: [p1, { x: p1.x, y: midY }, { x: p2.x, y: midY }, p2] });
    }
  } else if (axExit === "h" && axEntry === "h") {
    if (Math.abs(p1.y - p2.y) < 1) cands.push({ kind: "h", points: [p1, p2] });
    else if (Math.abs(p1.x - p2.x) > 8) {
      const midX = (p1.x + p2.x) / 2;
      cands.push({ kind: "hvh", points: [p1, { x: midX, y: p1.y }, { x: midX, y: p2.y }, p2] });
    }
  } else if (axExit === "v") {
    cands.push({ kind: "vh", points: [p1, { x: p1.x, y: p2.y }, p2] });
  } else {
    cands.push({ kind: "hv", points: [p1, { x: p2.x, y: p1.y }, p2] });
  }

  // 同排有遮挡时绕上行或下行（用框的上下边靠角落的位置，别和中间的端口抢同一个点）
  // 绕行只当兜底：加一个固定代价，避免"为了躲一次交叉把线甩到整层外面"
  const detourBase = 35;
  const rightward = t.x + t.w / 2 > s.x + s.w / 2;
  const scx = rightward ? s.x + s.w - 26 : s.x + 26;
  const tcx = rightward ? t.x + 26 : t.x + t.w - 26;
  const shift = link.midShift ?? 0;
  const overY = Math.min(s.y, t.y) - 30 + shift;
  const underY = Math.max(s.y + s.h, t.y + t.h) + 30 + shift;
  cands.push({
    kind: "over",
    base: detourBase,
    points: [{ x: scx, y: s.y }, { x: scx, y: overY }, { x: tcx, y: overY }, { x: tcx, y: t.y }],
  });
  cands.push({
    kind: "under",
    base: detourBase,
    points: [
      { x: scx, y: s.y + s.h },
      { x: scx, y: underY },
      { x: tcx, y: underY },
      { x: tcx, y: t.y + t.h },
    ],
  });

  // 侧边绕行（跨多层的长链路）：贴着整张图的外侧走，不进层名的留白带
  const bandMinX = bounds.bandMinX ?? bounds.minX - 30;
  const bandMaxX = bounds.bandMaxX ?? bounds.maxX + 30;
  for (const side of [1, -1]) {
    const outX = side === 1 ? bandMaxX + 16 : bandMinX - 16;
    const from = { x: side === 1 ? s.x + s.w : s.x, y: s.y + s.h / 2 };
    const to = { x: side === 1 ? t.x + t.w : t.x, y: t.y + t.h / 2 };
    cands.push({ kind: "loop", side, base: detourBase, points: [from, { x: outX, y: from.y }, { x: outX, y: to.y }, to] });
  }

  let best = cands[0];
  let bestScore = Infinity;
  for (const c of cands) {
    let hits = 0;
    for (const m of modules) {
      if (m.id === s.id || m.id === t.id) continue;
      if (hitsBox(c.points, m)) hits += 1;
    }
    // 层名不算"必须避让"：绕开它反而会把线甩到画布边上，用背景色块把它压住更自然
    let crossings = 0;
    for (const other of routed) if (crosses(c.points, other)) crossings += 1;
    let len = 0;
    for (let i = 0; i < c.points.length - 1; i++) {
      len += Math.hypot(c.points[i + 1].x - c.points[i].x, c.points[i + 1].y - c.points[i].y);
    }
    const score = hits * 100 + crossings * 25 + (c.points.length - 2) * 2 + len * 0.01 + (c.base ?? 0);
    if (process.env.ARCH_DEBUG) {
      console.error("cand", `${s.id}>${t.id}`.padEnd(13), c.kind.padEnd(5), "hits", hits, "cross", crossings, "len", len.toFixed(0), "score", score.toFixed(1), JSON.stringify(c.points.map((p) => [Math.round(p.x), Math.round(p.y)])));
    }
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

function hitsBox(points, box) {
  const b = { x: box.x + 1, y: box.y + 1, w: box.w - 2, h: box.h - 2 };
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const c = points[i + 1];
    const len = Math.hypot(c.x - a.x, c.y - a.y);
    const n = Math.max(2, Math.ceil(len / 3));
    for (let k = 1; k < n; k++) {
      const px = a.x + ((c.x - a.x) * k) / n;
      const py = a.y + ((c.y - a.y) * k) / n;
      if (px > b.x && px < b.x + b.w && py > b.y && py < b.y + b.h) return true;
    }
  }
  return false;
}

function crosses(p, q) {
  const seg = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  for (let i = 0; i < p.length - 1; i++) {
    for (let j = 0; j < q.length - 1; j++) {
      const a = p[i];
      const b = p[i + 1];
      const c = q[j];
      const d = q[j + 1];
      const d1 = seg(c, d, a);
      const d2 = seg(c, d, b);
      const d3 = seg(a, b, c);
      const d4 = seg(a, b, d);
      if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
    }
  }
  return false;
}

/** 连线标签：贴最长那段的中点；横线上方、竖线右侧；避开模块框和其他标签 */
function placeLinkLabels(links, modules, ctx) {
  const F = ctx.fontSize;
  const lh = ctx.lh;
  const placed = [];
  const clashLabel = (b) => placed.some((p) => b.x < p.x + p.w && p.x < b.x + b.w && b.y < p.y + p.h && p.y < b.y + b.h);
  const clashBox = (b) => modules.some((m) => b.x < m.x + m.w && m.x < b.x + b.w && b.y < m.y + m.h && m.y < b.y + b.h);

  for (const l of links) {
    if (!l.label) continue;
    const p = l.points;
    const segs = [];
    for (let i = 0; i < p.length - 1; i++) {
      segs.push({ i, len: Math.hypot(p[i + 1].x - p[i].x, p[i + 1].y - p[i].y) });
    }
    segs.sort((a, b) => b.len - a.len);
    // 先试最长段，其次首段、末段
    const order = [segs[0]?.i, 0, p.length - 2].filter((v, i, arr) => v !== undefined && arr.indexOf(v) === i);

    const w = ctx.measure(l.label, F) + 8;
    let chosen = null;
    for (const si of order) {
      const a = p[si];
      const b = p[si + 1];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const horizontal = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
      const base = horizontal
        ? { x: mid.x - w / 2, y: mid.y - lh - 4, w, h: lh }
        : { x: mid.x + 8, y: mid.y - lh / 2, w, h: lh };
      for (let attempt = 0; attempt < 3; attempt++) {
        const box = { ...base };
        if (horizontal) box.y += attempt * (lh + 2);
        else box.x += attempt * (w + 6);
        box.x = Math.max(4, box.x);
        box.y = Math.max(4, box.y);
        if (clashBox(box) || clashLabel(box)) continue;
        chosen = box;
        break;
      }
      if (chosen) break;
    }
    if (!chosen) {
      // 实在放不下：退到最长段上方，只保证不出画布
      const a = p[segs[0].i];
      const b = p[segs[0].i + 1];
      chosen = { x: Math.max(4, (a.x + b.x) / 2 - w / 2), y: Math.max(4, (a.y + b.y) / 2 - lh - 4), w, h: lh };
    }
    placed.push(chosen);
    l.labelBox = chosen;
  }
}
