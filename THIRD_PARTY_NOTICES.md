# Third-Party Notices

## dsh-fish-memory

The integrated long-term-memory functionality is derived from the design and portions of **dsh-fish-memory**.

- Upstream repository: https://github.com/Yuuyuko-uu/dsh-fish-memory
- Original author: Yuuyuko-uu / Yuuyuko
- Upstream license: MIT
- Preserved license: `vendor/fish-memory/LICENSE`

Upstream contributions include the core concepts and implementation approach for per-session time-stamped fading memories, stable facts, fact keys, replacement semantics, scoped memory tools and context recall.

Changes made by `dsh-bili-scroll-plus` include:

- integration into the explicitly selected “大肥鱼主 Session” instead of a separate plugin lifecycle;
- Claude/Anthropic-compatible ASCII tool-schema property names;
- deterministic ingestion of DaFeiYu's own Bilibili experiences without additional summarization-model calls;
- a unified DaFeiYu management UI, backup/restore path, and old `~/.dsh/fish-memory/<session>.json` import;
- isolation from Bilibili credentials, other DSH session transcripts, and unrelated sessions.

This integration is independently maintained and is not an official release of the upstream author.

## bilibili-mcp

- Directory: `vendor/bilibili-mcp/`
- Project: bilibili-mcp
- License: MIT, Copyright (c) 2026 AGI_Ananas
- Full license: `vendor/bilibili-mcp/LICENSE`

## dsh-bili-scroll upstream

This Plus project is derived from **c1overzz/dsh-bili-scroll** and retains its MIT license and attribution in the repository root.
