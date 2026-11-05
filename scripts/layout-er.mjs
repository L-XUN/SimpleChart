/**
 * layout-er.mjs — ER 图排版（实体框 + 字段行 + 关系线 + 两端基数）
 *
 * 与流程图共用"网格排版"思路（row/col），但实体框自带表头 + 字段行，
 * 关系线不带箭头（方向由两端基数表达），所以单独一个模块。
 */
import { DEFAULTS, createContext, finishLayout, wrapText } from "./layout.mjs";

const ER = {
  headerPadY: 10,
  fieldH: 26,
  gapX: 124,
  gapY: 78,
  maxFields: 8,
  cardAlong: 20, // 基数标签沿线退开的距离
  cardSide: 15, // 基数标签偏离线的法向距离
};

export function buildEr(spec) {
  const env = createContext(spec);
  return finishLayout(placeEr(spec, env.ctx), env, "er");
}

function placeEr(spec, ctx) {
  const F = ctx.fontSize;
  const lh = ctx.lh;

  const rawEntities = Array.isArray(spec.entities) ? spec.entities : [];
  if (rawEntities.length === 0) throw new Error("er 需要 entities 数组");

  const perRow = Number(spec.perRow) > 0 ? Math.floor(Number(spec.perRow)) : 3;
  const seen = new Set();

  const entities = rawEntities.map((raw, index) => {
    const id = String(raw.id ?? `e${index + 1}`);
    if (seen.has(id)) throw new Error(`实体 id 重复: ${id}`);
    seen.add(id);

    const name = String(raw.name ?? id).trim();
    const headerLines = wrapText(name, 180, ctx.measure, F);
    const headerW = Math.max(...headerLines.map((l) => ctx.measure(l, F)), 1);

    const rawFields = Array.isArray(raw.fields) ? raw.fields : [];
    const fields = rawFields.map((f, fi) => {
      const fname = String(f.name ?? "").trim();
      const ftype = String(f.type ?? "").trim();
      const text = (f.pk ? "PK " : "") + fname + (ftype ? ` : ${ftype}` : "");
      return {
        name: fname,
        type: ftype,
        pk: Boolean(f.pk),
        text,
        textW: ctx.measure(text, F),
        index: fi,
      };
    });

    const contentW = Math.max(headerW, ...fields.map((f) => f.textW), 1);
    const w = Math.round(contentW + DEFAULTS.padX * 2);
    const headerH = Math.round(headerLines.length * lh + ER.headerPadY * 2);
    const h = headerH + fields.length * ER.fieldH;

    return {
      id,
      name,
      text: name, // 让通用检查（标签非空）也能识别
      headerLines,
      lines: headerLines, // 通用检查用 lines 判断"字太多"
      headerW,
      fields,
      x: 0,
      y: 0,
      w,
      h,
      headerH,
      shape: "process", // 复用矩形内切检查
      fill: raw.fill ?? ctx.theme.palette.entity ?? "#FFFFFF",
      stroke: raw.stroke ?? ctx.theme.stroke,
      textFill: ctx.theme.text,
      row: Number.isInteger(raw.row) ? raw.row : Math.floor(index / perRow),
      col: Number.isInteger(raw.col) ? raw.col : index % perRow,
    };
  });

  // --- 网格 ---
  const rows = [...new Set(entities.map((e) => e.row))].sort((a, b) => a - b);
  const cols = [...new Set(entities.map((e) => e.col))].sort((a, b) => a - b);
  const rowH = new Map(rows.map((r) => [r, 0]));
  const colW = new Map(cols.map((c) => [c, 0]));
  for (const e of entities) {
    rowH.set(e.row, Math.max(rowH.get(e.row), e.h));
    colW.set(e.col, Math.max(colW.get(e.col), e.w));
  }

  const title = spec.title ? String(spec.title) : "";
  const titleSize = Math.round(F * DEFAULTS.titleSize);
  const titleH = title ? Math.round(titleSize * 2.2) : 0;

  const rowY = new Map();
  let y = DEFAULTS.margin + titleH;
  for (const r of rows) {
    rowY.set(r, y);
    y += rowH.get(r) + ER.gapY;
  }
  const colX = new Map();
  let x = DEFAULTS.margin;
  for (const c of cols) {
    colX.set(c, x);
    x += colW.get(c) + ER.gapX;
  }

  for (const e of entities) {
    e.x = Math.round(colX.get(e.col) + (colW.get(e.col) - e.w) / 2);
    e.y = Math.round(rowY.get(e.row) + (rowH.get(e.row) - e.h) / 2);
    // 表头文字框（像素自检用）
    e.textBox = {
      x: e.x + (e.w - e.headerW) / 2,
      y: e.y + (e.headerH - e.headerLines.length * lh) / 2,
      w: e.headerW,
      h: e.headerLines.length * lh,
    };
    // 每个字段一行，左对齐
    e.fieldBoxes = e.fields.map((f, i) => ({
      id: `${e.id}.${f.name || `f${i + 1}`}`,
      box: { x: e.x + DEFAULTS.padX, y: e.y + e.headerH + i * ER.fieldH + (ER.fieldH - lh) / 2, w: Math.max(f.textW, 1), h: lh },
      fill: e.fill,
    }));
  }

  // --- 关系 ---
  const byId = new Map(entities.map((e) => [e.id, e]));
  const rawRelations = Array.isArray(spec.relations) ? spec.relations : [];
  const relations = rawRelations.map((r, i) => {
    const from = byId.get(String(r.from));
    const to = byId.get(String(r.to));
    if (!from || !to) throw new Error(`第 ${i + 1} 条关系引用了不存在的实体: ${r.from} -> ${r.to}`);
    const card = parseCardinality(r.cardinality);
    if (!card) throw new Error(`第 ${i + 1} 条关系的 cardinality 必须写成 "1:N" 这种两端形式，收到: ${JSON.stringify(r.cardinality)}`);
    const route = from.id === to.id ? selfLoop(from) : routeRelation(from, to, entities);
    return {
      index: i,
      from: from.id,
      to: to.id,
      fromEntity: from,
      toEntity: to,
      self: from.id === to.id,
      label: String(r.label ?? "").trim(),
      cardinality: card,
      kind: route.kind,
      points: route.points,
    };
  });

  placeRelationLabels(relations, entities, ctx);

  // --- 画布 ---
  let width = Math.round(x - ER.gapX + DEFAULTS.margin);
  let height = Math.round(y - ER.gapY + DEFAULTS.margin);
  const paints = [
    ...entities,
    ...relations.flatMap((r) => [r.midLabel, ...r.cardLabels].filter(Boolean)),
  ];
  for (const p of paints) {
    const box = p.box ?? p;
    width = Math.max(width, Math.ceil(box.x + box.w + DEFAULTS.margin));
    height = Math.max(height, Math.ceil(box.y + box.h + DEFAULTS.margin));
  }

  const inkBoxes = [
    ...entities.flatMap((e) => e.fieldBoxes),
    ...relations.flatMap((r) => (r.midLabel ? [{ id: `rel${r.index + 1}.label`, box: r.midLabel, fill: ctx.theme.bg }] : [])),
    ...relations.flatMap((r) => r.cardLabels.map((c, i) => ({ id: `rel${r.index + 1}.card${i}`, box: c.box, fill: ctx.theme.bg }))),
  ];

  return {
    width,
    height,
    title,
    titleSize,
    titleAnchor: { x: DEFAULTS.margin, y: DEFAULTS.margin + titleSize },
    nodes: entities,
    edges: relations,
    inkBoxes,
    er: { relations, perRow, headerH: ER.fieldH },
  };
}

/** "1:N" / "1 : N" / "0..1:N" → { from: "1", to: "N" }；不合格返回 null */
export function parseCardinality(value) {
  const raw = String(value ?? "").trim();
  const m = raw.match(/^([^:：]+)[:：]([^:：]+)$/);
  if (!m) return null;
  const from = m[1].trim();
  const to = m[2].trim();
  if (!from || !to) return null;
  return { from, to };
}

/** 自关联：从实体下方绕一圈回来（不走侧面，免得和左右的关系线打架） */
function selfLoop(e) {
  const cx = e.x + e.w / 2;
  const bottom = e.y + e.h;
  const half = 26;
  const drop = 42;
  return {
    kind: "loop",
    points: [
      { x: cx - half, y: bottom },
      { x: cx - half, y: bottom + drop },
      { x: cx + half, y: bottom + drop },
      { x: cx + half, y: bottom },
    ],
  };
}

/** 关系线：能直就直，否则 Z 型，尽量不穿框 */
function routeRelation(s, t, entities) {
  const sc = { x: s.x + s.w / 2, y: s.y + s.h / 2 };
  const tc = { x: t.x + t.w / 2, y: t.y + t.h / 2 };
  const below = t.y >= s.y + s.h;
  const above = t.y + t.h <= s.y;
  const right = t.x >= s.x + s.w;
  const left = t.x + t.w <= s.x;

  const cands = [];
  if (Math.abs(sc.x - tc.x) < 1.5 && below) cands.push({ kind: "v", points: [{ x: sc.x, y: s.y + s.h }, { x: sc.x, y: t.y }] });
  if (Math.abs(sc.x - tc.x) < 1.5 && above) cands.push({ kind: "v", points: [{ x: sc.x, y: s.y }, { x: sc.x, y: t.y + t.h }] });
  if (Math.abs(sc.y - tc.y) < 1.5 && right) cands.push({ kind: "h", points: [{ x: s.x + s.w, y: sc.y }, { x: t.x, y: tc.y }] });
  if (Math.abs(sc.y - tc.y) < 1.5 && left) cands.push({ kind: "h", points: [{ x: s.x, y: sc.y }, { x: t.x + t.w, y: tc.y }] });

  if (below) {
    const midY = (s.y + s.h + t.y) / 2;
    cands.push({
      kind: "vhv",
      points: [{ x: sc.x, y: s.y + s.h }, { x: sc.x, y: midY }, { x: tc.x, y: midY }, { x: tc.x, y: t.y }],
    });
  }
  if (above) {
    const midY = (t.y + t.h + s.y) / 2;
    cands.push({
      kind: "vhv",
      points: [{ x: sc.x, y: s.y }, { x: sc.x, y: midY }, { x: tc.x, y: midY }, { x: tc.x, y: t.y + t.h }],
    });
  }
  if ((right || left) && !below && !above) {
    const midX = right ? (s.x + s.w + t.x) / 2 : (t.x + t.w + s.x) / 2;
    const sx = right ? s.x + s.w : s.x;
    const tx = right ? t.x : t.x + t.w;
    cands.push({
      kind: "hvh",
      points: [{ x: sx, y: sc.y }, { x: midX, y: sc.y }, { x: midX, y: tc.y }, { x: tx, y: tc.y }],
    });
  }
  if (cands.length === 0) {
    // 兜底：斜向，用一个拐点
    const sx = right ? s.x + s.w : s.x;
    const tx = right ? t.x : t.x + t.w;
    cands.push({ kind: "L", points: [{ x: sx, y: sc.y }, { x: tx, y: tc.y }] });
  }

  let best = cands[0];
  let bestScore = Infinity;
  for (const c of cands) {
    let hits = 0;
    for (const e of entities) {
      if (e.id === s.id || e.id === t.id) continue;
      if (polylineHitsBox(c.points, e)) hits += 1;
    }
    let len = 0;
    for (let i = 0; i < c.points.length - 1; i++) {
      len += Math.hypot(c.points[i + 1].x - c.points[i].x, c.points[i + 1].y - c.points[i].y);
    }
    const score = hits * 100 + (c.points.length - 2) * 2 + len * 0.01;
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

function polylineHitsBox(points, box) {
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

/** 基数标签贴两端，关系动词贴最长那段中点 */
function placeRelationLabels(relations, entities, ctx) {
  const F = ctx.fontSize;
  const lh = ctx.lh;
  const hitsAny = (box) =>
    entities.some((e) => box.x < e.x + e.w && e.x < box.x + box.w && box.y < e.y + e.h && e.y < box.y + box.h);

  for (const r of relations) {
    const p = r.points;

    // 自关联：两个基数分列环的两侧，动词放在环下方
    if (r.self) {
      const cx = r.fromEntity.x + r.fromEntity.w / 2;
      const bottom = r.fromEntity.y + r.fromEntity.h;
      const drop = p[1].y - bottom;
      const mk = (text, x, y) => {
        const w = ctx.measure(text, F) + 8;
        return { text, box: { x: x - w / 2, y: y - lh / 2, w, h: lh } };
      };
      r.cardLabels = [
        mk(r.cardinality.from, cx - 26 - 14, bottom + drop / 2),
        mk(r.cardinality.to, cx + 26 + 14, bottom + drop / 2),
      ];
      if (r.label) {
        const w = ctx.measure(r.label, F) + 8;
        r.midLabel = { x: cx - w / 2, y: bottom + drop + 4, w, h: lh };
      }
      continue;
    }

    const first = { a: p[0], b: p[1] };
    const last = { a: p[p.length - 2], b: p[p.length - 1] };

    const put = (anchor, other, text) => {
      const dx = other.x - anchor.x;
      const dy = other.y - anchor.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const w = ctx.measure(text, F) + 8;
      const h = lh;
      // 沿线退开一点，再往法向偏：横线贴下方，竖线贴右方，避开线本身
      const cx = anchor.x + ux * ER.cardAlong - uy * ER.cardSide;
      const cy = anchor.y + uy * ER.cardAlong + ux * ER.cardSide;
      return { text, box: { x: cx - w / 2, y: cy - h / 2, w, h } };
    };

    const fromLabel = put(p[0], p[1], r.cardinality.from);
    const toLabel = put(p[p.length - 1], p[p.length - 2], r.cardinality.to);
    r.cardLabels = [fromLabel, toLabel].map((l) => {
      l.box.x = Math.max(4, l.box.x);
      l.box.y = Math.max(4, l.box.y);
      return l;
    });

    if (r.label) {
      let best = 0;
      let bestLen = -1;
      for (let i = 0; i < p.length - 1; i++) {
        const len = Math.hypot(p[i + 1].x - p[i].x, p[i + 1].y - p[i].y);
        if (len > bestLen) {
          bestLen = len;
          best = i;
        }
      }
      const a = p[best];
      const b = p[best + 1];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const horizontal = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
      const w = ctx.measure(r.label, F) + 8;
      // 动词放在基数标签的另一侧：横线走上方，竖线走左侧
      const box = horizontal
        ? { x: mid.x - w / 2, y: mid.y - lh - 6, w, h: lh }
        : { x: mid.x - w - 8, y: mid.y - lh / 2, w, h: lh };
      box.x = Math.max(4, box.x);
      box.y = Math.max(4, box.y);
      // 落点压到实体就翻到另一侧
      if (hitsAny(box)) {
        if (horizontal) box.y = mid.y + 4;
        else box.x = mid.x + 8;
      }
      r.midLabel = box;
    }
  }
}
