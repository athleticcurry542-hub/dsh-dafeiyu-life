# Third-Party Notices

This repository intentionally keeps third-party origins visible. The product name and repository rename do not erase upstream code ancestry.

## c1overzz/dsh-bili-scroll

- Upstream: https://github.com/c1overzz/dsh-bili-scroll
- Relationship: direct upstream / project ancestry
- License: MIT
- Preserved notice: repository root `LICENSE`

The original DSH Bilibili duty/report plugin forms the historical code base from which this project evolved.

## adoresever/bilibili-mcp

- Upstream: https://github.com/adoresever/bilibili-mcp
- Relationship: vendored and modified Python Bilibili MCP foundation
- License: MIT
- Copyright: Copyright (c) 2026 AGI_Ananas
- Preserved license: `vendor/bilibili-mcp/LICENSE`

Local modifications include restricted tool exposure, send-side policy enforcement, quotas, diagnostics, interaction state, meme/sticker support and additional Bilibili workflows.

## Yuuyuko-uu/dsh-fish-memory

The integrated long-term-memory functionality is derived from the design and portions of **dsh-fish-memory**.

- Upstream: https://github.com/Yuuyuko-uu/dsh-fish-memory
- Original author: Yuuyuko-uu / Yuuyuko
- Relationship: design + portions of implementation integrated and modified
- License: MIT
- Preserved license: `vendor/fish-memory/LICENSE`

Upstream contributions include the core concepts and implementation approach for per-session time-stamped fading memories, stable facts, fact keys, replacement semantics, scoped memory tools and context recall.

Changes made by `dsh-dafeiyu-life` include:

- integration into an explicitly selected “大肥鱼主 Session” instead of a separate plugin lifecycle;
- Claude/Anthropic-compatible ASCII model-facing tool-schema property names;
- deterministic ingestion of DaFeiYu's own Bilibili experiences without additional summarization-model calls;
- unified management UI, backup/restore and old `~/.dsh/fish-memory/<session>.json` import;
- isolation from Bilibili credentials, unrelated DSH sessions and stranger-DM content.

This integration is independently maintained and is not an official release of the upstream author.

## Yuuyuko-uu/dsh-bili-subagent

- Reference: https://github.com/Yuuyuko-uu/dsh-bili-subagent
- Relationship: architectural/product inspiration

Its “long-lived AI companion + going out to Bilibili + bringing experiences back home” model materially inspired this project's later “main Session = home / background plugin = body / local ledger = archive” direction.

No source from this repository is intentionally vendored as third-party code in `dsh-dafeiyu-life`; this notice exists to give clear credit for the architectural inspiration.

## Community contributors

See `CONTRIBUTORS.md` for fixes and implementation ideas adopted from community reports and pull requests.
