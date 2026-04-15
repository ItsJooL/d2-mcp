/**
 * summarizeD2 — generate a structured text summary of a compiled D2 diagram.
 *
 * Takes a compiled Diagram object (from d2.compile().diagram) and returns a
 * human-readable text summary of shapes, connections, and boards (layers/steps/scenarios).
 * This is used by the d2_inspect MCP tool as a fast structural preview that requires
 * no rendering — the compile() call has already done the layout work.
 */

import type { Diagram } from "@terrastruct/d2";

// Shapes whose IDs are D2 internals and should not appear in user-facing output.
const INTERNAL_ID_PATTERNS = [
  /lifeline-end/,
  /-end-\d+/,
];

function isInternal(id: string): boolean {
  return INTERNAL_ID_PATTERNS.some(p => p.test(id));
}

function arrowSymbol(srcArrow: string, dstArrow: string): string {
  const src = srcArrow !== "none" && srcArrow !== "";
  const dst = dstArrow !== "none" && dstArrow !== "";
  if (src && dst) return "<->";
  if (src) return "<-";
  if (dst) return "->";
  return "--";
}

function summarizeShapes(shapes: Diagram["shapes"], baseLevel = 1): string {
  if (!shapes?.length) return "";

  const lines: string[] = [];
  for (const shape of shapes) {
    if (isInternal(shape.id)) continue;

    const indent = "  ".repeat(shape.level - baseLevel);
    const typeTag = shape.type !== "rectangle" ? ` [${shape.type}]` : "";
    // label is only on the Text variant of Shape; Class and SQLTable don't have it
    const rawLabel = "label" in shape ? (shape as { label?: string }).label : undefined;
    const label = rawLabel && rawLabel !== shape.id.split(".").pop()
      ? ` "${rawLabel}"`
      : "";
    lines.push(`${indent}- ${shape.id}${typeTag}${label}`);
  }
  return lines.join("\n");
}

function summarizeConnections(connections: Diagram["connections"]): string {
  if (!connections?.length) return "";

  const lines: string[] = [];
  for (const conn of connections) {
    if (isInternal(conn.src) || isInternal(conn.dst)) continue;

    const arrow = arrowSymbol(conn.srcArrow, conn.dstArrow);
    const label = conn.label ? ` : "${conn.label}"` : "";
    lines.push(`  ${conn.src} ${arrow} ${conn.dst}${label}`);
  }
  return lines.join("\n");
}

function summarizeBoard(diagram: Diagram, name: string, baseLevel = 1): string {
  const sections: string[] = [];

  if (name) sections.push(`Board: ${name}`);

  const shapeSummary = summarizeShapes(diagram.shapes, baseLevel);
  if (shapeSummary) {
    sections.push(`Shapes (${diagram.shapes?.filter(s => !isInternal(s.id)).length ?? 0}):`);
    sections.push(shapeSummary);
  }

  const connSummary = summarizeConnections(diagram.connections);
  if (connSummary) {
    sections.push(`Connections (${diagram.connections?.filter(c => !isInternal(c.src) && !isInternal(c.dst)).length ?? 0}):`);
    sections.push(connSummary);
  }

  return sections.join("\n");
}

export function summarizeD2(diagram: Diagram): string {
  const parts: string[] = [];

  // Root board shapes + connections
  const rootSummary = summarizeBoard(diagram, "");
  if (rootSummary) parts.push(rootSummary);

  // Steps
  const steps = diagram.steps?.filter(Boolean) ?? [];
  if (steps.length > 0) {
    parts.push(`\nSteps (${steps.length}):`);
    for (const step of steps) {
      if (!step) continue;
      parts.push(`\n  Step: ${step.name}`);
      const shapeSummary = summarizeShapes(step.shapes, 1);
      if (shapeSummary) parts.push(shapeSummary.split("\n").map(l => "  " + l).join("\n"));
      const connSummary = summarizeConnections(step.connections);
      if (connSummary) parts.push(connSummary.split("\n").map(l => "  " + l).join("\n"));
    }
  }

  // Layers
  const layers = diagram.layers?.filter(Boolean) ?? [];
  if (layers.length > 0) {
    parts.push(`\nLayers (${layers.length}):`);
    for (const layer of layers) {
      if (!layer) continue;
      parts.push(`\n  Layer: ${layer.name}`);
      const shapeSummary = summarizeShapes(layer.shapes, 1);
      if (shapeSummary) parts.push(shapeSummary.split("\n").map(l => "  " + l).join("\n"));
      const connSummary = summarizeConnections(layer.connections);
      if (connSummary) parts.push(connSummary.split("\n").map(l => "  " + l).join("\n"));
    }
  }

  // Scenarios
  const scenarios = diagram.scenarios?.filter(Boolean) ?? [];
  if (scenarios.length > 0) {
    parts.push(`\nScenarios (${scenarios.length}):`);
    for (const scenario of scenarios) {
      if (!scenario) continue;
      parts.push(`\n  Scenario: ${scenario.name}`);
      const shapeSummary = summarizeShapes(scenario.shapes, 1);
      if (shapeSummary) parts.push(shapeSummary.split("\n").map(l => "  " + l).join("\n"));
      const connSummary = summarizeConnections(scenario.connections);
      if (connSummary) parts.push(connSummary.split("\n").map(l => "  " + l).join("\n"));
    }
  }

  return parts.join("\n");
}
