# Production Core Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore a green canonical verification path and strengthen the research terminal, controlled learning, PostgreSQL evidence, and dependency security without enabling broker execution or touching production.

**Architecture:** Keep live display read-only and all broker execution suspended. Treat PostgreSQL as the authoritative store for prospective evidence and delivery outboxes, make external integration checks explicit and disposable, and preserve setup-specific market/regime eligibility. Repair regressions at their behavioral boundary instead of weakening fail-closed gates.

**Tech Stack:** Node.js, node:test, Express, postgres.js, static React bundle, GitHub Actions PostgreSQL service

**Spec:** `docs/PRODUCTION-HARDENING.md`

## Global Constraints

- Do not merge `main`.
- Do not enable real orders or broker execution.
- Do not use production credentials, databases, bots, or deployment targets.
- Fibonacci and every other setup remain independent; each setup enforces its declared markets and regimes.
- Profitability claims require costs, out-of-sample evidence, prospective paper observations, and human review.

## Review Focus

- A strict strategy selection with an incomplete or incompatible profile must fail closed before market analysis.
- Read-only terminal streams must never mutate journals, positions, or broker state.
- Queued delivery must distinguish accepted-for-delivery from confirmed delivery and retain uncertainty.
- PostgreSQL checks must run only against a disposable database and prove migrations are additive and idempotent.
- Missing market, calendar, cost, or data-quality evidence must produce an explicit unknown/refusal rather than a fabricated result.

---

### Task 1: Canonical regression suite

**Files:**
- Modify: `api/verify.js`
- Modify only if behavioral evidence requires it: `api/delivery/alerts.js`, `api/delivery/scan.js`, `api/chat-crud/*`, `api/server.js`
- Test: `api/tests/production-hardening.test.js`

**Interfaces:**
- Consumes: strict strategy profiles, read-only display gates, PostgreSQL outbox semantics
- Produces: a canonical `npm test` whose legacy checks exercise current behavior rather than stale source shapes

- [ ] Reproduce and classify all nine failures against the commits that introduced the new boundaries.
- [ ] Replace source-text checks with observable behavior where practical and repair stale fixtures without weakening fail-closed production logic.
- [ ] Run the focused hardening tests and full canonical verification.

### Task 2: Dependency security

**Files:**
- Modify: `api/package.json`
- Modify: `api/package-lock.json`
- Modify only if compatibility requires it: upload and middleware call sites
- Test: `api/tests/production-hardening.test.js`, canonical verification

**Interfaces:**
- Consumes: existing Express routes, 15 MiB upload boundary, HTML parsing and email delivery
- Produces: a reproducible dependency tree with materially reduced or eliminated known high-severity findings

- [ ] Record the current audit as the failing security baseline.
- [ ] Apply the smallest compatible upgrades/removals, preserving route and upload behavior.
- [ ] Run `npm audit`, focused tests, syntax verification, and the canonical suite.

### Task 3: Disposable PostgreSQL integration evidence

**Files:**
- Create or modify: focused PostgreSQL integration test under `api/tests/`
- Modify: `.github/workflows/verifier.yml`
- Modify if required: `api/db/schema-phase2.sql`, `api/core/db.js`

**Interfaces:**
- Consumes: `DATABASE_URL` pointing only to a disposable database
- Produces: CI evidence for migrations, registry/evidence persistence, outbox claims, and idempotency

- [ ] Add a test that skips explicitly without `TEST_DATABASE_URL` and refuses non-disposable-looking targets.
- [ ] Configure a PostgreSQL service in verification CI and run the integration test with a dedicated database.
- [ ] Run all locally available tests and validate workflow/schema syntax without contacting production.

### Task 4: Controlled-learning and terminal safety closure

**Files:**
- Modify as evidence requires: `api/apprentissage/*`, `api/engine/paper-observations.js`, `frontend/src/app.jsx`, `frontend/build/app.js`
- Test: focused hardening tests and canonical verification

**Interfaces:**
- Consumes: prospective observations, versioned candidates, shadow runs, human promotion decision
- Produces: explicit review state in API/UI; no autonomous promotion without evidence and human approval

- [ ] Trace the candidate-to-promotion path and add a failing regression for any automatic or unreviewed promotion path.
- [ ] Enforce human-review metadata at the promotion boundary and expose it in the research terminal if missing.
- [ ] Verify source and checked-in bundle stay aligned, then run the complete suite.

