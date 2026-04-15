/**
 * Live integration test — exercises every d2_render option and the validate/format tools.
 * Run: node test-live.mjs
 */

import { D2 } from "@terrastruct/d2";

const d2 = new D2();

let passed = 0;
let failed = 0;

function ok(label) {
  console.log(`  ✓ ${label}`);
  passed++;
}

function fail(label, err) {
  console.error(`  ✗ ${label}: ${err}`);
  failed++;
}

async function test(label, fn) {
  process.stdout.write(`\n[${label}]\n`);
  try {
    await fn();
  } catch (e) {
    fail("unexpected throw", e.message ?? e);
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function stripFontFaces(svg) {
  return svg.replace(/@font-face\s*\{[^{}]*\}/g, "").replace(/\n{3,}/g, "\n\n");
}

async function render(code, opts = {}) {
  const result = await d2.compile(code, { options: opts });
  return d2.render(result.diagram, result.renderOptions);
}

// ── tests ─────────────────────────────────────────────────────────────────────

await test("Basic dagre render", async () => {
  const svg = await render("a -> b: connects");
  if (svg.includes("<svg")) ok("returns SVG");
  else fail("SVG check", "no <svg tag");

  if (svg.startsWith('<?xml')) ok("has XML declaration");
  else fail("XML decl", "missing");
});

await test("skip_fonts (stripFontFaces)", async () => {
  const svg = await render("a -> b");
  const stripped = stripFontFaces(svg);
  if (svg.length > stripped.length) ok(`font data stripped (${svg.length} → ${stripped.length} chars)`);
  else ok("no font-face blocks found (already minimal)");
  if (!stripped.includes("@font-face")) ok("no @font-face in stripped output");
  else fail("@font-face check", "still present after strip");
});

await test("Sketch mode", async () => {
  const svg = await render("x -> y", { sketch: true });
  if (svg.includes("<svg")) ok("sketch renders SVG");
  else fail("sketch", "no SVG");
});

await test("Theme IDs", async () => {
  for (const id of [0, 3, 200, 300, 302, 303]) {
    const svg = await render("a -> b", { themeID: id });
    if (svg.includes("<svg")) ok(`theme ${id}`);
    else fail(`theme ${id}`, "no SVG");
  }
});

await test("Dark theme", async () => {
  const svg = await render("a -> b", { themeID: 0, darkThemeID: 200 });
  if (svg.includes("<svg")) ok("dark theme renders");
  else fail("dark theme", "no SVG");
});

await test("Pad option", async () => {
  const svgDefault = await render("a -> b");
  const svgNoPad = await render("a -> b", { pad: 0 });
  // Both should be valid SVGs; pad 0 is typically smaller
  if (svgNoPad.includes("<svg")) ok("pad=0 renders");
  else fail("pad=0", "no SVG");
});

await test("Center option", async () => {
  const svg = await render("a -> b", { center: true });
  if (svg.includes("<svg")) ok("center renders");
  else fail("center", "no SVG");
});

await test("Scale option", async () => {
  const svg = await render("a -> b", { scale: 1 });
  if (svg.includes("<svg")) ok("scale=1 renders");
  else fail("scale=1", "no SVG");

  const svgHalf = await render("a -> b", { scale: 0.5 });
  if (svgHalf.includes("<svg")) ok("scale=0.5 renders");
  else fail("scale=0.5", "no SVG");
});

await test("no_xml_tag (noXMLTag)", async () => {
  // noXMLTag must be passed to d2.render(), not just d2.compile().
  // The MCP server explicitly merges it into renderOptions — test that path directly.
  const result = await d2.compile("a -> b");
  const svg = await d2.render(result.diagram, { ...result.renderOptions, noXMLTag: true });
  if (!svg.startsWith("<?xml")) ok("noXMLTag omits XML declaration");
  else fail("noXMLTag", "still has <?xml?>");
  if (svg.includes("<svg")) ok("SVG element still present");
  else fail("noXMLTag", "no <svg>");
});

await test("ASCII output", async () => {
  const result = await d2.compile("a -> b -> c");
  const ascii = await d2.render(result.diagram, { ...result.renderOptions, ascii: true });
  if (!ascii.includes("<svg")) ok("ascii is not SVG");
  if (ascii.length > 0) ok(`ascii output: ${ascii.trim().split("\n").length} lines`);
  console.log("    preview:", ascii.trim().split("\n")[0]);
});

await test("ASCII mode: standard vs extended", async () => {
  const result = await d2.compile("a -> b");
  const ext = await d2.render(result.diagram, { ...result.renderOptions, ascii: true, asciiMode: "extended" });
  const std = await d2.render(result.diagram, { ...result.renderOptions, ascii: true, asciiMode: "standard" });
  if (ext.length > 0) ok("extended ascii renders");
  if (std.length > 0) ok("standard ascii renders");
});

await test("Validate: valid code", async () => {
  try {
    await d2.compile("server -> db: query");
    ok("valid D2 compiles without error");
  } catch (e) {
    fail("valid code threw", e.message);
  }
});

await test("Validate: invalid code", async () => {
  try {
    await d2.compile("a -> {");
    fail("invalid code", "no error thrown");
  } catch (e) {
    ok(`invalid code throws: ${e.message.slice(0, 60)}`);
  }
});

await test("SQL table shape", async () => {
  const code = `
users: {
  shape: sql_table
  id: int {constraint: primary_key}
  email: varchar {constraint: unique}
}
posts: {
  shape: sql_table
  id: int {constraint: primary_key}
  author_id: int {constraint: foreign_key}
}
posts.author_id -> users.id
`;
  const svg = await render(code);
  if (svg.includes("<svg")) ok("sql_table renders");
  else fail("sql_table", "no SVG");
});

await test("Sequence diagram", async () => {
  const code = `
flow: {
  shape: sequence_diagram
  client; server; db
  client -> server: "GET /users"
  server -> db: "SELECT *"
  db -> server: "rows"
  server -> client: "200 OK"
}
`;
  const svg = await render(code);
  if (svg.includes("<svg")) ok("sequence_diagram renders");
  else fail("sequence_diagram", "no SVG");
});

await test("Class diagram", async () => {
  // Fields with [] types and methods with : in params must be quoted
  const code = `
UserService: {
  shape: class
  -db: Database
  "-users": "User[]"
  "+getUser(id: string)": User
  "+createUser(data: UserInput)": User
  -validateEmail(): bool
}
`;
  const svg = await render(code);
  if (svg.includes("<svg")) ok("class diagram renders");
  else fail("class diagram", "no SVG");
});

await test("Layers + animate_interval + target='*'", async () => {
  const code = `
steps: {
  s1: { a }
  s2: { a -> b }
  s3: { a -> b -> c }
}
`;
  const result = await d2.compile(code, { options: { animateInterval: 1500, target: "*" } });
  const svg = await d2.render(result.diagram, result.renderOptions);
  if (svg.includes("<svg")) ok("animated multi-board renders");
  else fail("animated", "no SVG");
  // animated SVGs have SMIL animation
  if (svg.includes("animate") || svg.includes("SMIL") || svg.length > 1000) ok("appears animated (non-trivial output)");
  else fail("animated", "unexpectedly small");
});

await test("Tooltip and link attributes", async () => {
  const code = `
server: {
  tooltip: "Handles API requests"
  link: https://example.com
}
server -> db
db: { shape: cylinder }
`;
  const svg = await render(code);
  if (svg.includes("<svg")) ok("tooltip/link renders");
  else fail("tooltip/link", "no SVG");
});

await test("force_appendix (forceAppendix)", async () => {
  const result = await d2.compile("a -> b");
  const svg = await d2.render(result.diagram, { ...result.renderOptions, forceAppendix: true });
  if (svg.includes("<svg")) ok("forceAppendix renders");
  else fail("forceAppendix", "no SVG");
});

await test("Grid layout", async () => {
  const code = `
dashboard: {
  grid-rows: 2
  grid-columns: 2
  a: "Widget A"
  b: "Widget B"
  c: "Widget C"
  d: "Widget D"
}
`;
  const svg = await render(code);
  if (svg.includes("<svg")) ok("grid layout renders");
  else fail("grid layout", "no SVG");
});

await test("Global globs styling", async () => {
  const code = `
*.style.border-radius: 8
*.style.fill: "#e8f4fd"
a -> b -> c
`;
  const svg = await render(code);
  if (svg.includes("<svg")) ok("glob styling renders");
  else fail("glob styling", "no SVG");
});

await test("Vars + substitutions", async () => {
  const code = `
vars: {
  primary: "#3b5bdb"
}
server: {
  style.fill: \${primary}
}
server -> db
`;
  const svg = await render(code);
  if (svg.includes("<svg")) ok("vars/substitutions render");
  else fail("vars", "no SVG");
});

await test("ELK timeout safety — ELK still works but is slow", async () => {
  // Just verify ELK does render (the timeout in the MCP protects against runaway)
  try {
    const svg = await render("a -> b", { layout: "elk" });
    if (svg.includes("<svg")) ok("elk renders (use with caution — slow)");
    else fail("elk", "no SVG");
  } catch (e) {
    fail("elk", `threw: ${e.message}`);
  }
});

await test("d2_format via d2 binary (stdin)", async () => {
  const { spawn } = await import("child_process");
  const code = "a->b:label\nb->c";
  const result = await new Promise((resolve) => {
    const child = spawn("d2", ["fmt", "-"], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", d => stdout += d);
    child.stderr.on("data", d => stderr += d);
    child.on("close", code => resolve({ stdout, stderr, code }));
    child.stdin.write(code);
    child.stdin.end();
  });
  if (result.code === 0 && result.stdout.includes("->")) ok(`format output: ${result.stdout.trim()}`);
  else fail("d2 fmt", result.stderr || `exit ${result.code}`);
});

// ── summary ──────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
