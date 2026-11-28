'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const postgres = require('postgres');
const { appliquer } = require('../db/migrer-phase2');
const Paper = require('../engine/paper-observations');
const Telegram = require('../delivery/telegram-outbox');

const url = process.env.TEST_DATABASE_URL || '';

function disposableDatabase(target) {
  if (!target) return false;
  try {
    const parsed = new URL(target);
    const database = parsed.pathname.replace(/^\//, '').toLowerCase();
    return /(?:^|[_-])(test|ci|tmp)(?:$|[_-])/.test(database);
  } catch {
    return false;
  }
}

test('PostgreSQL integration target is explicitly disposable', { skip: !url }, () => {
  assert.equal(disposableDatabase(url), true,
    'TEST_DATABASE_URL doit nommer une base jetable contenant test, ci ou tmp');
});

test('phase 2 migration is idempotent and persistent queues keep evidence', { skip: !url }, async () => {
  assert.equal(disposableDatabase(url), true,
    'refus de connecter les tests à une base non jetable');

  const sql = postgres(url, { max: 2, onnotice: () => {} });
  try {
    const first = await appliquer(url, { silencieux: true });
    const second = await appliquer(url, { silencieux: true });
    assert.equal(first.tables.length, 9);
    assert.deepEqual(second.tables, first.tables);

    const suffix = `${process.pid}-${Date.now()}`;
    const paper = Paper.repository(sql);
    await paper.init();
    await sql`delete from paper_observations`;
    const observation = { id: `paper-${suffix}`, observedAt: Date.now(), strategyId: 'ci', strategyVersion: '1.0.0' };
    assert.equal(await paper.insert(observation), true);
    assert.equal(await paper.insert(observation), false);
    assert.equal((await paper.pending()).some(row => row.id === observation.id), true);
    assert.equal(await paper.resolve(observation.id, { status: 'expired_untriggered' }), true);
    assert.equal(await paper.resolve(observation.id, { status: 'stop_touched' }), false);

    const outbox = Telegram.repository(sql);
    await outbox.init();
    await sql`delete from telegram_outbox`;
    const jobId = `telegram-${suffix}`;
    assert.equal(await outbox.enqueue(jobId, { text: 'CI only' }, Date.now() + 60000), true);
    assert.equal(await outbox.enqueue(jobId, { text: 'duplicate' }, Date.now() + 60000), false);
    const claimed = await outbox.claim();
    assert.equal(claimed.id, jobId);
    await outbox.finish(claimed, { ok: true, messageId: 42 });
    const status = await outbox.status();
    assert.equal(status.recent.some(row => row.id === jobId && row.state === 'sent'), true);
  } finally {
    await sql.end({ timeout: 5 });
  }
});

module.exports = { disposableDatabase };
