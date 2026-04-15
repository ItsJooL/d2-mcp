/**
 * Tests for d2_inspect — the summarizeD2 function that generates a
 * structured text summary of a compiled D2 diagram.
 *
 * Run: node test-inspect.mjs
 *
 * Tests run against the compiled diagram object directly (no MCP layer),
 * matching how the MCP tool will call summarizeD2(result.diagram).
 */

import { D2 } from "@terrastruct/d2";

const d2 = new D2();

let passed = 0;
let failed = 0;

function ok(label) {
  console.log(`  ✓ ${label}`);
  passed++;
}

function fail(label, detail) {
  console.error(`  ✗ ${label}: ${detail}`);
  failed++;
}

async function test(label, fn) {
  process.stdout.write(`\n[${label}]\n`);
  try {
    await fn();
  } catch (e) {
    fail("unexpected throw", e?.message ?? e);
  }
}

// Import the function under test.
// It is exported from src/inspect.ts (compiled to dist/inspect.js).
const { summarizeD2 } = await import("./dist/inspect.js");

// ── helpers ──────────────────────────────────────────────────────────────────

async function compile(code, opts = {}) {
  return d2.compile(code, { options: opts });
}

// ── RED: write tests that describe the desired behaviour ──────────────────────

await test("flat diagram — shapes and connections", async () => {
  const result = await compile("a -> b: hello\nb -> c: world");
  const summary = summarizeD2(result.diagram);

  if (typeof summary === "string") ok("returns a string");
  else { fail("return type", `got ${typeof summary}`); return; }

  if (summary.includes("Shapes")) ok("has Shapes section");
  else fail("Shapes section", summary);

  if (summary.includes("Connections")) ok("has Connections section");
  else fail("Connections section", summary);

  if (summary.includes("a") && summary.includes("b") && summary.includes("c"))
    ok("all shape IDs present");
  else fail("shape IDs", summary);

  if (summary.includes("a") && summary.includes("b") && summary.includes("hello"))
    ok("connection label present");
  else fail("connection label", summary);
});

await test("nested containers — level indentation", async () => {
  const result = await compile(`
cp: {
  label: "Control Plane"
  listener: "API Gateway"
  grpc: "gRPC Server"
  listener -> grpc: route
}
agent: {
  label: "Data Plane Agent"
  stream: "gRPC Client"
}
cp.grpc -> agent.stream: "mirror request"
`);
  const summary = summarizeD2(result.diagram);

  // Containers should appear at a shallower indent than their children
  const lines = summary.split("\n");
  const cpLine = lines.find(l => l.includes("cp") && !l.includes("."));
  const listenerLine = lines.find(l => l.includes("cp.listener"));
  if (cpLine && listenerLine) {
    const cpIndent = cpLine.match(/^ */)[0].length;
    const listenerIndent = listenerLine.match(/^ */)[0].length;
    if (listenerIndent > cpIndent) ok("child shapes indented deeper than parent");
    else fail("indentation", `cp indent=${cpIndent}, listener indent=${listenerIndent}`);
  } else fail("container lines not found", summary);

  if (summary.includes("cp.grpc") && summary.includes("agent.stream"))
    ok("cross-container connection IDs present");
  else fail("cross-container connections", summary);

  if (summary.includes("Control Plane"))
    ok("container label shown");
  else fail("container label", summary);
});

await test("shape types — non-rectangle types surfaced", async () => {
  const result = await compile(`
db: { shape: cylinder }
queue: { shape: queue }
users: {
  shape: sql_table
  id: int {constraint: primary_key}
}
`);
  const summary = summarizeD2(result.diagram);

  if (summary.includes("cylinder")) ok("cylinder type shown");
  else fail("cylinder", summary);

  if (summary.includes("sql_table")) ok("sql_table type shown");
  else fail("sql_table", summary);
});

await test("sequence diagram — actors and messages", async () => {
  const result = await compile(`
flow: {
  shape: sequence_diagram
  client; server; db
  client -> server: "POST /login"
  server -> db: "SELECT user"
  db -> server: "user record"
  server -> client: "200 OK"
}
`);
  const summary = summarizeD2(result.diagram);

  if (summary.includes("sequence_diagram")) ok("sequence_diagram type shown");
  else fail("sequence_diagram type", summary);

  if (summary.includes("client") && summary.includes("server") && summary.includes("db"))
    ok("actor IDs present");
  else fail("actor IDs", summary);

  if (summary.includes("POST /login") && summary.includes("200 OK"))
    ok("message labels present");
  else fail("message labels", summary);

  // Lifeline end internals should NOT pollute the summary
  if (!summary.includes("lifeline-end"))
    ok("internal lifeline-end nodes filtered out");
  else fail("lifeline-end filter", "internal nodes leaked into summary");
});

await test("ER diagram — sql_table shapes and FK connections", async () => {
  const result = await compile(`
users: {
  shape: sql_table
  id: int {constraint: primary_key}
  email: varchar {constraint: unique}
  org_id: int {constraint: foreign_key}
}
orgs: {
  shape: sql_table
  id: int {constraint: primary_key}
  name: varchar
}
users.org_id -> orgs.id
`);
  const summary = summarizeD2(result.diagram);

  if (summary.includes("users") && summary.includes("orgs"))
    ok("table names present");
  else fail("table names", summary);

  // D2 compiles column-level FK syntax (users.org_id -> orgs.id) down to
  // a table-level connection (users -> orgs) in the diagram object.
  if (summary.includes("users") && summary.includes("orgs"))
    ok("FK connection tables present");
  else fail("FK tables", summary);
});

await test("steps — each step summarized", async () => {
  const result = await compile(`
steps: {
  s1: { user }
  s2: { user -> web }
  s3: { user -> web -> db }
}
`);
  const summary = summarizeD2(result.diagram);

  if (summary.includes("steps") || summary.includes("Step") || summary.includes("s1"))
    ok("steps section present");
  else fail("steps section", summary);

  if (summary.includes("s1") && summary.includes("s2") && summary.includes("s3"))
    ok("all step names present");
  else fail("step names", summary);
});

await test("layers — each layer summarized", async () => {
  const result = await compile(`
layers: {
  overview: {
    web -> app -> db
  }
  detailed: {
    web: "Nginx"
    web -> app: "HTTP/1.1"
  }
}
`);
  const summary = summarizeD2(result.diagram);

  if (summary.includes("layer") || summary.includes("Layer") || summary.includes("overview"))
    ok("layers section present");
  else fail("layers section", summary);

  if (summary.includes("overview") && summary.includes("detailed"))
    ok("layer names present");
  else fail("layer names", summary);
});

await test("connection arrows — direction shown", async () => {
  const result = await compile(`
a -> b: forward
b <- a: reverse
a <-> b: bidi
a -- b: undirected
`);
  const summary = summarizeD2(result.diagram);

  // All four connections should appear
  if (summary.includes("forward")) ok("forward arrow label present");
  else fail("forward arrow", summary);

  if (summary.includes("bidi") || summary.includes("<->"))
    ok("bidirectional connection present");
  else fail("bidi connection", summary);
});

await test("empty diagram — graceful output", async () => {
  const result = await compile("a");
  const summary = summarizeD2(result.diagram);

  if (typeof summary === "string" && summary.length > 0)
    ok("returns non-empty string for single shape");
  else fail("empty diagram output", summary);

  if (summary.includes("a")) ok("single shape ID present");
  else fail("single shape", summary);
});

await test("large diagram — character limit respected", async () => {
  // Build a diagram with many shapes
  const shapes = Array.from({ length: 30 }, (_, i) => `node${i}`).join("\n");
  const connections = Array.from({ length: 29 }, (_, i) => `node${i} -> node${i + 1}`).join("\n");
  const result = await compile(`${shapes}\n${connections}`);
  const summary = summarizeD2(result.diagram);

  if (summary.length < 10_000)
    ok(`summary is concise (${summary.length} chars for 30-node diagram)`);
  else fail("summary too large", `${summary.length} chars`);
});

// ── summary ───────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
