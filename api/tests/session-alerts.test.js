'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Sessions = require('../temporal/sessions');
const Skill = require('../skills/installed/forex-session-monitor');
test('weekend reopening uses DST on reopening date', () => {
  assert.equal(Sessions.statutMarche('EURUSD', new Date('2026-03-07T12:00:00Z')).prochaineOuverture.toISOString(),'2026-03-08T21:00:00.000Z');
  assert.equal(Sessions.statutMarche('EURUSD', new Date('2026-10-31T12:00:00Z')).prochaineOuverture.toISOString(),'2026-11-01T22:00:00.000Z');
  assert.equal(Sessions.statutMarche('R_75',new Date(NaN)).ouvert,false);
});
test('session alerts distinguish summer and winter and reject out-of-window alerts', () => {
  const summer = Skill.messageTelegramPreCloture(new Date('2026-07-10T20:30:00Z'));
  const winter = Skill.messageTelegramPreCloture(new Date('2026-12-04T21:30:00Z'));
  assert.match(summer,/21:00 UTC/);
  assert.match(winter,/22:00 UTC/);
  assert.match(summer,/Kinshasa/);
  assert.equal(Skill.messageTelegramPreCloture(new Date('2026-07-11T12:00:00Z')),null);
  assert.equal(Skill.messageTelegramReouverture(new Date('2026-07-12T20:00:00Z')),null);
  assert.match(Skill.messageTelegramReouverture(new Date('2026-07-12T21:01:00Z')),/21:00 UTC/);
});
test('notification dedup is persisted and corrupted state fails closed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'5trade-notifications-'));
  const file = path.join(dir,'journal.json');
  process.env.NOTIFICATIONS_JOURNAL_FICHIER = file;
  try {
    const tracker = require('../delivery/notification-tracker');
    assert.equal(tracker.estDejaEnvoye('key'),false);
    tracker.marquerEnvoye('key',{type:'test'});
    assert.equal(tracker.estDejaEnvoye('key'),true);
    assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).key.succes,true);
    fs.writeFileSync(file,'invalid');
    assert.throws(()=>tracker.estDejaEnvoye('key'),/illisible/);
  } finally {
    delete process.env.NOTIFICATIONS_JOURNAL_FICHIER;
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
