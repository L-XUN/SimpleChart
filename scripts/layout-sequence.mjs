/**
 * layout-sequence.mjs — 时序图排版（谁和谁在什么时候说了什么）
 *
 * 与流程图完全不同的拓扑：没有 row/col 网格，靠"参与者列 + 消息行"。
 * 共用 layout.mjs 的环境（主题、字体、量字、行高），自己的几何自己算。
 */
import { DEFAULTS, createContext, finishLayout, wrapText } from "./layout.mjs";

const STYLE_ALIASES = {
  sync: "sync",
  同步: "sync",
  async: "async",
  异步: "async",
  return: "return",
  返回: "return",
  reply: "return",
  虚线: "return",
};

export function normalizeStyle(style, isSelf) {
  if (isSelf) return "self";
  const raw = String(style ?? "sync").trim();
  return STYLE_ALIASES[raw.toLowerCase()] ?? STYLE_ALIASES[raw] ?? "sync";
}

/** 对外入口：spec → layout（结构与 flowchart/mindmap 完全一致，render/check 不用改） */
export function buildSequence(spec) {
  const env = createContext(spec);
  return finishLayout(placeSequence(spec, env.ctx), env, "sequence");
}

function placeSequence(spec, ctx) {
  const F = ctx.fontSize;
  const lh = ctx.lh;

  // --- 参与者 ---
  const actorsIn = Array.isArray(spec.actors) ? spec.actors : [];
  if (actorsIn.length < 2) throw new Error("sequence 需要 actors 数组，至少 2 个参与者");

  const seen = new Set();
  const actors = actorsIn.map((a, i) => {
    const id = String(a.id ?? `a${i + 1}`);
    if (seen.has(id)) throw new Error(`参与者 id 重复: ${id}`);
    seen.add(id);
    const name = String(a.name ?? a.text ?? `参与者${i + 1}`).trim();
    const lines = wrapText(name, 120, ctx.measure, F);
    const textW = Math.max(...lines.map((l) => ctx.measure(l, F)), 1);
    const textH = lines.length * lh;
    return {
      id,
      name,
      text: name, // 让通用检查（标签非空）也能识别
      lines,
      textW,
      textH,
      w: Math.round(textW + DEFAULTS.padX * 2 + 12),
      h: Math.round(textH + DEFAULTS.padY * 2 + 6),
      shape: "process", // 复用 check.mjs 的矩形内切检查
      fill: a.fill ?? ctx.theme.palette.actor ?? "#EEF3FF",
      stroke: a.stroke ?? ctx.theme.stroke,
      textFill: ctx.theme.text,
    };
  });

  // --- 消息 ---
  const messagesIn = Array.isArray(spec.messages) ? spec.messages : [];
  if (messagesIn.length === 0) throw new Error("sequence 需要 messages 数组");
  const byId = new Map(actors.map((a) => [a.id, a]));

  const messages = messagesIn.map((m, i) => {
    const from = byId.get(String(m.from));
    const to = byId.get(String(m.to));
    if (!from || !to) throw new Error(`第 ${i + 1} 条消息引用了不存在的参与者: ${m.from} -> ${m.to}`);
    const label = String(m.label ?? "").trim();
    return {
      index: i,
      from: from.id,
      to: to.id,
      fromActor: from,
      toActor: to,
      self: from.id === to.id,
      style: normalizeStyle(m.style, from.id === to.id),
      label,
      labelW: label ? ctx.measure(label, F) : 0,
    };
  });

  // --- 横向：列距固定，保证箭头够长好看 ---
  // 消息标签允许压过生命线（标准画法，标签底下有背景色挖空），
  // 所以列距不跟标签宽度走，否则图会被撑得又宽又空。
  const GAP = 112;
  const gaps = [];
  for (let i = 0; i < actors.length - 1; i++) gaps.push(GAP);

  let x = DEFAULTS.margin;
  actors.forEach((a, i) => {
    if (i > 0) x += gaps[i - 1];
    a.x = Math.round(x);
    a.cx = a.x + a.w / 2;
    x += a.w;
  });

  // --- 纵向 ---
  const title = spec.title ? String(spec.title) : "";
  const titleSize = Math.round(F * DEFAULTS.titleSize);
  const titleH = title ? Math.round(titleSize * 2.2) : 0;
  const headerTop = DEFAULTS.margin + titleH;
  const headerH = Math.max(...actors.map((a) => a.h));
  for (const a of actors) {
    a.y = headerTop;
    a.h = headerH; // 统一高度，视觉整齐
    a.textBox = { x: a.x + (a.w - a.textW) / 2, y: a.y + (headerH - a.textH) / 2, w: a.textW, h: a.textH };
  }

  let cursor = headerTop + headerH + 34;
  for (const m of messages) {
    const labelH = m.label ? lh : 0;
    m.y = cursor + labelH + (m.label ? 6 : 0); // 箭头所在 y
    m.fromCx = m.fromActor.cx;
    m.toCx = m.toActor.cx;
    if (m.label) {
      if (m.self) {
        m.labelBox = { x: m.fromCx + 40, y: m.y + 13 - lh / 2, w: m.labelW + 8, h: lh };
      } else {
        const mid = (m.fromCx + m.toCx) / 2;
        m.labelBox = { x: mid - (m.labelW + 8) / 2, y: m.y - lh - 6, w: m.labelW + 8, h: lh };
      }
      m.labelBox.x = Math.max(4, m.labelBox.x); // 长标签别被左边裁掉
    }
    cursor = m.y + (m.self ? 26 : 0) + 26;
  }

  const lifelineTop = headerTop + headerH;
  const lifelineBottom = cursor + 6;
  const lifelines = actors.map((a) => ({ id: a.id, x: a.cx, y0: lifelineTop, y1: lifelineBottom }));

  // --- 画布 ---
  const inkRight = Math.max(
    ...actors.map((a) => a.x + a.w),
    ...messages.filter((m) => m.labelBox).map((m) => m.labelBox.x + m.labelBox.w),
    ...messages.filter((m) => m.self).map((m) => m.fromCx + 30)
  );
  const width = Math.round(inkRight + DEFAULTS.margin);
  const height = Math.round(lifelineBottom + DEFAULTS.margin);

  // 供像素自检用：消息标签也是"必须真的画上去"的东西
  const inkBoxes = messages
    .filter((m) => m.label && m.labelBox)
    .map((m) => ({ id: `msg${m.index + 1}`, box: m.labelBox, fill: ctx.theme.bg }));

  return {
    width,
    height,
    title,
    titleSize,
    titleAnchor: { x: DEFAULTS.margin, y: DEFAULTS.margin + titleSize },
    nodes: actors,
    edges: [], // 时序图没有"折线边"，渲染走 svg-sequence.mjs
    inkBoxes,
    sequence: { messages, lifelines, headerH },
  };
}