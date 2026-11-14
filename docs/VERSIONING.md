---
title: Documentation Versioning Guide
version: "1.0"
date: 2026-03-24
author: Lew Tucker
---

# Documentation Versioning Guide

## Version Scheme

Versions follow **V{major}\_{minor}** format:

- **Major** (V1, V2, ...): Significant architectural changes, new system concepts, or fundamental redesigns based on experimental findings
- **Minor** (V1\_0, V1\_1, ...): Refinements, clarifications, new sections, or corrections within the same architectural vision

## Folder Structure

```
docs/
├── ARCHITECTURE.md        ← living copy (always latest version)
├── ARCHITECTURE.pdf
├── ARCHITECTURE.html
├── FEASIBILITY.md         ← living copy (always latest version)
├── FEASIBILITY.pdf
├── FEASIBILITY.html
├── VERSIONING.md          ← this file
├── V1_0/                  ← frozen snapshot, 2026-03-24
│   ├── ARCHITECTURE_V1_0.md / .pdf / .html
│   └── FEASIBILITY_V1_0.md / .pdf / .html
├── V1_1/                  ← next iteration (when ready)
│   └── ...
└── V2_0/                  ← major revision (when ready)
    └── ...
```

## Document Metadata

Every document must include YAML frontmatter:

```yaml
---
title: "Document Title"
version: "1.0"
date: YYYY-MM-DD
author: Lew Tucker
status: Draft | Review | Final
document-id: SOM-XXXX
changelog:
  - version: "1.0"
    date: YYYY-MM-DD
    summary: What changed in this version
  - version: "1.1"
    date: YYYY-MM-DD
    summary: What changed in this version
---
```

## Document IDs

| ID | Document | Purpose |
|---|---|---|
| SOM-ARCH | Architecture | System design, Minsky concept mapping, layer diagrams, implementation plan |
| SOM-FEAS | Feasibility | Critical evaluation, strengths/weaknesses, research questions |
| SOM-KLINE | K-Line Memory | K-line data model, capture/retrieval/consolidation implementation guide |
| SOM-OBS  | Observability & Control | OBSERVE/ACT modes, query interface, action tiers, approval flow, revised build order |
| SOM-SCN1 | Scenario 1: Block Stacking | Step-by-step walkthrough of the block tower demo — polynemes, K-lines, censors, B-brains |
| SOM-EXP  | Experiments | Results from building and testing (future) |
| SOM-API | API Reference | Agent interfaces, signal envelope schema, K-line format (future) |

## When to Create a New Version

**Minor version (V1\_0 → V1\_1):**
- Experimental results that refine the design but don't change fundamentals
- New sections added (e.g., adding API specs to the architecture)
- Corrections based on implementation experience
- Feasibility ratings updated based on evidence

**Major version (V1\_x → V2\_0):**
- Fundamental change to the agent model
- New Minsky concepts added or existing ones reinterpreted
- Architecture layer restructuring
- Experimental results that invalidate prior assumptions

## Process

1. Copy the previous version's folder contents to the new version folder
2. Rename files with new version number
3. Update the frontmatter (version, date, changelog)
4. Make changes to the content
5. Regenerate PDFs
6. Update this versioning doc's folder structure diagram if needed

## Living Documents

The files at the `docs/` root (`ARCHITECTURE.md`, `FEASIBILITY.md`) always reflect the **latest** version. They are working copies. The `docs/V{x}_{y}/` folders are frozen snapshots — they don't change after creation. `CLAUDE.md` stays at the project root.
