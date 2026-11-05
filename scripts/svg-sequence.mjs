/**
 * svg-sequence.mjs — 时序图的 SVG 输出
 *
 * 时序图不是"框 + 折线"，所以单独一份绘制代码；
 * 输出的还是同一套 layout 结构（nodes / sequence.messages / sequence.lifelines）。
 */
import { mix } from "./layout.mjs";

const num = (v) => Math.round(v * 100) / 100;

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function head(x, y, dirX, size, color, filled) {
  // 箭头：dirX = -1 指向左，+1 指向右
  const half = size * 0.42;
  const tip = `${num(x)},${num(y)}`;
  const bx = x + dirX * -1 * size; // 箭尾
  if (filled) {
    return `<polygon points="${tip} ${num(bx)},${num(y - half)} ${num(bx)},${num(y + half)}" fill="${color}" stroke="none"/>`;
  }
  return `<path d="M ${num(bx)} ${num(y - half)} L ${tip} L ${num(bx)} ${num(y + half)}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"/>`;
}

export function sequenceSvg(layout) {
  const T = layout.theme;
  const seq = layout.sequence;
  const out = [];

  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}">`
  );
  out.push(`<rect x="0" y="0" width="${layout.width}" height="${layout.height}" fill="${T.bg}"/>`);

  if (layout.title) {
    out.push(
      `<text x="${num(layout.titleAnchor.x)}" y="${num(layout.titleAnchor.y)}" font-family="${esc(layout.font.family)}" font-size="${layout.titleSize}" fill="${T.text}" font-weight="600">${esc(layout.title)}</text>`
    );
  }

  // 生命线（虚线）
  const lifeColor = mix(T.edge, T.bg, 0.45);
  for (const L of seq.lifelines) {
    out.push(
      `<line x1="${num(L.x)}" y1="${num(L.y0)}" x2="${num(L.x)}" y2="${num(L.y1)}" stroke="${lifeColor}" stroke-width="1.6" stroke-dasharray="7 5"/>`
    );
  }

  // 消息
  for (const m of seq.messages) out.push(messageSvg(m, layout));

  // 参与者框（画在最上层，压住生命线顶端）
  for (const a of layout.nodes) out.push(actorSvg(a, layout));

  // 消息标签（带背景色挖空，避免压住生命线）
  for (const m of seq.messages) if (m.label) out.push(labelSvg(m, layout));

  out.push("</svg>");
  return out.join("\n");
}

function actorSvg(a, layout) {
  const T = layout.theme;
  const F = layout.font.size;
  const lh = F * 1.45;
  const body = `<rect x="${num(a.x)}" y="${num(a.y)}" width="${num(a.w)}" height="${num(a.h)}" rx="8" ry="8" fill="${a.fill}" stroke="${a.stroke}" stroke-width="${T.strokeWidth}"/>`;
  const cx = a.textBox.x + a.textBox.w / 2;
  const lines = a.lines.map((line, i) => {
    const baseline = a.textBox.y + i * lh + (lh - F) / 2 + layout.ascent;
    return `<text x="${num(cx)}" y="${num(baseline)}" font-family="${esc(layout.font.family)}" font-size="${F}" fill="${a.textFill ?? T.text}" text-anchor="middle">${esc(line)}</text>`;
  });
  return [body, ...lines].join("\n");
}

function messageSvg(m, layout) {
  const T = layout.theme;
  const color = T.edge;
  const dashed = m.style === "return";
  const dash = dashed ? ` stroke-dasharray="7 5"` : "";

  if (m.self) {
    const x = m.fromCx;
    const y = m.y;
    const right = x + 30;
    const bottom = y + 26;
    const body = `<path d="M ${num(x)} ${num(y)} H ${num(right)} V ${num(bottom)} H ${num(x)}" fill="none" stroke="${color}" stroke-width="${T.edgeWidth}" stroke-linejoin="round"${dash}/>`;
    return `${body}\n${head(x, bottom, -1, T.arrowSize, color, !dashed)}`;
  }

  const dir = m.toCx > m.fromCx ? 1 : -1;
  const tipX = m.toCx;
  const tailX = tipX - dir * (T.arrowSize + 1); // 线别顶穿箭头
  const body = `<line x1="${num(m.fromCx)}" y1="${num(m.y)}" x2="${num(tailX)}" y2="${num(m.y)}" stroke="${color}" stroke-width="${T.edgeWidth}"${dash}/>`;
  return `${body}\n${head(tipX, m.y, dir, T.arrowSize, color, m.style === "sync")}`;
}

function labelSvg(m, layout) {
  const F = layout.font.size;
  const b = m.labelBox;
  const halo = `<rect x="${num(b.x)}" y="${num(b.y)}" width="${num(b.w)}" height="${num(b.h)}" fill="${layout.theme.bg}"/>`;
  const tx = b.x + b.w / 2;
  const ty = b.y + b.h / 2 + F * 0.35;
  const text = `<text x="${num(tx)}" y="${num(ty)}" font-family="${esc(layout.font.family)}" font-size="${F}" fill="${layout.theme.text}" text-anchor="middle">${esc(m.label)}</text>`;
  return `${halo}\n${text}`;
}
