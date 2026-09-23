# Handover — Slice 2: Handoff Adapters

## Before anything else

**Atelier** is a local TypeScript MCP server that gives any AI agent a six-seat design team,
with **Paper.design as the source of truth** for all design data. Paper's own MCP server
(`paper-desktop`) runs at `http://127.0.0.1:29979/mcp` when the Paper desktop app is open with
a file.

Read these first, in order:

1. `docs/superpowers/specs/2026-09-19-atelier-design.md` — the design spec. Its **§4 Verified
   constraints** were probed against a live `paper-desktop v0.5.8` and its own guide, not
   copied from public docs (which are wrong: they describe 24 tools; there are 34).
2. `docs/superpowers/plans/` — the implementation plans that have been executed so far.
3. **The actual code.** This handover was written before the code existed. Where it names a
   module or function, verify the real name in the repo rather than trusting this document.

Use the superpowers skills for the whole flow: `superpowers:brainstorming` first (this is
creative work on a new subsystem, so the architectural path applies), then a spec, then
`superpowers:writing-plans`, then `superpowers:executing-plans`. **Do not jump to code.**

Work on a feature branch. Never implement on `main`.

## Prerequisite (check before starting)

**Slice 1 must be complete** — plans 1A, 1B and 1C all executed and merged. Verify that
`establish_tokens`, `critique` and `specify_motion` exist and pass their tests. If Slice 1 is
unfinished, **stop and tell the user**; this slice reads its session state, token store and
motion graph.

## What this slice delivers

`handoff({ sessionId, nodeId, target })` — idiomatic code plus a token file for five targets:
**React/Tailwind, Vue, Flutter, SwiftUI, Compose**. This is the spec's "helps in development in
any programming language" promise.

## Hard constraints

- **§4.5 — the most important rule in this slice.** Exact values come only from `get_jsx`,
  `get_computed_styles`, `get_tokens` and `get_fill_image`. **Never** read a size or colour
  from a screenshot. Any adapter that does is wrong even if its output looks right.
- **Paper's own guide:** *"Always use the conventions of the user's codebase, translating the
  Paper CSS export into their conventions."* Idiomatic output is the requirement, not
  transpiled output — that is why the Handoff Engineer is a seat.
- **§4.3 flex-only is an advantage here.** Paper forbids grid, so every layout is flex +
  padding + gap. That maps cleanly onto Flutter `Row`/`Column`, SwiftUI `HStack`/`VStack`,
  Compose `Row`/`Column`. Lean on it.
- **§10.2** already specifies the motion emission per target. Implement that table.
- **§5.1** Paper owns design data. Handoff reads only; it must never write to Paper.

## The central decision for brainstorming

**Is `get_jsx` the spine, or do we build an emission IR?**

`get_jsx` returns React/Tailwind or inline-styles JSX — nearly free for the React target, but
turning JSX *text* into SwiftUI is a parsing problem. An IR assembled from `get_tree_summary` +
`get_computed_styles` + `get_tokens` costs more up front and fans out to five dissimilar
targets cleanly.

Note carefully: the spec rejected an IR as the **design source of truth**. That is a different
question from an **emission** IR. Rejecting the first does not reject the second. Decide this
deliberately rather than inheriting the earlier conclusion.

Two further decisions:

- **Token translation per target.** Paper tokens are CSS variables with `var()` aliasing, so
  resolution order matters (§4.4) and cycles must be rejected. React/Vue → CSS custom
  properties or a Tailwind theme; Flutter → a Dart theme class; SwiftUI → `Color`/`Font`
  extensions; Compose → a design-token object.
- **Codebase convention detection.** Tailwind? CSS modules? styled-components? Paper's guide
  requires matching the user's conventions, so detection belongs in this slice.

## Blocking gap — fix this first

`test/fixtures/` holds only tool schemas, the initialize response and the guide. **There is no
fixture of real design content** — no `get_jsx`, no `get_computed_styles`, no `get_tokens`
response.

Slice 2 cannot be tested without them. Before writing any adapter, ask the user to open Paper
with a representative design and capture those three responses into `test/fixtures/`.
**Do not invent fixture content** — the whole point is that emission matches Paper exactly.

## Done when

- All five targets emit compiling code from the captured fixtures, golden-file tested
- Tokens round-trip, aliases resolve, cycles are rejected
- The motion graph emits per §10.2
- No adapter reads a screenshot for any value
