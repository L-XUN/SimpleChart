/**
 * svg-arch.mjs — 架构图的 SVG 输出
 *
 * 层容器（浅底 + 层名）→ 模块框（名字 + 可选技术栈灰字）→ 依赖连线（带箭头 + 标签）
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

export function archSvg(layout) {
  const T = layout.theme;
  const F = layout.font.size;
  const lh = F * 1.45;
  const techF = Math.round(F * 0.82);
  const techLh = techF * 1.45;
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

  // 层容器（层名竖排在左侧留白带里，永远不会被连线穿过）
  for (const b of layout.arch.bands) {
    out.push(
      `<rect x="${num(b.x)}" y="${num(b.y)}" width="${num(b.w)}" height="${num(b.h)}" rx="10" ry="10" fill="${b.fill}" stroke="${b.stroke}" stroke-width="1.4"/>`
    );
    const lb = b.labelBox;
    const cx = lb.x + lb.w / 2;
    const cy = lb.y + lb.h / 2;
    out.push(
      `<text x="${num(cx)}" y="${num(cy + F * 0.35)}" transform="rotate(-90 ${num(cx)} ${num(cy)})" font-family="${esc(layout.font.family)}" font-size="${F}" fill="${mixText(T)}" text-anchor="middle">${esc(b.name)}</text>`
    );
  }

  // 连线
  for (const l of layout.edges) {
    const d = "M " + l.points.map((p) => `${num(p.x)} ${num(p.y)}`).join(" L ");
    out.push(`<path d="${d}" fill="none" stroke="${T.edge}" stroke-width="${T.edgeWidth}" stroke-linejoin="round"/>`);
    out.push(arrowHead(l.points, T.arrowSize, T.edge));
  }

  // 模块
  for (const m of layout.nodes) {
    out.push(
      `<rect x="${num(m.x)}" y="${num(m.y)}" width="${num(m.w)}" height="${num(m.h)}" rx="6" ry="6" fill="${m.fill}" stroke="${m.stroke}" stroke-width="${T.strokeWidth}"/>`
    );
    const cx = m.textBox.x + m.textBox.w / 2;
    m.nameLines.forEach((line, i) => {
      const baseline = m.textBox.y + i * lh + (lh - F) / 2 + layout.ascent;
      out.push(
        `<text x="${num(cx)}" y="${num(baseline)}" font-family="${esc(layout.font.family)}" font-size="${F}" fill="${m.textFill ?? T.text}" text-anchor="middle">${esc(line)}</text>`
      );
    });
    if (m.techLines.length) {
      const techTop = m.techBox.y;
      m.techLines.forEach((line, i) => {
        const baseline = techTop + i * techLh + (techLh - techF) / 2 + layout.ascent * (techF / F);
        out.push(
          `<text x="${num(cx)}" y="${num(baseline)}" font-family="${esc(layout.font.family)}" font-size="${techF}" fill="${mixText(T)}" text-anchor="middle">${esc(line)}</text>`
        );
      });
    }
  }

  // 连线标签（最上层）
  for (const l of layout.edges) {
    if (!l.labelBox) continue;
    out.push(textWithHalo(l.label, l.labelBox, layout));
  }

  out.push("</svg>");
  return out.join("\n");
}

function mixText(T) {
  // 层名与技术栈用次级灰，弱于模块名
  return T.subtle ?? "#5A6472";
}

function arrowHead(points, size, color) {
  const b = points[points.length - 1];
  let a = points[points.length - 2];
  for (let i = points.length - 2; i >= 0; i--) {
    if (Math.hypot(points[i].x - b.x, points[i].y - b.y) > 1) {
      a = points[i];
      break;
    }
  }
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const half = size * 0.42;
  const p1 = { x: b.x - size * Math.cos(ang) + half * Math.sin(ang), y: b.y - size * Math.sin(ang) - half * Math.cos(ang) };
  const p2 = { x: b.x - size * Math.cos(ang) - half * Math.sin(ang), y: b.y - size * Math.sin(ang) + half * Math.cos(ang) };
  return `<polygon points="${num(b.x)},${num(b.y)} ${num(p1.x)},${num(p1.y)} ${num(p2.x)},${num(p2.y)}" fill="${color}" stroke="none"/>`;
}

function textWithHalo(text, box, layout) {
  const F = layout.font.size;
  const halo = `<rect x="${num(box.x)}" y="${num(box.y)}" width="${num(box.w)}" height="${num(box.h)}" fill="${layout.theme.bg}"/>`;
  const tx = box.x + box.w / 2;
  const ty = box.y + box.h / 2 + F * 0.35;
  const label = `<text x="${num(tx)}" y="${num(ty)}" font-family="${esc(layout.font.family)}" font-size="${F}" fill="${layout.theme.text}" text-anchor="middle">${esc(text)}</text>`;
  return `${halo}\n${label}`;
}
