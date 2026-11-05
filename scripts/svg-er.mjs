/**
 * svg-er.mjs — ER 图的 SVG 输出
 *
 * 实体 = 表头 + 字段行；关系 = 无箭头的折线 + 两端基数 + 动词。
 */
const num = (v) => Math.round(v * 100) / 100;

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function erSvg(layout) {
  const T = layout.theme;
  const F = layout.font.size;
  const lh = F * 1.45;
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

  // 关系线（先画线，实体框会压住端头）
  for (const r of layout.er.relations) {
    const d = "M " + r.points.map((p) => `${num(p.x)} ${num(p.y)}`).join(" L ");
    out.push(`<path d="${d}" fill="none" stroke="${T.edge}" stroke-width="${T.edgeWidth}" stroke-linejoin="round"/>`);
  }

  // 实体（表头 + 字段）
  for (const e of layout.nodes) {
    out.push(
      `<rect x="${num(e.x)}" y="${num(e.y)}" width="${num(e.w)}" height="${num(e.h)}" rx="4" ry="4" fill="${e.fill}" stroke="${e.stroke}" stroke-width="${T.strokeWidth}"/>`
    );
    // 表头底色 + 分隔线
    out.push(
      `<path d="M ${num(e.x)} ${num(e.y + e.headerH)} H ${num(e.x + e.w)}" stroke="${e.stroke}" stroke-width="${T.strokeWidth}" fill="none"/>`
    );
    const cx = e.textBox.x + e.textBox.w / 2;
    e.headerLines.forEach((line, i) => {
      const baseline = e.textBox.y + i * lh + (lh - F) / 2 + layout.ascent;
      out.push(
        `<text x="${num(cx)}" y="${num(baseline)}" font-family="${esc(layout.font.family)}" font-size="${F}" fill="${e.textFill ?? T.text}" text-anchor="middle" font-weight="600">${esc(line)}</text>`
      );
    });
    e.fields.forEach((f, i) => {
      const box = e.fieldBoxes[i].box;
      const baseline = box.y + (lh - F) / 2 + layout.ascent;
      out.push(
        `<text x="${num(box.x)}" y="${num(baseline)}" font-family="${esc(layout.font.family)}" font-size="${F}" fill="${e.textFill ?? T.text}">${esc(f.text)}</text>`
      );
    });
  }

  // 基数与关系动词（最上层，带背景挖空）
  for (const r of layout.er.relations) {
    for (const c of r.cardLabels) out.push(textWithHalo(c.text, c.box, layout));
    if (r.midLabel) out.push(textWithHalo(r.label, r.midLabel, layout));
  }

  out.push("</svg>");
  return out.join("\n");
}

function textWithHalo(text, box, layout) {
  const F = layout.font.size;
  const halo = `<rect x="${num(box.x)}" y="${num(box.y)}" width="${num(box.w)}" height="${num(box.h)}" fill="${layout.theme.bg}"/>`;
  const tx = box.x + box.w / 2;
  const ty = box.y + box.h / 2 + F * 0.35;
  const label = `<text x="${num(tx)}" y="${num(ty)}" font-family="${esc(layout.font.family)}" font-size="${F}" fill="${layout.theme.text}" text-anchor="middle">${esc(text)}</text>`;
  return `${halo}\n${label}`;
}
