# Claude Society of Mind

This was an experiment to see how far Claude could go in taking Marvin Minsky's *The Society of Mind* (1986) and building a working implementation of it.

> **Status: completed research exploration.** See [docs/FEASIBILITY.md](docs/FEASIBILITY.md) for findings and lessons learned. The code and documents are published as-is for anyone interested.

## What this is

An agentic system with long-term memory modeled on Minsky's ideas. Intelligence is meant to come from the interaction of many specialized, LLM-backed agents organized into societies, with persistent memory, learning from failure, and structured coordination. There is no central controller.

Each agent is a capable reasoner within its own narrow domain and knows nothing of the larger picture. The society supplies what individual agents lack: memory, coordination, and failure learning.

## Minsky concepts and how they map to code

| Concept | Meaning | Implementation |
| --- | --- | --- |
| **Agent** | Specialized reasoner | `src/core/agent/`: deterministic handler or LLM-backed (Claude Haiku by default) |
| **Agency** | Group of agents acting as one capability | `src/core/agency/`: recursive nesting |
| **Polyneme** | Signal each subscriber interprets in its own way | `src/core/polyneme-bus/`: pub/sub bus with glob patterns |
| **Pronome** | Temporary role binding (Actor, Goal, ...) | `src/core/context/`: context store |
| **K-line** | Memory of which agents were active during a success | `src/core/kline/`: SQLite store, hybrid vector + full-text retrieval |
| **Level-band** | Confidence gradient within a K-line | Core / peripheral / fringe bands on each K-line |
| **Censor / Suppressor** | Guards that block known-bad patterns | `src/core/censor/`, `src/core/kline/censor.ts` |
| **Frame** | Knowledge template with slots and default values | `src/core/frame/`: frames, trans-frames, frame-arrays, inheritance |
| **Difference-engine** | Goal loop comparing current and desired state | `src/core/goal/` |
| **Cross-exclusion / Noncompromise** | Mutual inhibition; when conflict persists, suppress both sides | `src/core/conflict/` |
| **B-Brain** | Supervisor that watches without taking part | `src/core/bbrain/`: detects loops, error bursts, conflict spirals, stalls |

## What was built

- **Phase 0, infrastructure:** append-only SQLite event log, the polyneme signal bus, and a real-time introspection web app.
- **Phase 1, agents:** the Agent base class, agency container, context store, and a query interface (activation, causal trace, reasoning probe, memory probe, censor check).
- **Phase 2, K-line memory:** capturing and retrieving K-lines, capturing censors from failures, and memory visualization in the introspection app.
- **Phase 3, frames:** frame storage with inheritance, frame matching and slot-filling, trans-frames, and frame-arrays.
- **Phase 4, coordination:** the difference-engine, cross-exclusion and noncompromise, censor guards, and the B-Brain observer.
- **Phase 5, demos:** a block-building society (Find, See, Grasp, Move and Put agents) and a conversational agent that remembers earlier sessions through K-lines.

The core package has 238 tests across 39 suites.

## Repository layout

```text
docs/                 Architecture, feasibility analysis, K-line memory design, demo guide
  V1_0/               Frozen snapshot of the V1.0 documents
src/core/             @som/core: Node.js + TypeScript (ESM) implementation and tests
src/introspection/    Next.js app for watching agent activity and memory in real time
```

Good places to start reading:

- [docs/PROJECT_SUMMARY.md](docs/PROJECT_SUMMARY.md): overview of the project
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): full system design and the mapping from concepts to code
- [docs/FEASIBILITY.md](docs/FEASIBILITY.md): critical analysis of the approach
- [docs/KLINE_MEMORY.md](docs/KLINE_MEMORY.md): design of the K-line memory
- [docs/DEMO_GUIDE.md](docs/DEMO_GUIDE.md): how to run the demos

## Running it

Requires a recent version of Node.js (developed on Node 22).

```bash
# Core library and tests
cd src/core
npm install
npm test

# Write sample events to ~/.som/events.db
npm run emit-test

# Demos
npm run seed-demo
npm run converse
npm run demo:cross-society
npm run demo:learning-curve
```

```bash
# Introspection app at http://localhost:3000
cd src/introspection
npm install
npm run dev
```

The introspection app streams the real event log at `~/.som/events.db` when it exists and falls back to a simulated block-stacking run otherwise. LLM-backed agents need an Anthropic API key in `ANTHROPIC_API_KEY`. Most agents and tests are deterministic or run in stub mode.

## Operating modes

- **OBSERVE** (default): agents reason and build up K-line memory, but tool calls are logged as intents and not executed.
- **ACT**: tool calls execute, subject to per-tool tiers (auto-allow, requires approval, deny).

See [docs/OBSERVE_AND_CONTROL.md](docs/OBSERVE_AND_CONTROL.md).

## Note on the source text

The book text used as a reference during development is not included in this repository because of copyright.

## License

MIT. See [LICENSE](LICENSE).
