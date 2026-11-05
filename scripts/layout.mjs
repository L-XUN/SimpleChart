/**
 * layout.mjs — simplechart 的几何内核
 *
 * 职责：把"要画什么"（spec.json）变成"画在哪里"（每个框的坐标、每根线的折点）。
 * render.mjs 和 check.mjs 都用这一份结果，所以"检查通过"和"画出来的东西"是同一套几何。
 *
 * 设计要点：
 *  1. 先量文字、再定框 —— 从根上杜绝文字溢出。
 *  2. 流程图用 row/col 网格排版，天然满足"从左到右、从上到下"。
 *  3. 连线按"出口/入口端口"布线，并给候选走法打分（穿框、交叉、拐点、长度）。
 */
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// 依赖（DSH 自带 sharp / fontkit；找不到时给可读的提示）
// ---------------------------------------------------------------------------
export function requireOptional(name) {
  const tries = [name];
  const appdata = process.env.APPDATA;
  const home = process.env.USERPROFILE || process.env.HOME;
  if (appdata) tries.push(join(appdata, "npm", "node_modules", "@deepseek-ai", "dsh", "node_modules", name));
  if (home) tries.push(join(home, "AppData", "Roaming", "npm", "node_modules", "@deepseek-ai", "dsh", "node_modules", name));
  for (const t of tries) {
    try {
      return require(t);
    } catch {
      /* 试下一个 */
    }
  }
  return undefined;
}

const fontkit = requireOptional("fontkit");

// ---------------------------------------------------------------------------
// 字体：中文必须显式指定，不能指望系统默认（默认字体常常没有汉字 → 豆腐块）
// ---------------------------------------------------------------------------
const FONT_CANDIDATES = [
  { file: "C:/Windows/Fonts/simhei.ttf", family: "SimHei" },
  { file: "C:/Windows/Fonts/msyh.ttc", family: "Microsoft YaHei" },
  { file: "C:/Windows/Fonts/Deng.ttf", family: "DengXian" },
  { file: "C:/Windows/Fonts/NotoSansSC-VF.ttf", family: "Noto Sans SC" },
  { file: "/System/Library/Fonts/PingFang.ttc", family: "PingFang SC" },
  { file: "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", family: "Noto Sans CJK SC" },
];

let cachedFont;

export function resolveFont() {
  if (cachedFont) return cachedFont;
  for (const cand of FONT_CANDIDATES) {
    if (!existsSync(cand.file)) continue;
    let tk = null;
    if (fontkit) {
      try {
        const opened = fontkit.openSync(cand.file);
        // .ttc 是字体集合（fonts 是数组），要先取具体一个字体
        if (Array.isArray(opened.fonts) && opened.fonts.length > 0) {
          const first = opened.fonts[0];
          tk = opened.getFont(first.postscriptName) ?? first;
        } else {
          tk = opened;
        }
        if (!tk || typeof tk.layout !== "function") tk = null;
      } catch {
        tk = null;
      }
    }
    if (tk) {
      cachedFont = { family: cand.family, file: cand.file, tk, upm: tk.unitsPerEm || 1000, exact: true };
      return cachedFont;
    }
  }
  cachedFont = { family: "SimHei", file: null, tk: null, upm: 1000, exact: false };
  return cachedFont;
}

/** 字宽测量：有 fontkit 就精确算，没有就按全角/半角估算。 */
export function makeMeasurer(font) {
  const cache = new Map();
  return function measure(text, size) {
    const key = size + "\u0000" + text;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    let width;
    if (font.tk) {
      try {
        const run = font.tk.layout(text);
        const scale = size / font.upm;
        width = run.positions.reduce((sum, p) => sum + p.xAdvance, 0) * scale;
      } catch {
        width = undefined;
      }
    }
    if (!Number.isFinite(width)) width = estimateWidth(text, size);
    cache.set(key, width);
    return width;
  };
}

function estimateWidth(text, size) {
  let units = 0;
  for (const ch of text) units += isWide(ch.codePointAt(0)) ? 1 : 0.55;
  return units * size;
}

function isWide(cp) {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  );
}

// ---------------------------------------------------------------------------
// 基础样式与常量（check.mjs 也用这些数，保证"规则"和"检查"是同一套标准）
// ---------------------------------------------------------------------------
export const DEFAULTS = {
  margin: 40, // 画布外边距
  gapX: 68, // 列间距
  gapY: 56, // 行间距
  padX: 14, // 框内左右留白
  padY: 10, // 框内上下留白
  lineHeightRatio: 1.45,
  fontSize: 16,
  titleSize: 1.25, // 标题字号 = fontSize * 该系数
  padXMin: 6, // 自检：文字距框线的最小留白
  padYMin: 5,
  clearance: 30, // 回边绕行时离框的距离
  edgeGap: 4, // 自检：连线距框的最小净距
  maxLines: 4, // 单框最多几行字
  slant: 16, // 平行四边形（输入/输出）的斜边水平偏移
};

const PALETTE = {
  start: "#E4F3EA",
  end: "#FBE7E7",
  process: "#FFFFFF",
  decision: "#FFF3DE",
  io: "#E9F0FE",
  subprocess: "#F3EEFB",
  actor: "#EEF3FF", // 时序图的参与者框
};

const BRANCH_COLORS = ["#2F6FED", "#0E9F6E", "#C2410C", "#7C3AED", "#0E7490", "#B45309"];

export function baseTheme() {
  return {
    bg: "#FFFFFF",
    stroke: "#1F2328",
    text: "#1F2328",
    edge: "#3A4048",
    strokeWidth: 2,
    edgeWidth: 2,
    arrowSize: 9,
    fontSize: DEFAULTS.fontSize,
    palette: { ...PALETTE },
  };
}

// ---------------------------------------------------------------------------
// 文本工具
// ---------------------------------------------------------------------------
/** 贪心换行：中文任意断行，英文优先在空格断。 */
export function wrapText(text, maxWidth, measure, size) {
  const paragraphs = String(text ?? "").split(/\r?\n/);
  const lines = [];
  for (const para of paragraphs) {
    if (para === "") {
      lines.push("");
      continue;
    }
    let cur = "";
    let lastSpace = -1;
    for (const ch of para) {
      const next = cur + ch;
      if (cur !== "" && measure(next, size) > maxWidth) {
        if (lastSpace > 0) {
          lines.push(cur.slice(0, lastSpace).trimEnd());
          cur = cur.slice(lastSpace).trimStart();
        } else {
          lines.push(cur);
          cur = "";
        }
        lastSpace = -1;
      }
      cur += ch;
      if (ch === " ") lastSpace = cur.length;
    }
    if (cur.trim() !== "" || lines.length === 0) lines.push(cur.replace(/\s+$/, ""));
  }
  rebalance(lines, measure, size);
  return lines.length ? lines : [""];
}

/** 行首禁则：句读不能出现在一行的开头，挪回上一行末尾。 */
const NO_LINE_START = "、。，．；：？！）〕】》」』”’,.;:?!)]}";

function fixLineStart(lines) {
  for (let i = 1; i < lines.length; i++) {
    while (lines[i].length > 1 && NO_LINE_START.includes(lines[i][0])) {
      lines[i - 1] += lines[i][0];
      lines[i] = lines[i].slice(1);
    }
  }
}

/** 避免最后一行孤零零一两个字：从上一行匀一个字下来。 */
function rebalance(lines, measure, size) {
  fixLineStart(lines);
  for (let guard = 0; guard < 4; guard++) {
    let changed = false;
    for (let i = 1; i < lines.length; i++) {
      const prev = lines[i - 1];
      const cur = lines[i];
      if (prev.length <= 2 || cur.length === 0) continue;
      if (measure(cur, size) >= measure(prev, size) * 0.45) continue;
      lines[i - 1] = prev.slice(0, -1);
      lines[i] = prev.slice(-1) + cur;
      changed = true;
    }
    if (!changed) break;
  }
}

const SHAPE_ALIASES = {
  start: "start",
  开始: "start",
  end: "end",
  结束: "end",
  process: "process",
  流程: "process",
  处理: "process",
  矩形: "process",
  decision: "decision",
  判断: "decision",
  分支: "decision",
  菱形: "decision",
  io: "io",
  输入: "io",
  输出: "io",
  输入输出: "io",
  平行四边形: "io",
  subprocess: "subprocess",
  子流程: "subprocess",
  圆角矩形: "subprocess",
};

export function normalizeShape(shape) {
  const raw = String(shape ?? "process").trim();
  return SHAPE_ALIASES[raw.toLowerCase()] ?? SHAPE_ALIASES[raw] ?? "process";
}

function textWidthFor(shape) {
  if (shape === "decision") return 118;
  if (shape === "io") return 150;
  if (shape === "start" || shape === "end") return 150;
  return 190;
}

/** 由文字块尺寸反推框尺寸（文字永远先量好，框只会比字大）。 */
export function autoSize(shape, textW, textH) {
  const { padX, padY } = DEFAULTS;
  if (shape === "decision") {
    return { w: Math.max(textW * 2.2, 130), h: Math.max(textH * 2.2, 72) };
  }
  if (shape === "io") {
    return { w: textW + padX * 2 + DEFAULTS.slant * 2, h: textH + padY * 2 };
  }
  if (shape === "start" || shape === "end") {
    const h = textH + padY * 2 + 6;
    return { w: Math.max(textW + padX * 2 + h * 0.5, h * 1.7), h };
  }
  if (shape === "subprocess") {
    return { w: textW + padX * 2 + 14, h: textH + padY * 2 };
  }
  return { w: textW + padX * 2, h: textH + padY * 2 };
}

// ---------------------------------------------------------------------------
// 对外入口
// ---------------------------------------------------------------------------
/** 建一份公共环境：主题、字体、量字函数、行高。所有图类型共用。 */
export function createContext(spec) {
  const theme = baseTheme();
  if (spec.theme && typeof spec.theme === "object") {
    for (const [k, v] of Object.entries(spec.theme)) {
      if (k === "palette" && v && typeof v === "object") Object.assign(theme.palette, v);
      else theme[k] = v;
    }
  }

  const font = resolveFont();
  const fontSize = Number(spec.fontSize ?? theme.fontSize);
  if (!(fontSize >= 9 && fontSize <= 96)) throw new Error(`fontSize 不合理: ${spec.fontSize}`);

  const measure = makeMeasurer(font);
  const ascent = font.tk ? (font.tk.ascent / font.upm) * fontSize : fontSize * 0.86;
  const ctx = { theme, fontSize, measure, ascent, lh: fontSize * DEFAULTS.lineHeightRatio, font };
  return { ctx, theme, font, fontSize, ascent, warnings: [] };
}

/** 把各类型自己的返回值补齐成统一结构（render / check 只认这个结构）。 */
export function finishLayout(layout, env, type) {
  layout.type = type;
  layout.theme = env.theme;
  layout.ascent = env.ascent;
  layout.font = { family: env.font.family, size: env.fontSize, exact: env.font.exact, file: env.font.file };
  layout.warnings = [...(env.warnings ?? []), ...(layout.warnings ?? [])];
  if (!env.font.exact) {
    layout.warnings.push("没找到可用中文字体，字宽是估算值：渲染后必须回看图片，确认没有豆腐块/回退成衬线体。");
  }
  return layout;
}

export function buildLayout(spec) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) throw new Error("spec 必须是一个 JSON 对象");
  const type = String(spec.type ?? "flowchart").toLowerCase();
  if (type !== "flowchart" && type !== "mindmap") {
    throw new Error(`不支持的 type: ${spec.type}（本模块支持 flowchart / mindmap；sequence 走 spec.mjs 分发）`);
  }

  const env = createContext(spec);
  const layout = type === "mindmap" ? layoutMindmap(spec, env.ctx) : layoutFlow(spec, env.ctx);
  return finishLayout(layout, env, type);
}

// ---------------------------------------------------------------------------
// 流程图：row/col 网格
// ---------------------------------------------------------------------------
function layoutFlow(spec, ctx) {
  const raw = Array.isArray(spec.nodes) ? spec.nodes : [];
  if (raw.length === 0) throw new Error("flowchart 需要 nodes 数组");

  const seen = new Set();
  const nodes = raw.map((node, index) => {
    const id = String(node.id ?? `n${index + 1}`);
    if (seen.has(id)) throw new Error(`节点 id 重复: ${id}`);
    seen.add(id);

    const shape = normalizeShape(node.shape);
    const text = String(node.text ?? "").trim(); // 空标签不在这里抛，交给 check.mjs 报告

    const limit = Number(node.textWidth) > 0 ? Number(node.textWidth) : textWidthFor(shape);
    const lines = wrapText(text, limit, ctx.measure, ctx.fontSize);
    const textW = Math.max(...lines.map((l) => ctx.measure(l, ctx.fontSize)), 1);
    const textH = lines.length * ctx.lh;
    const size = autoSize(shape, textW, textH);

    const forcedW = Number(node.w) > 0;
    const forcedH = Number(node.h) > 0;
    return {
      id,
      shape,
      text,
      lines,
      row: Number.isInteger(node.row) ? node.row : index,
      col: Number.isInteger(node.col) ? node.col : 0,
      w: forcedW ? Number(node.w) : Math.round(size.w),
      h: forcedH ? Number(node.h) : Math.round(size.h),
      forcedW,
      forcedH,
      textW,
      textH,
      fill: node.fill ?? ctx.theme.palette[shape] ?? "#FFFFFF",
      stroke: node.stroke ?? ctx.theme.stroke,
    };
  });

  // --- 网格尺寸 ---
  const rows = [...new Set(nodes.map((n) => n.row))].sort((a, b) => a - b);
  const cols = [...new Set(nodes.map((n) => n.col))].sort((a, b) => a - b);
  const rowH = new Map(rows.map((r) => [r, 0]));
  const colW = new Map(cols.map((c) => [c, 0]));
  for (const n of nodes) {
    rowH.set(n.row, Math.max(rowH.get(n.row), n.h));
    colW.set(n.col, Math.max(colW.get(n.col), n.w));
  }

  const title = spec.title ? String(spec.title) : "";
  const titleSize = Math.round(ctx.fontSize * DEFAULTS.titleSize);
  const titleH = title ? Math.round(titleSize * 2.2) : 0;

  const rowY = new Map();
  let y = DEFAULTS.margin + titleH;
  for (const r of rows) {
    rowY.set(r, y);
    y += rowH.get(r) + DEFAULTS.gapY;
  }

  const colX = new Map();
  let x = DEFAULTS.margin;
  for (const c of cols) {
    colX.set(c, x);
    x += colW.get(c) + DEFAULTS.gapX;
  }

  for (const n of nodes) {
    n.x = Math.round(colX.get(n.col) + (colW.get(n.col) - n.w) / 2);
    n.y = Math.round(rowY.get(n.row) + (rowH.get(n.row) - n.h) / 2);
    n.textBox = { x: n.x + (n.w - n.textW) / 2, y: n.y + (n.h - n.textH) / 2, w: n.textW, h: n.textH };
  }

  let width = Math.round(x - DEFAULTS.gapX + DEFAULTS.margin);
  let height = Math.round(y - DEFAULTS.gapY + DEFAULTS.margin);

  // --- 连线 ---
  const edges = planRoutes(nodes, Array.isArray(spec.edges) ? spec.edges : []);
  placeEdgeLabels(edges, nodes, ctx);

  // 边标签可能溢到画布外，按标签实际占位把画布撑大
  for (const e of edges) {
    if (!e.labelBox) continue;
    width = Math.max(width, Math.ceil(e.labelBox.x + e.labelBox.w + DEFAULTS.margin));
    height = Math.max(height, Math.ceil(e.labelBox.y + e.labelBox.h + DEFAULTS.margin));
  }

  return { width, height, title, titleSize, titleAnchor: { x: DEFAULTS.margin, y: DEFAULTS.margin + titleSize }, nodes, edges };
}

// ---------------------------------------------------------------------------
// 连线：选边（出口/入口）→ 端口摊开 → 候选走法打分
// ---------------------------------------------------------------------------
const OPPOSITE = { bottom: "top", top: "bottom", left: "right", right: "left" };

/** 出口 / 入口选哪一边：优先朝"空隙更大"的那条轴，避免线贴着自己框拐弯。 */
function chooseSides(s, t) {
  const exitGaps = {
    bottom: t.y - (s.y + s.h),
    top: s.y - (t.y + t.h),
    right: t.x - (s.x + s.w),
    left: s.x - (t.x + t.w),
  };
  const positive = Object.entries(exitGaps).filter(([, g]) => g >= 0.5);
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

function portPoint(node, side, offset) {
  const span = side === "top" || side === "bottom" ? node.w : node.h;
  const limit = Math.max(0, span / 2 - 16);
  const d = Math.max(-limit, Math.min(limit, offset));
  if (side === "bottom") return { x: node.x + node.w / 2 + d, y: node.y + node.h };
  if (side === "top") return { x: node.x + node.w / 2 + d, y: node.y };
  if (side === "right") return { x: node.x + node.w, y: node.y + node.h / 2 + d };
  return { x: node.x, y: node.y + node.h / 2 + d };
}

function axisOf(side) {
  return side === "top" || side === "bottom" ? "v" : "h";
}

function sideAt(node, p) {
  if (Math.abs(p.y - node.y) < 1.5) return "top";
  if (Math.abs(p.y - (node.y + node.h)) < 1.5) return "bottom";
  if (Math.abs(p.x - node.x) < 1.5) return "left";
  if (Math.abs(p.x - (node.x + node.w)) < 1.5) return "right";
  return null;
}

function planRoutes(nodes, edgeSpecs) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const list = edgeSpecs.map((e, i) => {
    const s = byId.get(String(e.from));
    const t = byId.get(String(e.to));
    if (!s || !t) throw new Error(`第 ${i + 1} 条边引用了不存在的节点: ${e.from} -> ${e.to}`);
    const { exit, entry } = chooseSides(s, t);
    return { from: s.id, to: t.id, s, t, exit, entry, label: String(e.label ?? "").trim() };
  });

  const bounds = {
    minX: Math.min(...nodes.map((n) => n.x)),
    minY: Math.min(...nodes.map((n) => n.y)),
    maxX: Math.max(...nodes.map((n) => n.x + n.w)),
    maxY: Math.max(...nodes.map((n) => n.y + n.h)),
  };

  // 第一遍（不摊开端口）：先看每条线最终落在哪一边，再据此分配端口
  const probe = list.map((e) => routeWith(e, 0, 0, nodes, bounds, []));
  const ports = new Map();
  list.forEach((e, i) => {
    const r = probe[i];
    e.usedExit = sideAt(e.s, r.points[0]) ?? e.exit;
    e.usedEntry = sideAt(e.t, r.points[r.points.length - 1]) ?? e.entry;
    if (r.kind === "loop") return; // 回边直接贴框边中点，不参与摊开
    for (const [node, side] of [
      [e.s, e.usedExit],
      [e.t, e.usedEntry],
    ]) {
      const key = `${node.id}:${side}`;
      const arr = ports.get(key) ?? [];
      arr.push(e);
      ports.set(key, arr);
    }
  });

  // 第二遍（带端口偏移）：同一侧的多条线彼此错开
  const routed = [];
  return list.map((e) => {
    const p1 = ports.get(`${e.s.id}:${e.usedExit}`) ?? [];
    const p2 = ports.get(`${e.t.id}:${e.usedEntry}`) ?? [];
    const r = routeWith(e, portOffset(p1, e, e.s, e.usedExit), portOffset(p2, e, e.t, e.usedEntry), nodes, bounds, routed);
    routed.push(r.points);
    return { from: e.from, to: e.to, label: e.label, kind: r.kind, side: r.side, points: r.points };
  });
}

function portOffset(arr, edge, node, side) {
  if (!arr || arr.length <= 1) return 0;
  const i = arr.indexOf(edge);
  const n = arr.length;
  const span = side === "top" || side === "bottom" ? node.w : node.h;
  const usable = Math.max(12, span - 26);
  const step = Math.min(26, usable / n);
  return (i - (n - 1) / 2) * step;
}

function routeWith(e, offExit, offEntry, nodes, bounds, routed) {
  const exitSide = e.usedExit ?? e.exit;
  const entrySide = e.usedEntry ?? e.entry;
  const p1 = portPoint(e.s, exitSide, offExit);
  const p2 = portPoint(e.t, entrySide, offEntry);
  const cands = candidates(e.s, e.t, p1, p2, exitSide, entrySide, bounds);
  let best = cands[0];
  let bestScore = Infinity;
  for (const c of cands) {
    const score = scorePath(c.points, nodes, e.s, e.t, routed);
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

function candidates(s, t, p1, p2, exitSide, entrySide, bounds) {
  const cands = [];
  const axExit = axisOf(exitSide);
  const axEntry = axisOf(entrySide);

  if (axExit === "v" && axEntry === "v") {
    if (Math.abs(p1.x - p2.x) < 1) {
      cands.push({ kind: "v", points: [p1, p2] });
    } else if (Math.abs(p1.y - p2.y) > 8) {
      // 两端在同一高度时 VHV 会退化成"贴着框边走"的直线，干脆不生成
      const midY = (p1.y + p2.y) / 2;
      cands.push({ kind: "vhv", points: [p1, { x: p1.x, y: midY }, { x: p2.x, y: midY }, p2] });
    }
  } else if (axExit === "h" && axEntry === "h") {
    if (Math.abs(p1.y - p2.y) < 1) {
      cands.push({ kind: "h", points: [p1, p2] });
    } else if (Math.abs(p1.x - p2.x) > 8) {
      const midX = (p1.x + p2.x) / 2;
      cands.push({ kind: "hvh", points: [p1, { x: midX, y: p1.y }, { x: midX, y: p2.y }, p2] });
    }
  } else if (axExit === "v") {
    cands.push({ kind: "vh", points: [p1, { x: p1.x, y: p2.y }, p2] });
  } else {
    cands.push({ kind: "hv", points: [p1, { x: p2.x, y: p1.y }, p2] });
  }

  // 列间通道：从源/目标之间的横向空隙竖着走，密集网格里最不容易撞到框
  const rightward = t.x > s.x + s.w;
  const leftward = t.x + t.w < s.x;
  if (rightward || leftward) {
    const chX = rightward ? (s.x + s.w + t.x) / 2 : (s.x + t.x + t.w) / 2;
    const from = { x: rightward ? s.x + s.w : s.x, y: s.y + s.h / 2 };
    const to = { x: rightward ? t.x : t.x + t.w, y: t.y + t.h / 2 };
    cands.push({ kind: "lane", side: rightward ? 1 : -1, points: [from, { x: chX, y: from.y }, { x: chX, y: to.y }, to] });
  }

  // 回环：绕到整张图的外侧再折回来（"退回/重试"看起来最顺，也不会压到中间的框）
  for (const side of [1, -1]) {
    const outX = side === 1 ? bounds.maxX + DEFAULTS.clearance : bounds.minX - DEFAULTS.clearance;
    const from = { x: side === 1 ? s.x + s.w : s.x, y: s.y + s.h / 2 };
    const to = { x: side === 1 ? t.x + t.w : t.x, y: t.y + t.h / 2 };
    cands.push({ kind: "loop", side, points: [from, { x: outX, y: from.y }, { x: outX, y: to.y }, to] });
  }
  return cands;
}

/** 代价 = 穿框（100/个）+ 与已画连线交叉（60/次）+ 拐点（2/个）+ 长度 */
function scorePath(points, nodes, s, t, routed) {
  let hits = 0;
  for (const n of nodes) {
    if (n.id === s.id || n.id === t.id) continue;
    const box = { x: n.x + 1, y: n.y + 1, w: n.w - 2, h: n.h - 2 };
    if (polylineHits(points, box)) hits += 1;
  }
  let crossings = 0;
  for (const other of routed) if (polylinesCross(points, other)) crossings += 1;
  let length = 0;
  for (let i = 0; i < points.length - 1; i++) {
    length += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
  }
  return hits * 100 + crossings * 60 + (points.length - 2) * 2 + length * 0.01;
}

function polylineHits(points, box) {
  for (let i = 0; i < points.length - 1; i++) {
    if (segmentHitsBox(points[i], points[i + 1], box)) return true;
  }
  return false;
}

function segmentHitsBox(a, b, box) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.max(2, Math.ceil(len / 3));
  for (let k = 1; k < n; k++) {
    const x = a.x + ((b.x - a.x) * k) / n;
    const y = a.y + ((b.y - a.y) * k) / n;
    if (x > box.x && x < box.x + box.w && y > box.y && y < box.y + box.h) return true;
  }
  return false;
}

function polylinesCross(p, q) {
  for (let i = 0; i < p.length - 1; i++) {
    for (let j = 0; j < q.length - 1; j++) {
      if (segmentsCross(p[i], p[i + 1], q[j], q[j + 1])) return true;
    }
  }
  return false;
}

function segmentsCross(a, b, c, d) {
  const cross = (o, p, q) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/**
 * 边标签：优先贴着"出发点"（顺着出口就能读到），其次"落点"，最后最长那段。
 * 位置要避开所有框；实在放不下就用最后的位置。
 */
function placeEdgeLabels(edges, nodes, ctx) {
  const boxes = nodes.map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h }));
  const hitsNode = (box) =>
    boxes.some((b) => box.x < b.x + b.w && b.x < box.x + box.w && box.y < b.y + b.h && b.y < box.y + box.h);

  for (const e of edges) {
    if (!e.label) continue;
    const w = ctx.measure(e.label, ctx.fontSize) + 8;
    const h = ctx.lh;

    let longest = 0;
    let longestLen = -1;
    for (let i = 0; i < e.points.length - 1; i++) {
      const len = Math.hypot(e.points[i + 1].x - e.points[i].x, e.points[i + 1].y - e.points[i].y);
      if (len > longestLen) {
        longestLen = len;
        longest = i;
      }
    }

    const order = [0, e.points.length - 2, longest].filter((v, i, arr) => arr.indexOf(v) === i);
    let chosen = null;
    for (const i of order) {
      const box = labelBoxAt(e, i, w, h);
      if (!hitsNode(box)) {
        chosen = box;
        break;
      }
    }
    if (!chosen) chosen = labelBoxAt(e, longest, w, h);

    chosen.x = Math.max(4, chosen.x);
    chosen.y = Math.max(4, chosen.y);
    e.labelBox = chosen;
  }
}

function labelBoxAt(e, i, w, h) {
  const a = e.points[i];
  const b = e.points[i + 1] ?? a;
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const horizontal = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
  if (horizontal) return { x: mid.x - w / 2, y: mid.y - h - 3, w, h };
  return { x: e.side === 1 ? mid.x - w - 7 : mid.x + 7, y: mid.y - h / 2, w, h };
}

// ---------------------------------------------------------------------------
// 思维导图：中心 + 左右平衡树 + 贝塞尔曲线
// ---------------------------------------------------------------------------
function layoutMindmap(spec, ctx) {
  const HGAP = 54;
  const VGAP = 14;
  let seq = 0;

  const makeNode = (text, depth) => {
    const clean = String(text ?? "").trim();
    const maxWidth = depth === 0 ? 168 : depth === 1 ? 140 : 124;
    const lines = wrapText(clean, maxWidth, ctx.measure, ctx.fontSize);
    const textW = Math.max(...lines.map((l) => ctx.measure(l, ctx.fontSize)), 1);
    const textH = lines.length * ctx.lh;
    return {
      id: depth === 0 ? "root" : `m${++seq}`,
      depth,
      text: clean,
      lines,
      textW,
      textH,
      w: Math.round(textW + DEFAULTS.padX * 2 + (depth === 0 ? 20 : 8)),
      h: Math.round(textH + (depth === 0 ? 20 : 14)),
      children: [],
      x: 0,
      y: 0,
    };
  };

  const root = makeNode(spec.root?.text ?? spec.title ?? "中心主题", 0);
  const rawBranches = Array.isArray(spec.branches) ? spec.branches : [];
  if (rawBranches.length === 0) throw new Error("mindmap 需要 branches 数组");

  const build = (item, depth) => {
    const text = typeof item === "string" ? item : item?.text;
    const node = makeNode(text, depth);
    const kids = typeof item === "string" ? [] : Array.isArray(item?.children) ? item.children : [];
    node.children = kids.map((k) => build(k, depth + 1));
    return node;
  };
  root.children = rawBranches.map((b) => build(b, 1));

  const right = root.children.filter((_, i) => i % 2 === 0);
  const left = root.children.filter((_, i) => i % 2 === 1);

  const placeSide = (list, dir) => {
    if (list.length === 0) return;
    const levelW = new Map();
    const walkW = (n, d) => {
      levelW.set(d, Math.max(levelW.get(d) ?? 0, n.w));
      n.children.forEach((c) => walkW(c, d + 1));
    };
    list.forEach((n) => walkW(n, 1));

    const depthMax = Math.max(...levelW.keys());
    const leftEdge = new Map();
    let edge = dir === 1 ? root.w / 2 + HGAP : -(root.w / 2 + HGAP) - levelW.get(1);
    for (let d = 1; d <= depthMax; d++) {
      if (d > 1) edge = dir === 1 ? edge + levelW.get(d - 1) + HGAP : edge - HGAP - levelW.get(d);
      leftEdge.set(d, edge);
    }

    let cursor = 0;
    const walk = (n, d) => {
      n.x = dir === 1 ? leftEdge.get(d) : leftEdge.get(d) + (levelW.get(d) - n.w);
      if (n.children.length === 0) {
        n.cy = cursor + n.h / 2;
        cursor += n.h + VGAP;
      } else {
        n.children.forEach((c) => walk(c, d + 1));
        n.cy = (n.children[0].cy + n.children[n.children.length - 1].cy) / 2;
      }
      n.y = n.cy - n.h / 2;
    };
    list.forEach((n) => walk(n, 1));

    const height = cursor - VGAP;
    const shift = -height / 2;
    const all = [];
    const collect = (n) => {
      all.push(n);
      n.children.forEach(collect);
    };
    list.forEach(collect);
    for (const n of all) {
      n.y += shift;
      n.cy += shift;
    }
  };

  placeSide(right, 1);
  placeSide(left, -1);

  root.x = -root.w / 2;
  root.y = -root.h / 2;

  const all = [];
  const collect = (n) => {
    all.push(n);
    n.children.forEach(collect);
  };
  collect(root);

  const minX = Math.min(...all.map((n) => n.x));
  const minY = Math.min(...all.map((n) => n.y));
  const maxX = Math.max(...all.map((n) => n.x + n.w));
  const maxY = Math.max(...all.map((n) => n.y + n.h));

  const title = spec.title ? String(spec.title) : "";
  const titleSize = Math.round(ctx.fontSize * DEFAULTS.titleSize);
  const titleH = title ? Math.round(titleSize * 2.2) : 0;
  const dx = DEFAULTS.margin - minX;
  const dy = DEFAULTS.margin + titleH - minY;

  for (const n of all) {
    n.x = Math.round(n.x + dx);
    n.y = Math.round(n.y + dy);
    n.textBox = { x: n.x + (n.w - n.textW) / 2, y: n.y + (n.h - n.textH) / 2, w: n.textW, h: n.textH };
    delete n.cy;
  }

  // 分支配色：第 1 层按分支序号取色，子层继承
  const colorOf = new Map();
  const paint = (n, color) => {
    colorOf.set(n.id, color);
    n.children.forEach((c) => paint(c, color));
  };
  root.children.forEach((b, i) => paint(b, BRANCH_COLORS[i % BRANCH_COLORS.length]));
  for (const n of all) {
    const color = colorOf.get(n.id) ?? ctx.theme.stroke;
    n.branchColor = color;
    if (n.depth === 0) {
      n.fill = "#1F2328";
      n.stroke = "#1F2328";
      n.textFill = "#FFFFFF";
    } else if (n.depth === 1) {
      n.fill = mix(color, "#FFFFFF", 0.86);
      n.stroke = color;
      n.textFill = "#1F2328";
    } else {
      n.fill = "#FFFFFF";
      n.stroke = mix(color, "#FFFFFF", 0.35);
      n.textFill = "#1F2328";
    }
  }

  const edges = [];
  const link = (p, c) => {
    const dir = c.x + c.w / 2 < p.x + p.w / 2 ? -1 : 1;
    const p0 = { x: dir === 1 ? p.x + p.w : p.x, y: p.y + p.h / 2 };
    const p1 = { x: dir === 1 ? c.x : c.x + c.w, y: c.y + c.h / 2 };
    const dxc = (p1.x - p0.x) * 0.45;
    edges.push({
      from: p.id,
      to: c.id,
      label: "",
      kind: "curve",
      color: c.depth === 1 ? c.branchColor : p.branchColor,
      points: [p0, { x: p0.x + dxc, y: p0.y }, { x: p1.x - dxc, y: p1.y }, p1],
    });
  };
  const linkTree = (n) => {
    n.children.forEach((c) => {
      link(n, c);
      linkTree(c);
    });
  };
  linkTree(root);

  return {
    width: Math.round(maxX - minX + DEFAULTS.margin * 2),
    height: Math.round(maxY - minY + DEFAULTS.margin * 2 + titleH),
    title,
    titleSize,
    titleAnchor: { x: DEFAULTS.margin, y: DEFAULTS.margin + titleSize },
    nodes: all,
    edges,
    branchCount: root.children.length,
  };
}

// ---------------------------------------------------------------------------
// 颜色工具
// ---------------------------------------------------------------------------
export function mix(hex, target, amount) {
  const a = parseHex(hex);
  const b = parseHex(target);
  const r = Math.round(a.r + (b.r - a.r) * amount);
  const g = Math.round(a.g + (b.g - a.g) * amount);
  const bl = Math.round(a.b + (b.b - a.b) * amount);
  return `#${[r, g, bl].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

export function parseHex(hex) {
  const s = String(hex).replace("#", "");
  const full = s.length === 3 ? s.split("").map((c) => c + c).join("") : s;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}
