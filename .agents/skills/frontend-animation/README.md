# frontend-animation

A Claude Code skill that turns any concept, process, or workflow into an animated, interactive HTML demo. Domain-agnostic.

---

## Overview

If it has steps, sequence, or cause-and-effect — it can be animated. Give it a description, code snippet, or even a plain English explanation, and it generates a single self-contained HTML file that walks through the process visually, step by step.

No external JS dependencies. Pure HTML + CSS + vanilla JS.

---

## Works For Any Domain

| Domain | Examples |
|---|---|
| Finance | Compound interest, loan amortization, options pricing, order book |
| Education | Sorting algorithms, Dijkstra's, how HTTP works, supply & demand |
| AI / LLM | Agent loops, RAG pipelines, tool-calling chains, fine-tuning steps |
| Software / DevOps | CI/CD pipeline, OAuth flow, git branching, Docker build |
| Networking | TCP handshake, DNS resolution, CDN cache flow, load balancer routing |
| Science | Cell division, DNA replication, chemical reactions, Newton's laws |
| Business | Sales funnel, approval workflow, user onboarding, SLA escalation |
| Everyday | How a coffee machine works, how a bill becomes a law |

---

## How It Works

1. **Identifies the domain & narrative** — what story is being told, who's the audience
2. **Maps the flow** — stages, branches, loops, parallel tracks
3. **Chooses a layout tier** — chat/story window, multi-snippet comparison, parallel tracks, or simulation canvas
4. **Assigns viewer-paced timings** — fast enough to hold attention, slow enough to follow
5. **Builds the HTML** — self-contained, domain-appropriate visuals, realistic mock data
6. **Self-reviews** — layout, scroll, animation, and content checklists before saving

---

## Layout Tiers

| Tier | Use case |
|---|---|
| A — Single flow | One trigger → execution → result. Default for most explainers |
| B — Multi-snippet | Sidebar to compare multiple flows (e.g. algorithms, protocols) |
| C — Parallel tracks | Fan-out / fan-in for concurrent operations |
| D — Simulation | Canvas or DOM grid with play/pause/step/speed controls |

---

## Installation

Copy `SKILL.md` into your Claude Code skills directory (`.claude/skills/` or the path in your `settings.json`).

---

## Usage

Trigger phrases — Claude picks this skill automatically:

> "animate this", "show me how this works", "make a visual", "explain this visually",
> "walk me through", "build a simulation", "create an interactive explainer"

Paste code, a description, or just name a concept. The skill handles the rest.

---

## Output

Saved as `<topic-name>_animation.html`. Fully self-contained — open in any browser, no server needed.
