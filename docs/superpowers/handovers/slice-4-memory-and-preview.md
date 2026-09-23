# Handover — Slice 4: Cross-Project Memory, Reuse, and Motion Preview

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

**Slices 1 and 2 must be complete** — reuse needs the token store, preview needs the motion
graph and the emission work. If either is unfinished, stop and tell the user.

## What this slice delivers

Three related capabilities:

1. **Multi-file support** — `list_files`, `create_file`, `open_file`, `create_page` become
   first-class, so a consult can target a file other than the one the user is looking at.
   (Note Paper's rule: `pageId` defaults to the user's viewed page and **you cannot switch
   their page** — pass a page explicitly to work elsewhere without disrupting them.)
2. **Design-system reuse across consults** — a token set established for one project can seed
   another.
3. **Motion preview** — deferred here by §10.4. A derived HTML page that plays a state sequence
   so a human can actually watch the motion the graph specifies.

## Hard constraints

- **§5.1 still governs.** Paper owns design data. A stored token snapshot **is** design data,
  so it is a **cache, never truth**: stamp it, re-derive from `get_tokens`, and let Paper win
  on every conflict. Getting this wrong quietly reintroduces the second-source-of-truth problem
  the whole architecture was built to avoid.
- **Preview is derived, exactly like a screenshot.** It renders from Paper's state nodes +
  tokens + the motion graph. It must never become something the user edits, and nothing may
  read design values back out of it.
- **Cross-project memory is a privacy boundary.** One client's design system must not leak into
  another client's consult by accident. Reuse is opt-in and explicitly scoped — state the
  scoping rule in the spec before writing code.

## Decisions for brainstorming

- **What is the unit of reuse** — a token set, a single component, a whole "house style"? Pick
  the smallest unit that is actually useful.
- **Precedence** when an inherited system conflicts with a project's own tokens.
- **Preview mechanism:** a static self-contained HTML file the user opens, or a Playwright
  render? Prefer the static file — no new runtime dependency, works offline, and it cannot
  drift into being a second editor.

## A warning about scope

This is the most speculative of the four slices, and the one most likely to be over-built.
Expect brainstorming to **cut** scope rather than grow it. If cross-project reuse turns out to
serve no real workflow the user has, say so and drop it — shipping multi-file support and motion
preview alone is a perfectly good outcome. YAGNI applies hardest here.

## Done when

- A consult can target a named file without disrupting the user's current page
- A second consult can adopt a prior token set under an explicit, stated scoping rule
- Motion preview plays a state sequence in a browser from the motion graph alone
- No stored snapshot is ever treated as truth over Paper
