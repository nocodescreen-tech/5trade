# Market Setups Design

## Goal

Make 5trade evaluate several independent setups without treating any indicator, including Fibonacci, as a universal filter.

## Rules

- A setup declares its supported market classes, regimes, timeframes, required rules and risk model.
- Setups are evaluated independently. Their rules are never merged to manufacture confirmation.
- A setup restricted to regimes is not eligible while the regime is unknown.
- Fibonacci is represented by rule R4 only in setup profiles that explicitly request it.
- Market costs used for research are request-scoped and never overwrite saved settings.
- Profitability is reported by setup, market, regime and out-of-sample segment after costs.
- Synthetic instruments are reported separately from traded markets.

## Delivery slices

1. Preserve request-scoped transaction costs in analysis and backtests.
2. Enforce declared setup regimes in the selector.
3. Add an experiment matrix that compares setups independently by market and regime.
4. Add immutable paper-trading observations before any broker execution work.

## Acceptance

No setup can be selected outside its declared market or regime. Running research cannot mutate operational cost settings. Reports never claim universal profitability and retain rejected setups with explicit reasons.
