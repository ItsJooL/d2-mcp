---
name: d2
description: >
 Use when writing, generating, reviewing, or improving D2 diagram code.
  Trigger when the user asks to create architecture diagrams, flowcharts,
  sequence diagrams, ER diagrams, class diagrams, or any diagram using D2 syntax.
  Also trigger when working with .d2 files or when the d2_render MCP tool is available.
---

# D2 Diagram Language

D2 is a declarative diagram scripting language that compiles to SVG. Text → diagrams.
Docs: https://d2lang.com | Playground: https://play.d2lang.com

---

## Diagram Type Selection

Choose the right diagram type before writing any code:

| User wants to show... | Use this D2 pattern |
|-----------------------|---------------------|
| System components and how they connect | Containers + connections (architecture) |
| Request/response flow, API interactions, message order | `shape: sequence_diagram` |
| A process, algorithm, or decision tree | Shapes + directed connections (flowchart) |
| Database tables and foreign keys | `shape: sql_table` (ER diagram) |
| Class hierarchies, object relationships | `shape: class` (UML class diagram) |
| System context: users, systems, boundaries (C4) | Containers + `shape: c4-person` + theme 303 |
| A state machine or lifecycle | Shapes + labeled connections (state diagram) |
| Progressive reveal / storytelling | `steps: {}` with animate_interval |
| Multiple views of the same system | `layers: {}` or `scenarios: {}` |
| A dashboard / grid of metrics | Container with `grid-rows` / `grid-columns` |

**Default shape:** `rectangle`. Use `direction: right` or `direction: down` to control flow.

---

## Workflow: Responding to a Diagram Request

1. **Pick the diagram type** (use the table above)
2. **Draft the D2 code** — start with core entities, add connections, add style last
3. **Call `d2_inspect`**, then draw an ASCII replica from its output:
   ```
   d2_inspect(d2_code=...)
   ```

   Use the inspect output to hand-draw a clean ASCII diagram using box-drawing characters (`┌─┐│└┘├┤┬┴┼ ▶ ◀ ↓ ↑`). You are generating this ASCII — not the D2 renderer. This avoids all of D2's known ASCII rendering bugs (cross-container connections, reverse edges, direction:right).

   **How to draw it:**
   - Containers become labelled boxes: `┌─ Control Plane ──────┐`
   - Child shapes are indented inside their parent box
   - Connections are drawn as arrows between boxes with their labels
   - Cross-container connections are shown as arrows spanning between the boxes
   - Use `→` for forward, `←` for reverse, `↔` for bidirectional, `--` for undirected
   - For sequence diagrams: draw actors as columns with arrows between them
   - For steps/layers: show each board as a separate section

   Put the result in a code fence and ask the user if the structure looks right:

   ```
   Here's the structure:

   ┌─ SaaS Cloud ─────────────────────────────┐
   │  ┌──────────────────┐                    │
   │  │  Control Plane   │                    │
   │  │  ┌─────────────┐ │                    │
   │  │  │ API Gateway │ │                    │
   │  │  └──────┬──────┘ │                    │
   │  │       route      │                    │
   │  │  ┌──────▼──────┐ │                    │
   │  │  │ gRPC Server │ │                    │
   │  │  └──────┬──────┘ │                    │
   │  └─────────┼────────┘                    │
   └────────────┼────────────────────────────-┘
                │ mirror request →
   ┌─ Customer Edge ──────────────────────────┐
   │  ┌──────────────────┐                    │
   │  │  Data Plane Agent│                    │
   │  │  ┌─────────────┐ │                    │
   │  │  │ gRPC Client │ │                    │
   │  │  └─────────────┘ │                    │
   │  └──────────────────┘                    │
   └──────────────────────────────────────────┘

   Does this look right? I'll render the SVG if so.
   ```

   **Rules:**
   - Always call `d2_inspect` first — draw from its output, not from memory
   - Do NOT use `d2_render(ascii=true)` — D2's ASCII renderer has known bugs
   - Do NOT skip the preview and go straight to SVG
   - If the user requests changes, update the D2 code, re-inspect, redraw

4. **Only if the user confirms the structure, render SVG:** `d2_render(d2_code=..., skip_fonts=true)`
5. **If invalid at either step,** call `d2_validate` to get specific line/column errors
6. **When saving:** write the `.d2` source first (instant), SVG render last (see [Saving Rendered SVGs](#saving-rendered-svgs))
7. **Iterate** — adjust based on feedback, re-render ASCII to confirm, then SVG

**Rule:** `skip_fonts` defaults to `true` — never override it unless the user explicitly asks for embedded fonts. System fonts are indistinguishable from Source Sans Pro in practice, and skipping fonts reduces render time and SVG size by ~500KB.

---

## Core Syntax

### Shapes

```d2
# Bare identifier = rectangle by default
server

# With a display label (key vs label — connections use the KEY, not the label)
server: "API Server"

# Set shape type
db: {
  shape: cylinder
}

# Multiple on one line
web; app; db

# Inline style shorthand
cache: { shape: queue; style.fill: "#fce8e6" }
```

**Available shape types:**
`rectangle` (default), `square`, `circle`, `oval`, `diamond`, `hexagon`, `cloud`,
`cylinder`, `queue`, `package`, `parallelogram`, `document`, `page`, `step`,
`callout`, `stored_data`, `person`, `c4-person`,
`sql_table`, `class`, `sequence_diagram`, `image`

### Connections

```d2
A -> B            # directed arrow
A <- B            # reverse
A -- B            # undirected line
A <-> B           # bidirectional

A -> B: label     # with label

# Chaining
A -> B -> C -> D

# Multiple connections (creates SEPARATE arrows — D2 never merges them)
A -> B: "first"
A -> B: "second"   # distinct second arrow, not an override

# Reference a specific connection (0-indexed) to style it
(A -> B)[0].style.stroke: red
```

### Containers (nesting)

```d2
cloud: {
  label: "AWS"
  vpc: {
    web: "Web Tier"
    app: "App Tier"
    web -> app
  }
}

# Cross-container connections: use _ to refer to the parent scope
cloud: {
  aws: {
    db
    db -> _.gcloud.backup    # _ = parent scope (cloud)
  }
  gcloud: {
    backup
  }
}
```

### Text and Markdown

```d2
explanation: |md
  ## Architecture Overview
  This diagram shows the **three-tier** architecture.
  - Web tier
  - App tier
  - Data tier
|

formula: |latex
  \frac{\partial f}{\partial x} = 2x
|
```

---

## Style Reference

### Shape styles

```d2
my_shape: {
  style: {
    fill: "#4a90d9"          # background color
    stroke: "#2c5f8a"        # border color
    stroke-width: 2
    stroke-dash: 5           # dashed border
    border-radius: 8         # rounded corners
    font-size: 14
    font-color: white
    opacity: 0.9
    shadow: true
    bold: true
    italic: false
    3d: true                 # rectangles/squares only
    multiple: true           # stacked visual — implies "many instances"
    double-border: true      # rectangles and ovals only
    text-transform: uppercase
  }
}
```

### Connection styles

```d2
A -> B: {
  style: {
    stroke: red
    stroke-width: 3
    stroke-dash: 5
    animated: true           # flowing animation — use to show data/request flow
    bold: true
    font-color: "#666"
  }
}
```

### Arrowheads

```d2
A -> B: {
  source-arrowhead: {
    shape: diamond
    style.filled: true
  }
  target-arrowhead: {
    shape: circle
  }
}
```

Arrowhead shapes: `triangle` (default), `arrow`, `diamond`, `circle`, `box`,
`cf-one`, `cf-many`, `cf-one-required`, `cf-many-required`, `cross`

Use `cf-*` arrowheads on ER connections to show cardinality (crow's foot notation).

---

## Advanced Styling

### Global styles with globs

```d2
# Style all shapes
*.style.fill: "#f0f4ff"
*.style.stroke: "#3b5bdb"
*.style.border-radius: 6

# Style all connections
(* -> *)[*].style.stroke: "#888"
(* -> *)[*].style.animated: true

# Scoped glob — only shapes inside this container
cloud: {
  *.style.fill: "#e8f5e9"
}
```

### Reusable style classes

```d2
classes: {
  important: {
    style: { stroke: red; stroke-width: 3; bold: true }
  }
  faded: {
    style: { opacity: 0.4 }
  }
  external: {
    style: { stroke-dash: 5; fill: "#f8f8f8" }
  }
}

# Apply to shapes
critical_db.class: important
legacy_service.class: faded

# Apply multiple (left-to-right, later class wins on conflicts)
service.class: [important; faded]

# Apply to connections
A -> B: { class: important }
```

### Variables and substitutions

```d2
vars: {
  primary: "#3b5bdb"
  secondary: "#74c0fc"
  accent: "#f06595"

  # In-file config (overridden by d2_render tool params)
  d2-config: {
    theme-id: 0
    theme-overrides: {
      B1: "#0057b8"   # brand primary — maps to the main accent color
      N7: "#1a1a2e"   # darkest neutral
    }
  }
}

server: {
  style.fill: ${primary}
  style.stroke: ${secondary}
}
```

Color override codes: `N1`–`N7` (neutrals), `B1`–`B6` (brand), `AA2`–`AA5` (accent A), `AB4`–`AB5` (accent B)

---

## Diagram Patterns

### Architecture / System

```d2
*.style.border-radius: 6
*.style.font-size: 13
direction: right

internet: { shape: cloud; label: "Internet" }

frontend: {
  label: "Frontend\n(React)"
  icon: https://icons.terrastruct.com/dev/react.svg
  style.fill: "#e8f4fd"
}

api: { label: "API Gateway"; style.fill: "#fff3cd" }

services: {
  label: "Microservices"
  style.fill: "#f8f9fa"

  auth: "Auth Service"
  orders: "Orders Service"
  payments: "Payments Service"
}

db: { shape: cylinder; label: "PostgreSQL"; style.fill: "#d4edda" }
cache: { shape: queue; label: "Redis"; style.fill: "#fce8e6" }

internet -> frontend
frontend -> api: "HTTPS"
api -> services.auth: "JWT validate"
api -> services.orders
api -> services.payments
services.orders -> db
services.payments -> db
services.auth -> cache: "session"
```

### Flowchart / Process

```d2
direction: down

start: { shape: circle; style.fill: "#4caf50"; style.font-color: white }
end_ok: { shape: circle; style.fill: "#4caf50"; style.font-color: white; label: "Done" }
end_err: { shape: circle; style.fill: "#f44336"; style.font-color: white; label: "Failed" }
validate: { shape: diamond; label: "Valid?" }
process: "Process Request"
notify: "Send Notification"
error: "Return Error"

start -> process
process -> validate
validate -> notify: "Yes"
validate -> error: "No"
notify -> end_ok
error -> end_err
```

### Sequence Diagram

```d2
auth_flow: {
  shape: sequence_diagram

  # Declare actors in display order
  client
  gateway
  auth
  db

  client -> gateway: "POST /login"
  gateway -> auth: "validate(credentials)"
  auth -> db: "SELECT user WHERE email=?"
  db -> auth: "user record"

  # Note on a specific actor (no connections = annotation)
  auth."checks bcrypt hash"

  auth -> gateway: "JWT token"
  gateway -> client: "200 OK + token"

  # Group / fragment
  error_case: {
    gateway -> client: "401 Unauthorized"
  }
}
```

Key rules for sequence diagrams:
- Actors are auto-created on first reference; declare them explicitly to control order
- A standalone shape with no connections inside the diagram is a note/annotation
- Groups (named nested blocks) create UML fragment boxes

### ER Diagram (SQL Tables)

```d2
users: {
  shape: sql_table
  id: uuid {constraint: primary_key}
  email: varchar(255) {constraint: [unique; not_null]}
  name: varchar(100)
  org_id: uuid {constraint: foreign_key}
  created_at: timestamptz
}

organizations: {
  shape: sql_table
  id: uuid {constraint: primary_key}
  name: varchar(255) {constraint: not_null}
}

posts: {
  shape: sql_table
  id: uuid {constraint: primary_key}
  author_id: uuid {constraint: foreign_key}
  title: varchar(255)
  body: text
}

# FK connections — connect column to column
users.org_id -> organizations.id
posts.author_id -> users.id
```

SQL table notes:
- `stroke` styles the table body; `fill` styles the header row
- Constraints: `primary_key`, `foreign_key`, `unique`, `not_null`
- Multiple constraints: `{constraint: [primary_key; not_null]}`

### UML Class Diagram

```d2
UserService: {
  shape: class

  # Fields: visibility + name: type
  # Quote the key if params contain ":", quote the value if it contains "[]"
  -db: Database
  "-users": "User[]"
  "#cache": Cache

  # Methods: visibility + name(params): return
  +getUser(): User
  "+createUser(data: UserInput)": User
  "-validateEmail(email: string)": bool
}

User: {
  shape: class
  +id: string
  +email: string
  +name: string
  +createdAt: Date
}

# Relationships as connections with labels
UserService -> User: uses
UserRepo -> User: manages
```

Visibility: `+` public, `-` private, `#` protected

**Quoting rules:**
- Field type contains `[]` → quote the value: `"-users": "User[]"`
- Method params contain `:` → quote the key: `"+method(id: string)": ReturnType`

### C4 Architecture

Use theme 303 (C4) for C4 diagrams — it styles containers with the canonical C4 look.

```d2
# Render with: theme_id=303
direction: right

vars: {
  d2-config: {
    theme-id: 303
  }
}

# Actors
user: {
  shape: c4-person
  label: "Customer"
  style.fill: "#08427b"
  style.font-color: white
}

# Systems
web_app: {
  label: "Web Application\n[React SPA]"
  style.fill: "#1168bd"
  style.font-color: white
}

api: {
  label: "API Server\n[Node.js / Express]"
  style.fill: "#1168bd"
  style.font-color: white
}

db: {
  shape: cylinder
  label: "Database\n[PostgreSQL]"
  style.fill: "#1168bd"
  style.font-color: white
}

external_payment: {
  label: "Payment Gateway\n[Stripe]"
  style.fill: "#999999"
  style.font-color: white
}

user -> web_app: "Uses [HTTPS]"
web_app -> api: "API calls [JSON/HTTPS]"
api -> db: "Reads/writes [SQL]"
api -> external_payment: "Charges card [HTTPS]"
```

### State Machine

```d2
direction: right

# States
idle: { shape: rectangle; label: "Idle" }
loading: { shape: rectangle; label: "Loading"; style.fill: "#fff3cd" }
success: { shape: rectangle; label: "Success"; style.fill: "#d4edda" }
error: { shape: rectangle; label: "Error"; style.fill: "#f8d7da" }

# Terminal states with double-border
success: { style.double-border: true }

# Transitions
idle -> loading: "fetch()"
loading -> success: "onSuccess"
loading -> error: "onError"
error -> idle: "reset()"
success -> idle: "reset()"
```

### Grid Dashboard

```d2
dashboard: {
  label: "System Health"
  grid-rows: 2
  grid-columns: 3
  grid-gap: 16

  cpu: { label: "CPU\n42%" }
  memory: { label: "Memory\n71%" }
  disk: { label: "Disk\n28%" }
  latency: { label: "p99 Latency\n180ms"; style.fill: "#fff3cd" }
  errors: { label: "Error Rate\n0.2%"; style.fill: "#d4edda" }
  uptime: { label: "Uptime\n99.97%"; style.fill: "#d4edda" }
}
```

### Animated Multi-Step Diagram

Use `steps` to build up a diagram progressively. Render with `animate_interval` to produce an animated SVG.

```d2
steps: {
  s1: {
    user: "User"
  }
  s2: {
    user: "User"
    web: "Web Server"
    user -> web: "request"
  }
  s3: {
    user: "User"
    web: "Web Server"
    db: "Database"
    user -> web: "request"
    web -> db: "query"
  }
  s4: {
    user: "User"
    web: "Web Server"
    db: "Database"
    cache: "Redis"
    user -> web: "request"
    web -> db: "query"
    web -> cache: "cache hit"
  }
}
```

Render: `d2_render(d2_code=..., animate_interval=1500, target="*")`

Each step inherits the previous. Use `scenarios` for variations on a base; use `layers` for fully independent views.

---

## Themes

### Contextual picks

| Context | Recommended theme | ID |
|---------|------------------|----|
| Technical docs, general use | Neutral Default | 0 |
| C4 architecture diagrams | C4 | 303 |
| Dark mode documentation | Dark Mauve | 200 |
| Vibrant / colorful | Flagship Terrastruct | 3 |
| Paper / whiteboard aesthetic | Origami | 302 |
| Terminal / monospace style | Terminal | 300 |
| Accessible / colorblind-safe | Colorblind Clear | 8 |
| Presentations (high contrast) | Neutral Default or Flagship | 0 or 3 |

### Light/dark mode per diagram

D2 supports separate themes for light and dark browser mode in one SVG:

```
d2_render(d2_code=..., theme_id=0, dark_theme_id=200)
```

The browser automatically switches based on `prefers-color-scheme`. Use this when embedding SVGs in documentation sites.

### Full theme table

| ID  | Name                      | Character                          |
|-----|---------------------------|------------------------------------|
| 0   | Neutral Default           | Clean, professional (good default) |
| 1   | Neutral Grey              | Muted, monochrome                  |
| 3   | Flagship Terrastruct      | Vibrant, colorful                  |
| 4   | Cool Classics             | Blues and greens                   |
| 5   | Mixed Berry Blue          | Purples and blues                  |
| 6   | Grape Soda                | Purple-dominant                    |
| 7   | Aubergine                 | Deep purple tones                  |
| 8   | Colorblind Clear          | Accessible palette                 |
| 100 | Vanilla Nitro Cola        | Warm neutrals                      |
| 101 | Orange Creamsicle         | Orange accent                      |
| 102 | Shirley Temple            | Pink and red                       |
| 103 | Earth Tones               | Browns and tans                    |
| 104 | Everglade Green           | Forest greens                      |
| 105 | Buttered Toast            | Warm yellows                       |
| 200 | Dark Mauve                | Dark mode                          |
| 201 | Dark Flagship Terrastruct | Dark mode, colorful                |
| 300 | Terminal                  | Monospace, dot-fill containers     |
| 301 | Terminal Grayscale        | Terminal style, grayscale          |
| 302 | Origami                   | Paper aesthetic                    |
| 303 | C4                        | C4 architecture diagram style      |

---

## Layouts

| Engine | Use when | Notes |
|--------|----------|-------|
| dagre  | **Always — default** | Fast, handles nesting and cross-container connections well |
| elk    | User explicitly requests it | Extremely slow in WASM (can take minutes). Do NOT choose it yourself. |

**Default rule: never set `layout-engine` at all.** Dagre is the default. Only set ELK if the user asks for it.

**Direction control:**
```d2
direction: right    # top-level: up, down, left, right

# Per-container direction (ELK only — do not use unless user requests ELK)
container: {
  direction: right
  a -> b -> c
}
```

---

## Composition: Layers, Scenarios, Steps

```d2
# Layers: independent views (no inheritance between layers)
layers: {
  overview: {
    web -> app -> db
  }
  detailed: {
    web: "Nginx" { shape: rectangle }
    web -> app: "HTTP/1.1"
    app -> db: "PostgreSQL wire protocol"
  }
}

# Scenarios: variations on a base diagram (inherit from root)
web -> app -> db

scenarios: {
  with_cache: {
    app -> cache: "read-through"
  }
  with_cdn: {
    cdn -> web
  }
}

# Steps: sequential, each step inherits the previous (use for animated storytelling)
steps: {
  s1: { user }
  s2: { user -> web }
  s3: { user -> web -> app }
  s4: { user -> web -> app -> db }
}
```

Animate layers/scenarios/steps: `d2_render(d2_code=..., animate_interval=1500, target="*")`
Render one board: `target="layers.production"` or `target="layers.production.*"` for it and its children.

---

## Icons

```d2
# Icon from URL — Terrastruct's free icon library
server: {
  icon: https://icons.terrastruct.com/tech/server.svg
}

# Control icon position
server: {
  icon: https://icons.terrastruct.com/tech/server.svg
  icon.near: top-left    # top-left, top-center, top-right, center-left, center-right, bottom-*
}

# Standalone image shape
github: {
  shape: image
  icon: https://icons.terrastruct.com/social/github.svg
}
```

Free icons: https://icons.terrastruct.com — includes AWS, GCP, Azure, dev tools, tech logos.

---

## Tooltips and Links

```d2
server: {
  tooltip: "Handles all API requests. SLA: 99.9%"
  link: https://docs.example.com/server
}

server -> db: {
  tooltip: "Uses PgBouncer connection pooling"
}
```

Tooltips and links are embedded in the SVG and work when opened in a browser. To force the tooltip appendix to render even on shapes without tooltips, add `forceAppendix: true` to your render options (not yet exposed in the `d2_render` tool — use in-file config or omit).

---

## Grid Layout

```d2
dashboard: {
  grid-rows: 2
  grid-columns: 3
  grid-gap: 20           # gap between all cells
  vertical-gap: 10       # fine-tune vertical spacing
  horizontal-gap: 15     # fine-tune horizontal spacing

  widget_a: "Revenue"
  widget_b: "Users"
  widget_c: "Orders"
  widget_d: "Latency"
  widget_e: "Errors"
  widget_f: "Uptime"
}
```

- Shapes fill cells left-to-right, top-to-bottom
- Connections between grid items still render normally
- `width`/`height` on grid containers requires ELK layout

---

## Imports

```d2
# Spread file contents into current scope
...@shared_styles.d2

# Assign file to a key
network: @network_diagram.d2

# Import specific object from file
db_schema: @schema.users
```

---

## Saving Rendered SVGs

**Save in this order — write source first, SVG second:**

**Step 1 — Write the D2 source immediately** (no render needed, instant):
Write the D2 code to `diagrams/<stem>.d2` with the Write tool.

**Step 2 — Reuse the SVG from the conversation render:**
The SVG you already rendered with `skip_fonts=true` (default) is the save-worthy output. Write it to `diagrams/<stem>.svg`. No second render needed.

**Embedded fonts:** `skip_fonts=true` is the default and correct for saved files too — system fonts are indistinguishable from Source Sans Pro in practice. Only render with `skip_fonts=false` if the user explicitly asks for embedded fonts, and warn them it will add ~500KB and take significantly longer.

**Filename convention:**
- Directory: `diagrams/` relative to project root (create if missing)
- Stem: `YYYY-MM-DD_HH-MM_<slug>` — local time, 24-hour, 2–4 word slug
- Examples: `2025-06-01_14-32_auth-flow-sequence`, `2025-06-01_09-05_aws-three-tier`

After saving, tell the user the paths. SVGs open in any browser and are fully interactive (tooltips, links, animations).

**For HTML embedding:** add `no_xml_tag=true` to omit the `<?xml?>` declaration.

---

## D2 Superpowers (vs Mermaid)

These are things D2 does that Mermaid cannot — reach for them when appropriate:

- **Cross-container connections** — connect shapes inside different containers with `_` for parent scope: `aws.db -> _.gcloud.replica`
- **Animated connections** — `style.animated: true` creates flowing arrows in the SVG (great for showing data flow)
- **Multi-board animated SVGs** — `steps`/`scenarios`/`layers` + `animate_interval` produce a single SVG that cycles through states
- **Native light/dark mode** — `d2_render(theme_id=0, dark_theme_id=200)` — browser auto-switches
- **Brand theming with vars** — define brand colors once in `vars`, reference with `${primary}` throughout
- **Reusable style classes** — define `.class` styles once, apply to many shapes like CSS classes
- **Grid layout** — dashboard-style grid arrangements in pure D2
- **Icon library** — pull SVG icons from `icons.terrastruct.com` directly into shapes
- **Tooltip appendix** — hover tooltips with links embedded in the SVG, no JavaScript needed

---

## Quality Guidelines

- **Start with structure, add style last** — get shapes and connections right before worrying about colors
- **Keep diagrams focused** — aim for under 40 nodes; split complex systems into multiple diagrams
- **One diagram per concept** — an architecture diagram and a sequence diagram for the same system are more useful than a single diagram trying to show both
- **Prefer containers over flat graphs** — D2's nesting is a strength; use it to group related components
- **Use `style.animated: true`** on connections to show active data flow — it's more informative than color alone
- **Iterate with the user** — render, show, ask "does this capture what you meant?", adjust
- **Use `d2_validate` before `d2_render`** if you're unsure about syntax — it returns specific line/column errors

---

## Common Mistakes

**Do not use `d2_render(ascii=true)` for structural previews:**
The D2 ASCII renderer (added in v0.7.1) has known bugs: `direction: right` with cross-container connections garbles output, and reverse/back-arrows (reply, response) produce tangled routing even with `direction: down`. Terrastruct has acknowledged the approach is architecturally flawed and a rewrite is in progress.

Use `d2_inspect` instead — it generates a reliable text summary from the compiled diagram object, with no rendering involved.

**Repeated connections are not merged:**
```d2
A -> B: "label 1"
A -> B: "label 2"   # creates a SECOND distinct arrow, not an update
```
Use `(A -> B)[0].label: "label 1"` to reference existing connections.

**`_` is the parent scope, not the root:**
```d2
outer: {
  inner: {
    x -> _.y    # _ refers to outer, not root
  }
  y
}
```

**Quoting class method params:**
```d2
# WRONG — colon inside key breaks parsing
+createUser(data: UserInput): User

# CORRECT — quote the key when params contain ":"
"+createUser(data: UserInput)": User
```

**ELK in WASM is extremely slow:**
Never set `layout-engine: elk` in `vars.d2-config` or pass `layout: "elk"` to `d2_render` unless the user explicitly asks. It can take several minutes per render.

**`width`/`height` on containers requires ELK:**
`grid-rows`/`grid-columns` works with dagre, but explicit `width`/`height` on containers only takes effect with ELK layout.

**Connections use keys, not labels:**
```d2
server: "API Server"   # label is "API Server", key is "server"
server -> db            # correct — uses the key
"API Server" -> db      # WRONG — this creates a new shape named "API Server"
```

**`skip_fonts=true` by default in conversation:**
Always pass `skip_fonts=true` when rendering for display in conversation. Only omit it (i.e. use `skip_fonts=false`) when saving the final SVG to disk. Each render without `skip_fonts=true` adds ~500KB of base64 font data to your context.
