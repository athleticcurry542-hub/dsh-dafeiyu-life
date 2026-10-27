# dsh-fish-memory upstream attribution

The integrated long-term-memory module in `lib/long-term-memory.mjs` is derived from the design and portions of:

- Project: **dsh-fish-memory**
- Upstream: https://github.com/Yuuyuko-uu/dsh-fish-memory
- Original author: **Yuuyuko-uu / Yuuyuko**
- License: **MIT**
- Upstream version reviewed for this integration: **1.3.3** (2026-10-27)

This directory preserves the upstream MIT license. The DaFeiYu integration keeps the upstream ideas of per-session memory, time-based fading, stable facts, fact keys, replacement semantics, a scoped remember tool, and relevant recall. It intentionally does not copy the upstream standalone settings page, self-updater, archive-distillation UI, or independent plugin lifecycle.

Compatibility changes in dsh-dafeiyu-life include ASCII-only model-facing tool argument names (`supersedes`, `fact_key`) for strict Claude/Anthropic tool schemas, direct deterministic ingestion of DaFeiYu's own Bilibili experiences without an extra model call, and integration into the existing “大肥鱼的家” management page and backup system.
