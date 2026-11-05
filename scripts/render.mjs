/**
 * render.mjs — 把 spec.json 画成 PNG（顺带留一份 SVG）
 *
 * 用法：
 *   node render.mjs spec.json [out.png] [--scale 2]
 *
 * 流程：spec → layout（量字、排版、布线）→ SVG → PNG（sharp/librsvg）
 *       画完自动跑几何自检 + 像素自检，任何一项 FAIL 就以退出码 1 结束。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULTS, requireOptional } from "./layout.mjs";
import { buildLayout } from "./spec.mjs";
import { sequenceSvg } from "./svg-sequence.mjs";
import { erSvg } from "./svg-er.mjs";
import { archSvg } from "./svg-arch.mjs";
import { runChecks, pixelChecks, formatReport } from "./check.mjs";

const num = (v) => Math.round(v * 100) / 100;

/** 按类型选绘制器：加新类型时，这里加一行 */
function svgFor(layout) {
  if (layout.type === "sequence") return sequenceSvg(layout);
  if (layout.type === "er") return erSvg(layout);
  if (layout.type === "arch") return archSvg(layout);
  return toSvg(layout);
}

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---------------------------------------------------------------------------
// SVG 拼装
// ---------------------------------------------------------------------------
function toSvg(layout) {
  const T = layout.theme;
  const family = layout.font.family;
  const out = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}">`
  );
  out.push(`<rect x="0" y="0" width="${layout.width}" height="${layout.height}" fill="${T.bg}"/>`);

  if (layout.title) {
    out.push(
      `<text x="${num(layout.titleAnchor.x)}" y="${num(layout.titleAnchor.y)}" font-family="${esc(family)}" font-size="${layout.titleSize}" fill="${T.text}" font-weight="600">${esc(layout.title)}</text>`
    );
  }

  // 先画连线，再画框：框是不透明的，会把端头收干净
  for (const e of layout.edges) out.push(edgeSvg(e, layout));
  for (const n of layout.nodes) out.push(shapeSvg(n, layout));
  for (const n of layout.nodes) out.push(...nodeTextSvg(n, layout));
  for (const e of layout.edges) if (e.label) out.push(edgeLabelSvg(e, layout));

  out.push("</svg>");
  return out.join("\n");
}

function shapeSvg(n, layout) {
  const T = layout.theme;
  const paint = `fill="${n.fill}" stroke="${n.stroke}" stroke-width="${T.strokeWidth}" stroke-linejoin="round"`;
  const { x, y, w, h } = n;

  if (n.shape === "decision") {
    const pts = [
      [x + w / 2, y],
      [x + w, y + h / 2],
      [x + w / 2, y + h],
      [x, y + h / 2],
    ];
    return `<polygon points="${pts.map((p) => p.map(num).join(",")).join(" ")}" ${paint}/>`;
  }
  if (n.shape === "io") {
    const s = DEFAULTS.slant;
    const pts = [
      [x + s, y],
      [x + w, y],
      [x + w - s, y + h],
      [x, y + h],
    ];
    return `<polygon points="${pts.map((p) => p.map(num).join(",")).join(" ")}" ${paint}/>`;
  }
  const rx = n.shape === "start" || n.shape === "end" ? h / 2 : n.shape === "subprocess" ? 12 : 4;
  return `<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" rx="${num(rx)}" ry="${num(rx)}" ${paint}/>`;
}

function nodeTextSvg(n, layout) {
  const F = layout.font.size;
  const lh = F * DEFAULTS.lineHeightRatio;
  const cx = n.textBox.x + n.textBox.w / 2;
  const fill = n.textFill ?? layout.theme.text;
  return n.lines.map((line, i) => {
    const baseline = n.textBox.y + i * lh + (lh - F) / 2 + layout.ascent;
    return `<text x="${num(cx)}" y="${num(baseline)}" font-family="${esc(layout.font.family)}" font-size="${F}" fill="${fill}" text-anchor="middle">${esc(line)}</text>`;
  });
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

function edgeSvg(e, layout) {
  const T = layout.theme;
  const color = e.color ?? T.edge;
  const isCurve = e.kind === "curve";
  const d = isCurve
    ? `M ${num(e.points[0].x)} ${num(e.points[0].y)} C ${num(e.points[1].x)} ${num(e.points[1].y)} ${num(e.points[2].x)} ${num(e.points[2].y)} ${num(e.points[3].x)} ${num(e.points[3].y)}`
    : "M " + e.points.map((p) => `${num(p.x)} ${num(p.y)}`).join(" L ");
  const width = isCurve ? T.strokeWidth : T.edgeWidth;
  const body = `<path d="${d}" fill="none" stroke="${color}" stroke-width="${num(width)}" stroke-linejoin="round"/>`;
  // 思维导图是层级关系，不加箭头（呼应"只用线条连接"的规则）
  return isCurve ? body : `${body}\n${arrowHead(e.points, T.arrowSize, color)}`;
}

function edgeLabelSvg(e, layout) {
  const F = layout.font.size;
  const b = e.labelBox;
  const halo = `<rect x="${num(b.x)}" y="${num(b.y)}" width="${num(b.w)}" height="${num(b.h)}" fill="${layout.theme.bg}"/>`;
  const ty = b.y + b.h / 2 + F * 0.35;
  const text = `<text x="${num(b.x + 4)}" y="${num(ty)}" font-family="${esc(layout.font.family)}" font-size="${F}" fill="${layout.theme.text}">${esc(e.label)}</text>`;
  return `${halo}\n${text}`;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const positional = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--scale");
  const specPath = positional[0];
  if (!specPath) {
    console.error("用法: node render.mjs <spec.json> [out.png] [--scale 2]");
    process.exit(2);
  }
  const scaleArg = args.indexOf("--scale");
  const scale = scaleArg >= 0 ? Number(args[scaleArg + 1]) || 1 : 1;
  if (!(scale >= 1 && scale <= 4)) {
    console.error("--scale 只支持 1~4");
    process.exit(2);
  }

  const spec = JSON.parse(readFileSync(resolve(specPath), "utf8").replace(/^\uFEFF/, ""));
  const layout = buildLayout(spec);
  if (layout.warnings?.length) for (const w of layout.warnings) console.error(`注意: ${w}`);

  const outPath = resolve(positional[1] ?? specPath.replace(/\.json$/i, "") + ".png");
  if (!existsSync(dirname(outPath))) mkdirSync(dirname(outPath), { recursive: true });

  const svg = svgFor(layout);
  const svgPath = outPath.replace(/\.png$/i, "") + ".svg";
  writeFileSync(svgPath, svg, "utf8");

  const sharp = requireOptional("sharp");
  if (!sharp) {
    console.error(`没找到 sharp，PNG 没生成。SVG 已写入：${svgPath}`);
    console.error("Plan B：用无头 Edge 截图 —— msedge --headless=new --disable-gpu --screenshot=\"out.png\" --window-size=W,H \"file:///<绝对路径>/x.svg\"");
    process.exit(2);
  }

  const png = await sharp(Buffer.from(svg), { density: 72 * scale }).png({ compressionLevel: 9 }).toBuffer();
  writeFileSync(outPath, png);

  const result = runChecks(spec, layout);
  const items = result.items.concat(await pixelChecks(outPath, layout, scale));
  const report = formatReport(`simplechart 出图 · ${specPath}`, result, items);
  console.log(report);
  console.log(`  产物：${outPath}${scale > 1 ? `（${scale}x）` : ""}、${svgPath}`);

  process.exit(items.some((i) => i.level === "FAIL") ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`出图失败: ${err.message}`);
    process.exit(2);
  });
}
