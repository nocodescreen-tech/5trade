'use strict';

const { timingSafeEqual } = require('node:crypto');

function secretMatches(received, configured) {
  if (typeof configured !== 'string' || !/^[A-Za-z0-9_-]{24,256}$/.test(configured)) return false;
  if (typeof received !== 'string' || received.length > 256) return false;
  const a = Buffer.from(received), b = Buffer.from(configured);
  return a.length === b.length && timingSafeEqual(a,b);
}

function authorizeUpdate(update, received, configured, configuredChat) {
  if (typeof configured !== 'string' || !/^[A-Za-z0-9_-]{24,256}$/.test(configured) ||
      !/^[1-9]\d*$/.test(String(configuredChat || ''))) return {ok:false,status:503};
  if (!secretMatches(received, configured)) return {ok:false,status:401};
  const message = update?.callback_query?.message || update?.message;
  const actor = update?.callback_query?.from || update?.message?.from;
  const chatId = String(message?.chat?.id || '');
  if (message?.chat?.type !== 'private' || chatId !== String(configuredChat) ||
      String(actor?.id || '') !== chatId || actor?.is_bot === true) return {ok:false,status:403};
  return {ok:true,chatId};
}

module.exports = {authorizeUpdate,secretMatches};
