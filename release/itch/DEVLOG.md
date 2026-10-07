# Devlog #1 — Rules first, code second

**Squarefolk is playable in your browser now** — a tiny turn-based strategy game that fits in a single 74 KB HTML file. This first devlog explains how it's built.

## A public rulebook comes first

Before any engine code, the whole game was written as a rules document: movement, combat formulas, fog of war, economy, victory — all specified down to integer arithmetic. The implementation is not allowed to disagree with the rules document. When they do, the document wins and the code changes.

## Golden test vectors

Every rule ships with golden test vectors: small game states hand-calculated from the rules, with the exact expected outcome written down. The project now has **68 vectors and 146 automated assertions**. A careless edit can't slip through — tests go red before a player ever sees it.

This process caught real bugs, for example:

- an off-by-one in city unit capacity that silently locked training at game start
- a missing combat branch where a unit dies to a counter-attack and its corpse kept blocking the tile

## A few design decisions

- **Fully deterministic.** All combat math is integer-only with no random numbers. Same seed → same map, same battle outcomes. Replays are exact.
- **Fair fog.** The AI explores under the same vision rules you do — no hidden map knowledge.
- **Siege matters.** Break the wall first, then enter from an adjacent tile to capture. Cities under siege can still raise defenders, and a crowded siege line slowly erodes the wall.
- **A comeback window.** Taking the last city doesn't end the game instantly — a player with units still in the field gets a short grace period to recapture something.
- **Anti-snowball.** A city's unit capacity grows with its level, so a runaway leader can't simply stockpile an army.

## Tech notes

TypeScript, zero dependencies, no server, no tracking. One self-contained HTML file that runs offline in any modern browser.

## What's next

- Balance pass driven by a headless simulation
- A stronger AI opponent
- English UI (the current interface is Chinese-only)
- More units and technologies

---

**Play it** in the browser on this page · **Source code**: <https://github.com/boltomli/squarefolk>
Licensed CC BY-NC-SA 4.0 (non-commercial).
