# Production hardening — delivery, research and validation

This branch is intentionally not deployed before verification.

## Telegram
- Set `TELEGRAM_WEBHOOK_SECRET` to a random 24–256 character URL-safe secret. Register the same value as Telegram's webhook secret_token. Only the configured private chat and its owner are authorized; group chats and unconfigured webhooks are rejected.
- Account mutations via Telegram are suspended. Manual briefings require authentication and POST. The periodic scheduler uses PostgreSQL's telegram_outbox; credentials are not stored in jobs.
- Pending jobs can expire, confirmed sends carry a message id, explicit 429 can be retried, and uncertain sends are not blindly retried. GET /api/alerts/outbox is authenticated.
- The production surveillance signal path now enqueues Telegram delivery in the outbox. Manual webhook responses and manual briefings remain direct. A queued message is not an acknowledged delivery. Telegram's API has no end-to-end exactly-once guarantee.

## Research
- Paper observations are OHLC touch observations, not broker fills.
- /api/performance excludes unresolved/null returns and identifies simulated data.
- Historical capital is settled once at exit, not at entry. The existing historical exit model still assumes a trade entry; it does not simulate matching or liquidity.
- To run rolling research offline: `node api/cli/walk-forward.js input.json output.json`. Input: symbol, timeframe, candles (closed chronological OHLCV), strategies (explicit compatible versioned documents), optional train/test sizes. Costs for that specific symbol must be configured. The CLI refuses overwrite of output.
- Rolling validation windows do not overlap. Only training results select each candidate. The model is isolated-window historical validation, not a production guarantee, and does not reproduce full MTF histories or historical macro data.
- Binance Spot taker volume supports measured delta/CVD for the received window. For other data, OHLC-derived order flow is an estimate; missing volume produces no profile. Volume profile remains an OHLC approximation, not a trade-level profile.

## Verification
Run `npm --prefix api ci`, then `node --test api/tests/production-hardening.test.js` and `npm test`. Validate PostgreSQL migrations/outbox on a disposable database, Telegram with a test bot, and authenticated UI using a test account. No broker order should be sent.

## Local handoff
Use a fresh Git worktree on the hardening branch with no production .env or database credentials. Run the canonical tests before merging. Check frontend rendering and migrations on a disposable database. The frontend bundle was patched in parallel with the source, not rebuilt by a compiler in the remote session. Full live market-data validation, broker fills, full charting-terminal redesign, broker fills and autonomous strategy learning are not yet complete. Never enable real broker execution on the strength of historical results alone.

## Latest additions
- `/api/market/gold-context`: daily FRED DGS10, DFII10, DTWEXBGS observations; not real-time quotes or point-in-time backtest inputs.
- `/api/replay/start` and `/api/replay/step`: session-bound educational replay (temporary in-memory snapshots), rendered in the research terminal.
- `/api/chat/capabilities`: observed capability inventory; generated skills remain proposals requiring human review.
- Live display SSE is read-only and no longer writes positions. Strict calendar and quality gates override live decisions.
- `npm test` now executes the focused hardening suite before the legacy verification. The checked-in frontend bundle was patched and syntax checked, not rebuilt or browser-tested.
