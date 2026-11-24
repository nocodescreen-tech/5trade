# Market Setups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evaluate multiple market-specific setups independently and measure net performance without a universal Fibonacci filter.

**Architecture:** Existing strategy profiles remain the source of setup rules. The selector enforces market and regime declarations, while backtests receive request-scoped cost assumptions. Research tooling consumes the same profiles and groups results by setup, market and regime.

**Tech Stack:** Node.js, CommonJS, node:test, existing 5trade engines.

**Spec:** `docs/superpowers/specs/2026-11-24-market-setups-design.md`

## Global Constraints

- No setup or indicator is universal.
- Research never mutates saved user configuration.
- Performance is net of declared costs and labeled by sample.
- This plan does not execute broker orders.

---

### Task 1: Isolate research costs

**Files:** Modify `api/core/frais.js`, `api/engine/analyse.js`, `api/engine/backtest.js`, `api/engine/signaux.js`, `api/engine/journal-signaux.js`; test `api/tests/analyse-frais.test.js`.

- [x] Add a regression test that preserves custom fees after success and failure.
- [x] Pass optional fee configuration through filtering and trade evaluation.
- [x] Run the focused node test.

### Task 2: Enforce setup regimes

**Files:** Modify `api/engine/signals.js`, `api/strategy-engine/selector.js`; test `api/tests/selector-regimes.test.js`.

- [x] Add failing tests for profile regime propagation and unknown or incompatible regimes.
- [x] Preserve `supportedRegimes` in profiles.
- [x] Reject regime-restricted setups until the declared regime matches.

### Task 3: Build the experiment matrix

**Files:** Create `api/data-engine/comparer-setups.js`, `api/tests/comparer-setups.test.js`; modify `api/package.json`.

- [x] Test grouping by setup, market and regime with fixed chronological train and test boundaries.
- [x] Compare existing backtests using net costs, trade counts, expectancy and PSR.
- [ ] Export JSON and CSV with rejection reasons and no automatic winner selection.
- [ ] Add an npm command and run the focused test.

### Task 4: Add prospective paper evidence

**Files:** Create `api/engine/paper-observations.js`, `api/tests/paper-observations.test.js`; modify `api/server.js`.

- [ ] Test append-only creation, expiration and outcome recording.
- [ ] Store setup version, market state, price timestamp, costs and invalidation.
- [ ] Expose authenticated read-only status and history endpoints.
- [ ] Run focused tests and the canonical verification suite.
