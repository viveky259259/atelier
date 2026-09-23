# Handover — Slice 3: Server-Side Fan-Out

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

**Slice 1 must be complete.** This slice adds a second execution mode behind the existing seat
contracts; those contracts must exist and be tested first. If Slice 1 is unfinished, stop and
tell the user.

## What this slice delivers

Spec §5.3's optional mode: when `ANTHROPIC_API_KEY` is present, designated heavy stages run as
**server-side Claude agents** instead of returning briefs for the calling agent to execute.
The spec names one stage: generating **3 divergent visual directions in parallel**.

## Hard constraints

- **Conductor stays the default.** Fan-out is off unless a key is present *and* the stage is
  opted in. A user without a key must see zero behavioural change.
- **Identical output shape in both modes.** Downstream stages must not be able to tell which
  mode produced a seat's output. This is the central invariant: design the seat output schema
  as the contract, then make both modes satisfy it. If a downstream stage ever branches on
  execution mode, the design is wrong.
- **The caller's codebase context is lost in fan-out.** Retaining it is conductor mode's main
  advantage (§5.3). Anything a server-side agent needs must be passed explicitly into the
  session — do not assume it can see the user's repo.
- **Failure falls back; it never fails the session.** An API error means that stage reverts to
  conductor mode and says so in its response.
- **Cost is the user's.** Fan-out spends their tokens on top of the calling agent's. Report
  usage per stage; never spend silently.

## Decisions for brainstorming

- **Which stages are eligible?** The spec names direction generation only. Argue explicitly for
  any addition; default to the narrowest set that earns its complexity.
- **Model per stage.** The current Claude models are Opus 5, Sonnet 5 and Haiku 4.5
  (`claude-opus-5`, `claude-sonnet-5`, `claude-haiku-4-5-20251001`). Divergent creative work
  wants the strongest model; mechanical stages do not.
- **Genuine divergence.** Three parallel agents given the same brief tend to return three
  variations of one idea. How are outputs compared and pushed apart so the user gets a real
  choice? This is the whole reason the stage was picked for fan-out — if it produces
  near-duplicates, the slice has failed even when the code works.

## Testing

**Never call the real API in tests.** Fake the Anthropic client the way `test/fakes/` fakes
`paper-desktop`. One live integration test may exist behind an env flag, skipped by default.

## Done when

- With no key: behaviour is identical to Slice 1, proven by the existing suite still passing
- With a key: direction generation fans out, and downstream stages cannot tell
- An API failure falls back to conductor mode with a clear message, and the session continues
- Per-stage token usage is reported
