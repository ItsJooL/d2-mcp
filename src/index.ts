#!/usr/bin/env node
/**
 * MCP Server for D2 diagram language.
 *
 * Uses @terrastruct/d2 WASM package for rendering — no d2 binary required.
 * Optional: set D2_PATH env var to a d2 binary for the d2_format tool.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { D2, type CompileOptions } from "@terrastruct/d2";
import { spawn } from "child_process";
import { summarizeD2 } from "./inspect.js";

// --- Constants ---

const CHARACTER_LIMIT = 200_000;
const RENDER_TIMEOUT_MS = 30_000; // 30s — ELK can hang for minutes, fail fast instead
const VALIDATE_TIMEOUT_MS = 10_000; // 10s — compile-only is fast unless ELK is set in vars

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(
          `${label} timed out after ${ms / 1000}s. ` +
          `If you used layout-engine: elk, switch to dagre (or remove the layout setting entirely) — ` +
          `ELK is extremely slow in WASM.`
        )),
        ms
      )
    ),
  ]);
}

// Theme catalog (from d2 themes command)
const THEMES = {
  light: [
    { id: 0, name: "Neutral Default" },
    { id: 1, name: "Neutral Grey" },
    { id: 3, name: "Flagship Terrastruct" },
    { id: 4, name: "Cool Classics" },
    { id: 5, name: "Mixed Berry Blue" },
    { id: 6, name: "Grape Soda" },
    { id: 7, name: "Aubergine" },
    { id: 8, name: "Colorblind Clear" },
    { id: 100, name: "Vanilla Nitro Cola" },
    { id: 101, name: "Orange Creamsicle" },
    { id: 102, name: "Shirley Temple" },
    { id: 103, name: "Earth Tones" },
    { id: 104, name: "Everglade Green" },
    { id: 105, name: "Buttered Toast" },
    { id: 300, name: "Terminal" },
    { id: 301, name: "Terminal Grayscale" },
    { id: 302, name: "Origami" },
    { id: 303, name: "C4" },
  ],
  dark: [
    { id: 200, name: "Dark Mauve" },
    { id: 201, name: "Dark Flagship Terrastruct" },
  ],
};

// Strip @font-face blocks from SVG. Each block contains a base64 WOFF subset
// (~50–200 KB). The SVG still displays but falls back to system fonts.
function stripFontFaces(svg: string): string {
  return svg.replace(/@font-face\s*\{[^{}]*\}/g, "").replace(/\n{3,}/g, "\n\n");
}

// --- D2 WASM instance (shared, lazily initialized) ---

let d2Instance: D2 | null = null;

function getD2(): D2 {
  if (!d2Instance) {
    d2Instance = new D2();
  }
  return d2Instance;
}

// --- Binary runner (for format tool only) ---

interface BinaryResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runD2Binary(
  args: string[],
  stdin: string
): Promise<BinaryResult> {
  const d2Path = process.env.D2_PATH || "d2";

  return new Promise((resolve, reject) => {
    const child = spawn(d2Path, args, { stdio: ["pipe", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("close", (code: number | null) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });

    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        reject(
          new Error(
            `d2 binary not found. Install d2 from https://d2lang.com or set D2_PATH env var. ` +
              `Note: d2_render and d2_validate work without the binary.`
          )
        );
      } else {
        reject(err);
      }
    });

    child.stdin.write(stdin, "utf8");
    child.stdin.end();
  });
}

// --- Zod schemas ---

enum Layout {
  DAGRE = "dagre",
  ELK = "elk",
}

const RenderInputSchema = z
  .object({
    d2_code: z
      .string()
      .min(1, "D2 code cannot be empty")
      .max(100_000, "D2 code too large (limit 100K chars)")
      .describe("The D2 diagram source code to render"),
    theme_id: z
      .number()
      .int()
      .optional()
      .describe(
        "Theme ID (default: 0 = Neutral Default). Use d2_list_themes to see all options. Popular: 300 (Terminal), 200 (Dark Mauve), 3 (Flagship Terrastruct)"
      ),
    dark_theme_id: z
      .number()
      .int()
      .optional()
      .describe(
        "Theme ID to use when the viewer's browser is in dark mode. If unset, theme_id is used for both modes."
      ),
    layout: z
      .nativeEnum(Layout)
      .optional()
      .describe(
        "Layout engine: 'dagre' (default, recommended for all diagrams — fast and handles nested containers well). " +
        "'elk' is extremely slow in WASM (can take minutes) — do NOT use it unless the user explicitly requests it."
      ),
    sketch: z
      .boolean()
      .optional()
      .describe("Render in hand-drawn/sketch style (default: false)"),
    pad: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Padding in pixels around the diagram (default: 100)"),
    center: z
      .boolean()
      .optional()
      .describe("Center the SVG in its viewbox (default: false)"),
    scale: z
      .number()
      .positive()
      .optional()
      .describe(
        "Scale factor for the output SVG. E.g. 0.5 halves the size. By default D2 renders SVGs that fit to screen. " +
        "Set to 1 to disable fit-to-screen. Not applicable to ascii output."
      ),
    animate_interval: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe(
        "If set, packages multiple boards (layers/scenarios/steps) into one animated SVG, cycling through boards at this interval in milliseconds. " +
        "Requires target to be set (e.g. target='*' for all boards). Use with diagrams that define layers/scenarios/steps."
      ),
    target: z
      .string()
      .optional()
      .describe(
        "Which board to render. Defaults to root board only. " +
        "Use '*' to render all layers/scenarios/steps (requires animate_interval > 0 for multi-board). " +
        "Use 'layers.x.*' to render layer 'x' and all its children. " +
        "Use 'layers.x' to render only layer 'x'."
      ),
    ascii: z
      .boolean()
      .optional()
      .describe(
        "Render as ASCII/Unicode art instead of SVG (default: false). Useful for terminal display, text-only contexts, and fast structural previews before committing to a full SVG render."
      ),
    ascii_mode: z
      .enum(["standard", "extended"])
      .optional()
      .describe(
        "ASCII rendering character set. 'standard' uses basic ASCII chars, 'extended' uses Unicode box-drawing chars (default: 'extended'). Only applies when ascii=true."
      ),
    no_xml_tag: z
      .boolean()
      .optional()
      .describe(
        "Omit the <?xml ...?> declaration from SVG output (default: false). Useful when embedding SVG directly in HTML."
      ),
    force_appendix: z
      .boolean()
      .optional()
      .describe(
        "Always include the SVG appendix for tooltips and links, even if none are present in the diagram (default: false). " +
        "Useful when you plan to add tooltips/links via post-processing."
      ),
    skip_fonts: z
      .boolean()
      .default(true)
      .describe(
        "Strip embedded font data from SVG output (default: TRUE). Removes ~500KB of base64 WOFF data — SVG falls back to system fonts which look identical in practice. Only set to false if the user explicitly requests embedded fonts. No effect on ascii output."
      ),
  })
  .strict();

type RenderInput = z.infer<typeof RenderInputSchema>;

const ValidateInputSchema = z
  .object({
    d2_code: z
      .string()
      .min(1, "D2 code cannot be empty")
      .max(100_000, "D2 code too large (limit 100K chars)")
      .describe("The D2 diagram source code to validate"),
  })
  .strict();

type ValidateInput = z.infer<typeof ValidateInputSchema>;

const FormatInputSchema = z
  .object({
    d2_code: z
      .string()
      .min(1, "D2 code cannot be empty")
      .max(100_000, "D2 code too large (limit 100K chars)")
      .describe("The D2 diagram source code to format"),
  })
  .strict();

type FormatInput = z.infer<typeof FormatInputSchema>;

// --- MCP Server ---

const server = new McpServer({
  name: "d2-mcp-server",
  version: "1.0.0",
});

// Tool: d2_render
server.registerTool(
  "d2_render",
  {
    title: "Render D2 Diagram",
    description: `Render D2 diagram source code to SVG or ASCII art using the D2 WASM engine.

D2 is a diagram scripting language. This tool compiles and renders D2 code without
requiring the d2 binary — it uses the @terrastruct/d2 WASM package directly.

Args:
  - d2_code (string): D2 source code to render
  - theme_id (number): Theme ID (default: 0). See d2_list_themes for options.
      Key themes: 0=Neutral Default, 3=Flagship Terrastruct, 300=Terminal, 200=Dark Mauve
  - dark_theme_id (number): Dark mode theme ID (optional)
  - layout ('dagre' | 'elk'): Layout engine (default: 'dagre'). WARNING: elk is extremely
      slow in WASM — do NOT use unless explicitly requested. Dagre handles all diagram types well.
  - sketch (boolean): Hand-drawn style (default: false)
  - pad (number): Padding pixels (default: 100)
  - center (boolean): Center in viewbox (default: false)
  - scale (number): Scale factor, e.g. 0.5 halves size. Default fits SVG to screen. Set 1 to disable.
  - animate_interval (number): Animate multi-board diagrams (layers/scenarios/steps) at this ms interval.
      Requires target to be set. E.g. animate_interval=1000, target='*'
  - target (string): Which board to render. '*' = all boards (needs animate_interval > 0).
      'layers.x' = specific layer. Default = root board only.
  - ascii (boolean): Output ASCII art instead of SVG (default: false)
  - ascii_mode ('standard' | 'extended'): ASCII char set. 'extended' uses Unicode (default).
  - no_xml_tag (boolean): Omit <?xml?> declaration for direct HTML embedding (default: false)
  - skip_fonts (boolean): Strip embedded font data from SVG (DEFAULT: true). Only set false if user explicitly requests embedded fonts.

Returns:
  SVG markup string (or ASCII art if ascii=true).
  SVG output starts with <?xml version="1.0" encoding="utf-8"?> (unless no_xml_tag=true)

Examples:
  - Simple: d2_code="a -> b: connects"
  - Architecture: d2_code="server -> db: query\\nserver -> cache: read"
  - Styled: d2_code="x: { style.fill: '#4a90d9' }\\nx -> y", theme_id=3
  - ASCII preview: d2_code="a -> b -> c", ascii=true
  - Animated steps: d2_code="steps: { s1: {a} s2: {a -> b} }", animate_interval=1000, target="*"
  - With embedded fonts: skip_fonts=false (only when user explicitly requests it)
  - HTML embed: no_xml_tag=true

Error Handling:
  - Returns error with syntax details if D2 code is invalid
  - Use d2_validate first to check syntax before rendering`,
    inputSchema: RenderInputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params: RenderInput) => {
    try {
      const d2 = getD2();

      const compileOptions: CompileOptions = {};
      if (params.layout !== undefined) compileOptions.layout = params.layout;
      if (params.sketch !== undefined) compileOptions.sketch = params.sketch;
      if (params.theme_id !== undefined) compileOptions.themeID = params.theme_id;
      if (params.dark_theme_id !== undefined) compileOptions.darkThemeID = params.dark_theme_id;
      if (params.pad !== undefined) compileOptions.pad = params.pad;
      if (params.center !== undefined) compileOptions.center = params.center;
      if (params.scale !== undefined) compileOptions.scale = params.scale;
      if (params.animate_interval !== undefined) compileOptions.animateInterval = params.animate_interval;
      if (params.target !== undefined) compileOptions.target = params.target;
      if (params.ascii !== undefined) compileOptions.ascii = params.ascii;
      if (params.ascii_mode !== undefined) compileOptions.asciiMode = params.ascii_mode;
      if (params.no_xml_tag !== undefined) compileOptions.noXMLTag = params.no_xml_tag;

      const result = await withTimeout(
        d2.compile(params.d2_code, { options: compileOptions }),
        RENDER_TIMEOUT_MS,
        "d2_render compile"
      );

      // result.renderOptions comes from the compile step and includes settings embedded
      // in the D2 source (vars.d2-config). We merge our explicit params on top so that
      // caller-provided values always win. This is also necessary for render-only options
      // like noXMLTag that the compile step doesn't propagate into renderOptions.
      const renderOptions: typeof result.renderOptions = { ...result.renderOptions };
      if (params.sketch !== undefined) renderOptions.sketch = params.sketch;
      if (params.theme_id !== undefined) renderOptions.themeID = params.theme_id;
      if (params.dark_theme_id !== undefined) renderOptions.darkThemeID = params.dark_theme_id;
      if (params.pad !== undefined) renderOptions.pad = params.pad;
      if (params.center !== undefined) renderOptions.center = params.center;
      if (params.scale !== undefined) renderOptions.scale = params.scale;
      if (params.animate_interval !== undefined) renderOptions.animateInterval = params.animate_interval;
      if (params.target !== undefined) renderOptions.target = params.target;
      if (params.ascii !== undefined) renderOptions.ascii = params.ascii;
      if (params.ascii_mode !== undefined) renderOptions.asciiMode = params.ascii_mode;
      if (params.no_xml_tag !== undefined) renderOptions.noXMLTag = params.no_xml_tag;
      if (params.force_appendix !== undefined) renderOptions.forceAppendix = params.force_appendix;

      let svg = await withTimeout(
        d2.render(result.diagram, renderOptions),
        RENDER_TIMEOUT_MS,
        "d2_render render"
      );

      if (params.skip_fonts) {
        svg = stripFontFaces(svg);
      }

      if (svg.length > CHARACTER_LIMIT) {
        const hints = ["Simplify your diagram", "use ascii=true"];
        if (!params.skip_fonts) hints.push("use skip_fonts=true for a smaller SVG output");
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text:
                `Error: Rendered output is too large (${svg.length} chars, limit ${CHARACTER_LIMIT}). ` +
                hints.join(", or ") + ".",
            },
          ],
        };
      }

      return {
        content: [{ type: "text" as const, text: svg }],
      };
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : String(error);
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error rendering D2 diagram: ${msg}\n\nTip: Use d2_validate to check for syntax errors first.`,
          },
        ],
      };
    }
  }
);

// Tool: d2_validate
server.registerTool(
  "d2_validate",
  {
    title: "Validate D2 Code",
    description: `Validate D2 diagram source code for syntax and semantic errors using the WASM engine.

Uses compile step to detect all errors without rendering. No d2 binary required.

Args:
  - d2_code (string): D2 source code to validate

Returns:
  JSON object:
  {
    "valid": boolean,     // Whether the code is syntactically and semantically valid
    "error": string       // Error message if invalid (omitted if valid)
  }

Examples:
  - Check before rendering: validate first, then d2_render only if valid=true
  - Debug syntax: get specific line/column error info

Error Handling:
  - Returns { valid: false, error: "..." } with specific error details
  - Never throws — always returns a structured result`,
    inputSchema: ValidateInputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params: ValidateInput) => {
    try {
      const d2 = getD2();
      await withTimeout(
        d2.compile(params.d2_code),
        VALIDATE_TIMEOUT_MS,
        "d2_validate compile"
      );
      const output = { valid: true };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(output) }],
        structuredContent: output,
      };
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : String(error);
      const output = { valid: false, error: msg };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(output) }],
        structuredContent: output,
      };
    }
  }
);

// Tool: d2_inspect
server.registerTool(
  "d2_inspect",
  {
    title: "Inspect D2 Diagram Structure",
    description: `Parse and summarize the structure of D2 source code without rendering.

Returns a human-readable text summary of all shapes, containers, connections, and
boards (layers/steps/scenarios) in the diagram. Uses the compile step only — no
rendering occurs, so this is fast (~100ms) regardless of diagram complexity.

Use this INSTEAD of d2_render(ascii=true) for structural previews. The ASCII
renderer has known bugs with cross-container connections and reverse edges. This
tool produces reliable output for all diagram types.

Args:
  - d2_code (string): D2 source code to inspect

Returns:
  Structured text summary, e.g.:
    Shapes (4):
    - cp [rectangle] "Control Plane"
      - cp.listener [rectangle] "API Gateway"
      - cp.grpc [rectangle] "gRPC Server"
    - agent [rectangle] "Data Plane Agent"

    Connections (2):
      cp.grpc -> agent.stream : "mirror request"
      agent.stream -> cp.grpc : "response"

Works correctly for all diagram types:
  - Architecture diagrams with nested containers and cross-container connections
  - Sequence diagrams (filters out internal lifeline-end nodes)
  - ER diagrams (sql_table shapes, FK connections shown at table level)
  - UML class diagrams
  - Layered/stepped/scenario diagrams (each board summarized)
  - State machines, flowcharts, grid dashboards

Error handling:
  - Returns compile errors if D2 code is invalid (same as d2_validate)`,
    inputSchema: z.object({
      d2_code: z
        .string()
        .min(1, "D2 code cannot be empty")
        .describe("The D2 diagram source code to inspect"),
    }).strict(),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params: { d2_code: string }) => {
    try {
      const d2 = getD2();
      const result = await withTimeout(
        d2.compile(params.d2_code),
        VALIDATE_TIMEOUT_MS,
        "d2_inspect compile"
      );
      const summary = summarizeD2(result.diagram);
      return {
        content: [{ type: "text" as const, text: summary }],
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        isError: true,
        content: [{ type: "text" as const, text: `Error inspecting D2 diagram: ${msg}` }],
      };
    }
  }
);

// Tool: d2_format
server.registerTool(
  "d2_format",
  {
    title: "Format D2 Code",
    description: `Format D2 diagram source code using the d2 binary formatter.

Normalizes whitespace, indentation, and syntax to D2's canonical style.
The formatted output is semantically equivalent to the input.

NOTE: This tool requires the d2 binary to be installed (unlike d2_render and
d2_validate which use WASM). Install from https://d2lang.com or set D2_PATH env var.

Args:
  - d2_code (string): D2 source code to format

Returns:
  Formatted D2 source code string.

Examples:
  - Clean up: format "a->b:label" to "a -> b: label"
  - Normalize after editing: run on any hand-written D2 code

Error Handling:
  - Returns error if d2 binary is not found (d2_render still works without it)
  - Returns error if code has syntax errors (format requires valid syntax)`,
    inputSchema: FormatInputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params: FormatInput) => {
    try {
      const result = await withTimeout(
        runD2Binary(["fmt", "-"], params.d2_code),
        10_000,
        "d2_format"
      );

      if (result.exitCode !== 0) {
        const errorMsg =
          result.stderr || result.stdout || "Unknown error";
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Error formatting D2 code: ${errorMsg.trim()}`,
            },
          ],
        };
      }

      return {
        content: [{ type: "text" as const, text: result.stdout }],
      };
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : String(error);
      return {
        isError: true,
        content: [{ type: "text" as const, text: `Error: ${msg}` }],
      };
    }
  }
);

// Tool: d2_list_themes
server.registerTool(
  "d2_list_themes",
  {
    title: "List D2 Themes",
    description: `List all available D2 diagram themes with their IDs and names.

Use theme IDs with d2_render's theme_id parameter.
No d2 binary required — theme list is built-in.

Args: (none)

Returns:
  JSON object:
  {
    "light": [{ "id": number, "name": string }],
    "dark":  [{ "id": number, "name": string }]
  }

Notable themes:
  - 0:   Neutral Default (clean, professional — good default)
  - 3:   Flagship Terrastruct (vibrant, colorful)
  - 8:   Colorblind Clear (accessible palette)
  - 200: Dark Mauve (dark mode)
  - 300: Terminal (monospace, dot-fill containers, uppercase labels)
  - 302: Origami (paper-like aesthetic)
  - 303: C4 (C4 architecture diagram style)`,
    inputSchema: z.object({}).strict(),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async () => {
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(THEMES, null, 2) },
      ],
      structuredContent: THEMES,
    };
  }
);

// Tool: d2_list_layouts
server.registerTool(
  "d2_list_layouts",
  {
    title: "List D2 Layout Engines",
    description: `List available D2 layout engines with descriptions and feature support.

Use layout names with d2_render's layout parameter.
No d2 binary required — layout list is built-in.

Args: (none)

Returns:
  JSON object:
  {
    "layouts": [{
      "name": string,
      "description": string,
      "features": string[]   // Supported features
    }]
  }

Layout guidance:
  - dagre: Default. Fast, good for most flowcharts and architecture diagrams.
  - elk:   Better for complex graphs, supports ancestor-to-descendant connections,
           width/height on containers. Slower than dagre.`,
    inputSchema: z.object({}).strict(),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async () => {
    const output = {
      layouts: [
        {
          name: "dagre",
          description:
            "Default layout. Fast directed graph. Recommended for all diagrams — handles nested containers, " +
            "cross-container connections, and direction control well. Use this unless the user explicitly requests elk.",
          features: [
            "near to constants",
            "direction control",
            "fast rendering",
            "nested containers",
            "cross-container connections",
          ],
        },
        {
          name: "elk",
          description:
            "Eclipse Layout Kernel. WARNING: Extremely slow in WASM (can take minutes). " +
            "Only use if user explicitly requests it. Extra features over dagre: ancestor-to-descendant connections, " +
            "width/height on containers, per-container direction.",
          features: [
            "ancestor-to-descendant connections",
            "width/height on containers",
            "per-container direction control",
          ],
        },
      ],
    };
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(output, null, 2) },
      ],
      structuredContent: output,
    };
  }
);

// --- Main ---

async function main(): Promise<void> {
  // Connect to transport first so clients can initialize immediately.
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("D2 MCP server running via stdio");

  // Warm up the dagre WASM code path in the background so the first real render
  // doesn't pay the JIT cost. ELK is intentionally excluded — it's extremely slow
  // in WASM and rarely used. Runs after connect so startup is instant.
  const d2 = getD2();
  d2.compile("a -> b", { options: { layout: "dagre" } })
    .then(() => {
      console.error("D2 WASM warmed up (dagre ready)");
    })
    .catch((err: unknown) => {
      console.error("D2 WASM warmup error:", err);
    });
}

main().catch((error: unknown) => {
  console.error("Server error:", error);
  process.exit(1);
});
