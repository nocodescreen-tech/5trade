'use strict';

const crypto = require('node:crypto');
const Contract = require('./contrat');

function buildObservation(row, profile, candles, costs, tfMs, now = Date.now()) {
  if (!profile || !profile.id || profile.version === null || profile.version === undefined || !['ACHAT', 'VENTE'].includes(row.decision)) return null;
  if (!Number.isFinite(tfMs) || tfMs <= 0 || !Number.isFinite(now)) return null;
  const c = row.contrat;
  if (!c || !Contract.validerSignal(c).ok || c.status !== 'confirme' ||
      !['long', 'short'].includes(c.sens) || (row.decision === 'ACHAT') !== (c.sens === 'long') ||
      !Number.isFinite(c.entree) || !Number.isFinite(c.stop) || !c.objectifs.length) return null;
  if (!costs || !costs.connu || !Number.isFinite(costs.total) || costs.total < 0) return null;
  const last = candles[candles.length - 1];
  if (!last || last.closed === false || !Number.isFinite(last.t) || !Number.isFinite(last.c) ||
      last.t + tfMs > now || now - last.t > tfMs * 3) return null;
  const snapshot = JSON.parse(JSON.stringify(profile));
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
  const id = crypto.createHash('sha256').update(JSON.stringify([row.provider, row.symbole, row.tf, profile.id, fingerprint, last.t, c.sens])).digest('hex');
  const startAt = last.t + Math.ceil((now-last.t)/tfMs)*tfMs;
  return {
    id, symbol: row.symbole, provider: row.provider, timeframe: row.tf, tfMs,
    observedAt: now, candleAt: last.t, observedPrice: last.c, startAt, expiresAt: startAt + 60 * tfMs,
    strategyId: profile.id, strategyVersion: profile.version, fingerprint, profile: snapshot,
    side: c.sens, entry: c.entree, stop: c.stop, targets: c.objectifs,
    costs, macro: row.macro || null, quality: row.qualite ?? null,
    market: { classe: row.classe, moteur: row.moteur, version: row.moteurVersion, diagnostic: row.diagnostic },
    model: 'ohlc_observation_v1'
  };
}

// Observe only complete future bars. No synthetic fills or guessed intrabar
// ordering: conflicting touches are classified as ambiguous, not wins.
function evaluate(obs, candles, now = Date.now()) {
  const sorted = (candles || []).filter(c => c && c.closed !== false &&
    Number.isFinite(c.t) && c.t >= obs.startAt && c.t < obs.expiresAt &&
    c.t + obs.tfMs <= now).sort((a,b) => a.t - b.t);
  let expected = obs.startAt;
  let touched = false;
  let tp1 = false;
  for (const c of sorted) {
    if (c.t < expected) continue;
    if (c.t !== expected) return { status: 'data_gap', at: expected };
    expected += obs.tfMs;
    if (![c.o,c.h,c.l,c.c].every(Number.isFinite) || c.h < Math.max(c.o,c.c,c.l) || c.l > Math.min(c.o,c.c)) {
      return { status: 'invalid_data', at: c.t };
    }
    const entry = c.l <= obs.entry && c.h >= obs.entry;
    const sl = obs.side === 'long' ? c.l <= obs.stop : c.h >= obs.stop;
    const target1 = obs.side === 'long' ? c.h >= obs.targets[0] : c.l <= obs.targets[0];
    const target2 = obs.targets.length > 1 && (obs.side === 'long' ? c.h >= obs.targets[1] : c.l <= obs.targets[1]);
    if (!touched) {
      if (entry && (sl || target1)) return { status: 'ambiguous_entry_bar', at: c.t };
      if (entry) touched = true;
      continue;
    }
    if (sl && ((!tp1 && target1) || target2)) return { status: 'ambiguous_exit_bar', at: c.t, tp1Touched: tp1 };
    if (sl) return { status: 'stop_touched', at: c.t, tp1Touched: tp1 };
    if (target1) tp1 = true;
    if (target2 || (target1 && obs.targets.length === 1)) return { status: target2 ? 'tp2_touched' : 'tp1_touched', at: c.t, tp1Touched: true };
  }
  if (now >= obs.expiresAt) {
    if (expected < obs.expiresAt) return { status: 'data_gap', at: expected };
    return { status: touched ? 'expired_after_entry' : 'expired_untriggered', at: obs.expiresAt, tp1Touched: tp1 };
  }
  return null;
}

function repository(sql) {
  if (!sql) throw new Error('PostgreSQL requis pour le suivi prospectif');
  return {
    async init() {
      await sql`create table if not exists paper_observations (
        id text primary key, observed_at timestamptz not null, snapshot jsonb not null,
        outcome jsonb, resolved_at timestamptz
      )`;
      await sql`create index if not exists paper_observations_pending on paper_observations(observed_at) where outcome is null`;
    },
    async insert(obs) {
      const rows = await sql`insert into paper_observations(id, observed_at, snapshot)
        values (${obs.id}, ${new Date(obs.observedAt)}, ${sql.json(obs)})
        on conflict(id) do nothing returning id`;
      return rows.length === 1;
    },
    async pending(limit = 100) {
      return (await sql`select snapshot from paper_observations where outcome is null order by observed_at limit ${limit}`).map(r=>r.snapshot);
    },
    async resolve(id, outcome) {
      const rows = await sql`update paper_observations set outcome=${sql.json(outcome)}, resolved_at=now()
        where id=${id} and outcome is null returning id`;
      return rows.length === 1;
    },
    async history(limit = 100) {
      return sql`select snapshot, outcome, resolved_at from paper_observations order by observed_at desc limit ${limit}`;
    },
    async summary() {
      return sql`select coalesce(outcome->>'status','pending') as status, count(*)::int as count
        from paper_observations group by 1 order by 1`;
    }
  };
}

module.exports = { buildObservation, evaluate, repository };
