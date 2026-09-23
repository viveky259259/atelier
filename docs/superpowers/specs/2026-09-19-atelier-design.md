# Atelier — An Agentic Design Team as an MCP Server

**Status:** Design spec, Slice 1
**Date:** 2026-09-19 (revised 2026-09-23: §4 re-verified on v0.5.12, new §4.7)
**Author:** Design Head (orchestrator) + 6 specialist seats

---

## 1. Problem

AI coding agents produce UI that looks like AI produced it: generic layouts, default
palettes, unexamined typography, no states, no accessibility, no design rationale.
The agent has no design team to consult, so it guesses.

Atelier is a local MCP server that any AI agent can consult for design. It runs a real
design process — requirements, direction, a token system, materialisation, adversarial
critique, and code handoff — with **Paper.design as the source of truth** for every
design artifact.

## 2. Goals

1. Any MCP client (Claude Code, Cursor, Codex, Copilot, Antigravity) can consult it.
2. It understands a requirement well enough to produce a defensible design brief.
3. It produces real, tokenised, hand-built designs in the user's Paper file.
4. It critiques its own output against a rubric and iterates until it converges.
5. Human designers can join the loop by commenting on the Paper canvas.
6. It hands off idiomatic code in any target language. *(Slice 2)*

## 3. Non-goals

- **Not** a design file format. Paper owns the design data; we never mirror it as truth.
- **Not** a renderer. Paper renders; we read screenshots.
- **Not** a Paper wrapper. We do not proxy Paper's tools. Callers use Paper MCP directly.
- **Not** a hosted service. Local only, single user, no auth. *(Slice 4+ may revisit.)*

## 4. Verified constraints (from live `paper-desktop`: probed on v0.5.8, re-verified on v0.5.12)

These were probed against the running server, not taken from documentation. The public
docs describe 24 tools; the live server exposes **34** (unchanged through v0.5.12).

### 4.1 Structure creation

`write_html` is the **only** tool that creates structure. Every other write tool mutates
nodes that already exist:

| Tool | Requires existing nodes |
|---|---|
| `create_artboard` | creates an empty frame only |
| `duplicate_nodes` | yes — deep-clones an existing node |
| `move_nodes` | yes — preserves node identity |
| `update_styles` | yes |
| `set_text_content` | yes — Text nodes only |

`<x-paper-clone node-id="…">` is an element *inside* `write_html`, so composition from
existing components also flows through it.

### 4.2 The node-identity rule (load-bearing)

Comment threads are **pinned to nodes**. The Critic posts findings as comment threads.
Therefore:

> **`write_html` is used once per node, at genesis. Every subsequent refinement mutates
> in place via `update_styles` / `set_text_content` / `move_nodes` / `duplicate_nodes`.**

A refinement round that re-runs `write_html` in `replace` mode deletes the nodes its own
critique is attached to, destroying critique history, the semantic-name↔nodeId map, and
any manual edit the user made on the canvas. This rule is not an optimisation; the
critique loop cannot close without it.

### 4.3 Authorable HTML subset

Enforced by `validate_markup` before anything reaches Paper:

- Inline styles only (`style="…"`). No classes, no stylesheets.
- **Forbidden:** `margin`, `display: inline`, `display: grid`, HTML tables.
- Layout is **flex + padding + gap**, exclusively. `display: block` is acceptable for
  text and decorative shapes, never for layout containers.
- `border-box` sizing assumed everywhere.
- Design tokens referenced as CSS variables.
- `layer-name="…"` attribute sets the Paper layer-tree name.
- Icons must be SVG or `img`. Never emoji.
- Local images: `paper-asset://` + absolute path.
- No rich text. Code blocks are a single element with `white-space: pre`.
- Absolute positioning allowed for decoration; must not blanket an artboard.

"No grid" is the severe one — every layout must be flex-decomposed.

### 4.4 Token ordering contract

`create_tokens` is order-sensitive:
- Colors: **semantic before palette**; within those, neutral → primary → secondary → accent.
- All other types: **smallest value first**.
- Aliasing via `var(--other-token)`.
- Token types (v0.5.12): `breakpoint`, `color`, `container`, `fontFamily`, `fontSize`,
  `fontWeight`, `letterSpacing`, `lineHeight`, `opacity`, `radius`, `spacing`. `opacity` arrived
  in v0.5.12; its values are a 0–1 number or a percent string. The guide adjusts a colour
  token's opacity with `color-mix(var(--color-x) 40%, transparent)`, optionally with an opacity
  token in place of the percentage.

### 4.5 Session protocol

- `get_guide({topic: "paper-mcp-instructions"})` MUST be called once per session before
  other Paper tools.
- `get_font_family_info` MUST be called before the first typographic styling.
- `finish_working_on_nodes` MUST be called when a write sequence completes.
- Raw node IDs are never shown to the user.
- Exact values come from `get_jsx` / `get_computed_styles` / `get_tokens` — **never**
  read sizes or colors from screenshots.
- `fileId` is **required** by 28 of the 34 tools. Only `get_basic_info` and `get_selection`
  accept it as optional, and `list_files`, `create_file`, `get_font_family_info` and
  `get_guide` don't take it. Take it from the `get_basic_info` file header (§4.7) and pass it
  explicitly.
- Check every file header. If `file.id` is not the intended file, stop and pass the right
  `fileId`. If `contentHash.tokens` changed since the last token read, tokens were edited
  outside the session: re-read with `get_tokens` before relying on token names or values.

### 4.6 No motion, no variants

Probed across all 34 tools: there is **no** animation, transition, keyframe, easing, or
hover primitive, and **no variant primitive**. `video`/`duration` appear only in `export`
(Paper can export an MP4 of what it renders natively; an agent cannot author motion
through MCP).

Validated a second time against Paper's own authoritative `paper-mcp-instructions` guide
(18,603 chars): `transition`, `animat`, `motion`, `keyframe`, `easing`, `hover`, `duration`,
`variant`, `interactiv` and `prototyp` each occur **zero** times. The single `state`
occurrence refers to semantic *colour* states (success/warning/error), not interaction
states. Two independent authoritative sources agree.

**Rejected:** relying on CSS `transition`/`animation` surviving `write_html`. Undocumented,
invisible on canvas, free to change in any release. We do not build on unspecified passthrough.

Two consequences:

1. Motion is not authorable. It exists only as **duration/easing tokens** plus prose that
   rides to handoff. It is therefore not a seat.
2. Component states are not properties. The disabled state of a button is **another node**,
   produced by `duplicate_nodes` + `update_styles`. State design is composition work.

### 4.7 Response envelope

Probed on v0.5.11 and v0.5.12; the guide documents it under "Use file headers to verify".

- Every **file-scoped** tool (any that accepts `fileId`) returns **two** JSON text blocks: a
  file header `{ file: { id, name }, contentHash: { tokens } }`, then the tool's own payload.
  They are separate JSON documents and must be parsed separately; joined, they are not JSON.
- Tools that are not file-scoped return a single block. `get_guide` returns prose.
- Tool failures, such as a missing required argument, come back **in-band**: a normal result
  with `isError: true` and an explanatory text block, not a protocol error. They must never
  be treated as data.

## 5. Architecture

```
any AI agent ──MCP──▶ Atelier          (design intelligence + process state)
      │                   │
      │                   └── MCP client ──▶ paper-desktop  (reads: screenshots,
      │                                        styles, tokens, comments, JSX)
      └──────────────MCP─────────────────▶ paper-desktop  (writes: caller executes)
```

Atelier is simultaneously an MCP **server** to its callers and an MCP **client** of
`paper-desktop` for reads. Writes are executed by the caller against Paper directly —
Atelier plans and validates them but never proxies them.

**Rationale for not proxying writes:** a proxy layer drifts out of sync every time Paper
ships a version, duplicates a 34-tool surface we do not own, and hides the tool the user
already trusts. Planning + validation gives the same safety with none of the coupling.

### 5.1 Ownership rule

**Paper owns all design data. Atelier owns only process data.**

| Paper owns | Atelier owns |
|---|---|
| tokens, nodes, geometry, copy, comments, files | current stage, decisions + rationale, rubric scores per round, semantic-name↔nodeId map, rejected directions |

When the two disagree, **Paper wins** and Atelier re-derives by reading. Atelier's state
is a process journal, never a design mirror.

### 5.2 Persistence

Session state persists locally (SQLite), keyed by Paper `fileId`, so a consult survives
an agent restart. On resume, the semantic-name↔nodeId map is re-verified via `find_nodes`
and stale entries re-resolved.

### 5.3 Execution model

**Conductor by default:** Atelier returns each seat's brief as structured instructions;
the *calling* agent executes them with its own model. No API key, no double billing,
works in every MCP client, and the caller retains its codebase context.

**Optional fan-out:** when `ANTHROPIC_API_KEY` is present, designated heavy stages
(notably generating 3 divergent visual directions in parallel) may run as server-side
agents. Off by default, per-stage opt-in.

## 6. The seats

Each seat is a **contract**: typed input, typed output schema, and the Paper tools it is
permitted to touch.

| Seat | Owns | Paper surface |
|---|---|---|
| **Strategist** | Requirement interrogation, JTBD, IA, success criteria, screen inventory | *none* — works with Paper closed |
| **Visual Director** | 3 divergent directions, tone, signature element, explicit rejection of defaults | `get_font_family_info` |
| **Design Systems** | **Mints the vocabulary.** Palette, type scale, spacing, radius, elevation, and motion tokens — in contract order. Sole writer to the token store | `create_tokens`, `get_tokens`, `set_tokens` |
| **Composition & States** | **Spends the vocabulary.** Flex decomposition, layer naming, ordered write plan, every component state as real nodes, focus order. Annotates motion for handoff | *(plans writes; caller executes)* |
| **Critic** | Rubric scoring, WCAG contrast, tap targets, responsive tiers → posts comment threads | `get_screenshot`, `get_computed_styles`, comment tools |
| **Handoff Engineer** | Idiomatic code per target, token export *(Slice 2)* | `get_jsx`, `get_computed_styles`, `get_tokens` |
| **Design Head** | Stage gating, convergence, conflict resolution | session state machine |

**Boundary test.** If a seat calls `create_tokens`, it is Design Systems. If it plans node
writes, it is Composition & States. There is no third case.

## 7. Tool surface

**Consult**
- `preflight()` — Paper running? file open? guide loaded? fonts available? Returns
  actionable remediation, not a stack trace.
- `start_consult({brief, target, constraints})` — opens/creates the Paper file, returns
  session id + Strategist brief.
- `advance({sessionId, stageOutput})` — **the spine.** Records a stage's output, gates,
  returns the next seat's brief.
- `get_session({sessionId})` — stage, decisions, scores, open threads.
- `ask_designer({role, question, context})` — one-shot consult with no pipeline, for
  agents that want an opinion rather than a project.

**System**
- `establish_tokens({sessionId, tokenPlan})` — validates the §4.4 ordering contract and
  returns an ordered `create_tokens` payload.
- `audit_tokens({sessionId})` — drift, duplicates, unaliased literals.

**Materialise**
- `plan_materialization({sessionId, screens})` — ordered write plan: which primitive,
  which target node, in what order, one visual item per step (§4.1).
- `validate_markup({html})` — enforces §4.3; returns violations with fixes **before**
  the caller sends anything to Paper.

**Loop**
- `critique({sessionId, nodeId, rubric?})` — screenshots + computed styles + tokens →
  scored findings.
- `post_findings({sessionId, findings})` — findings become Paper comment threads.
- `sync_feedback({sessionId})` — pulls open threads (human **and** agent) back into the
  session; resolves threads whose findings are addressed.

**Motion**
- `specify_motion({sessionId, from, to, trigger, durationToken, easingToken, notes})` —
  records one transition edge in the motion graph (§10.2).
- `get_motion_graph({sessionId})` — the full edge set, for review and handoff.

**Ship** *(Slice 2)*
- `handoff({sessionId, nodeId, target})` — React / Vue / Flutter / SwiftUI / Compose +
  token file.

## 8. Session state machine

```
DISCOVERY ──▶ DIRECTION ──▶ SYSTEM ──▶ MATERIALIZE ──▶ CRITIQUE ──▶ CONVERGED
  (Strategist) (Vis. Dir.)  (Systems)  (Composition)    (Critic)
                                          ▲                │
                                          └── refine ◀─────┘
                                       (mutation only, §4.2)
```

- `DISCOVERY` and `DIRECTION` run with Paper closed. `preflight` gates `SYSTEM` onward.
- The refine edge is **mutation-only**. Genesis happens once, in `MATERIALIZE`.
- `CONVERGED` on rubric threshold or round cap (default 3), whichever comes first.

## 9. The critique loop

1. Critic captures `get_screenshot` per responsive artboard tier (375 / 768 / 1440 —
   Paper artboards are fixed-size, so responsive coverage is multi-artboard).
2. Reads exact values via `get_computed_styles` + `get_tokens`. **Never** from pixels.
3. Scores against a rubric: contrast (WCAG AA), tap targets (≥44px), focus visibility,
   type scale consistency, token adherence, state coverage, direction fidelity.
4. Findings post as comment threads pinned to the offending nodes.
5. Refinement mutates in place; `sync_feedback` resolves threads that are addressed.
6. A human replying on the canvas enters the same loop — this is the mechanism behind
   "becomes a design team for any product."

## 10. Motion

Per §4.6, Paper has no motion concept at all. Motion is therefore the canonical case for the
§5.1 ownership rule: **Paper owns what it can express; Atelier owns what Paper cannot.**

### 10.1 Three-part model

1. **Motion tokens** — Design Systems mints `--motion-*` duration and easing tokens via
   `create_tokens`. Real Paper tokens, so they survive `get_tokens` to handoff verbatim and
   stay consistent with the rest of the vocabulary.
2. **States as nodes** — Composition & States builds each state (rest, hover, pressed,
   disabled, loading) as a real node via `duplicate_nodes` + `update_styles`, per §4.6.
   The Critic screenshots and scores each.
3. **Transition edges** — Atelier process state (§10.2).

### 10.2 The motion graph

A directed graph over real Paper node IDs. Node IDs reference Paper (truth); the edges are
Atelier's, because Paper has no primitive for them. Edges are re-verified via `find_nodes`
on session resume like any other node reference (§5.2).

Handoff walks the graph and emits per target:

| Target | Emission |
|---|---|
| CSS / Tailwind | `transition-property` / `duration` / `timing-function` from the tokens |
| React / Framer Motion | `variants` map, one entry per state node; edge becomes `transition` |
| SwiftUI | `withAnimation(.timingCurve(…))` between view states |
| Flutter | `AnimatedContainer` / `AnimationController`, matched curve + duration |
| Compose | `animate*AsState` with a tokenised `tween` |

### 10.3 Critic rubric additions

- Every interactive component has a state set — at minimum rest, focus, disabled.
- Every edge references motion *tokens*, never literal values.
- No orphan states: every non-rest state is reachable by at least one edge.

### 10.4 Out of scope for Slice 1

Motion **preview**. Watching a sequence play requires rendering outside Paper (a derived HTML
preview — Slice 4). Slice 1 specifies motion completely and hands it off correctly. It does
not animate it.

## 11. Failure modes

| Failure | Handling |
|---|---|
| Paper Desktop closed | `preflight` fails with remediation; DISCOVERY/DIRECTION still run |
| No file open | `preflight` offers `create_file` |
| Node IDs stale on resume | re-resolve via `find_nodes` against semantic-name map |
| Paper version drift | capability probe via `tools/list` at startup; degrade on missing tools |
| Paper tool error (`isError` result) | raised as a typed error; reported as a failed check or finding, never read as data |
| Tokens edited outside the session | the file header's `contentHash.tokens` changes; re-read with `get_tokens` (Paper wins, §5.1) |
| Rubric never converges | round cap → return best round + unresolved findings, do not loop forever |
| Caller ignores `validate_markup` | Critic catches it downstream as a finding |

## 12. Testing

- **TDD throughout.** Tests precede implementation.
- **Record/replay fake** of `paper-desktop` built from real captured responses (captured
  from v0.5.12: `initialize`, `tools/list` with full schemas, and the `paper-mcp-instructions`
  guide; plus the two-block `get_basic_info` response with synthetic values). The fake
  reproduces the file header on file-scoped tools and in-band `isError` failures. Before code
  depends on another tool's payload, capture that tool's real response the same way.
- Live integration tests against running Paper behind an env flag.
- Rubric tests use fixture screenshots with known violations.

## 13. Build order

**Slice 1 (this spec):** conductor core, session state machine, seats 1–5, token
establishment, materialisation planning + validation, **and the critique loop**.
Outcome: a requirement goes in; a tokenised, critiqued, hand-built design exists in Paper.

**Slice 2:** handoff adapters (React, Vue, Flutter, SwiftUI, Compose).
**Slice 3:** server-side fan-out for parallel direction generation.
**Slice 4:** multi-file / multi-project memory; design-system reuse across consults.

## 14. Stack

TypeScript, official MCP SDK (`@modelcontextprotocol/sdk`), SQLite for session state
(Node's built-in `node:sqlite`, so Node ≥ 22.13), Vitest for tests. Distributed as a local MCP server added via
`claude mcp add atelier --scope user`.

## 15. Open questions

1. **Direction divergence without materialisation.** Visual Director proposes 3
   directions, but they cannot be *seen* without building them in Paper — which is
   expensive. Options: materialise one hero component per direction (cheap, comparable),
   or describe-then-pick. **Proposal: one hero component per direction**, since choosing
   a look from prose is exactly the failure mode Atelier exists to prevent.
2. **Rubric weighting** is currently uniform. Should direction fidelity outrank
   accessibility in early rounds and invert near convergence? Deferred to implementation
   once we can see real scores.
