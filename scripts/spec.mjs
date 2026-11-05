/**
 * spec.mjs — 类型路由
 *
 * 这是 render.mjs / check.mjs 唯一的入口：按 spec.type 决定用哪个排版模块。
 * 加一种新图 = 加一个 layout-xxx.mjs + 下面登记两行，其余代码一律不动。
 */
import { buildLayout as buildFlowOrMindmap } from "./layout.mjs";
import { buildSequence } from "./layout-sequence.mjs";
import { buildEr } from "./layout-er.mjs";
import { buildArch } from "./layout-arch.mjs";

const TYPE_ALIASES = {
  flowchart: "flowchart",
  flow: "flowchart",
  流程图: "flowchart",
  流程: "flowchart",
  mindmap: "mindmap",
  mind: "mindmap",
  思维导图: "mindmap",
  脑图: "mindmap",
  sequence: "sequence",
  seq: "sequence",
  时序图: "sequence",
  时序: "sequence",
  er: "er",
  "er图": "er",
  erd: "er",
  实体关系: "er",
  实体关系图: "er",
  表结构: "er",
  arch: "arch",
  architecture: "arch",
  架构图: "arch",
  架构: "arch",
  分层图: "arch",
};

export const SUPPORTED_TYPES = ["flowchart", "mindmap", "sequence", "er", "arch"];

export function resolveType(spec) {
  const raw = String(spec?.type ?? "flowchart").trim();
  const type = TYPE_ALIASES[raw.toLowerCase()] ?? TYPE_ALIASES[raw];
  if (!type) {
    throw new Error(`不支持的 type: ${JSON.stringify(spec?.type)}（可用：${SUPPORTED_TYPES.join(" / ")}，也认中文名）`);
  }
  return type;
}

export function buildLayout(spec) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) throw new Error("spec 必须是一个 JSON 对象");
  const type = resolveType(spec);
  if (type === "sequence") return buildSequence(spec);
  if (type === "er") return buildEr(spec);
  if (type === "arch") return buildArch(spec);
  return buildFlowOrMindmap({ ...spec, type });
}
