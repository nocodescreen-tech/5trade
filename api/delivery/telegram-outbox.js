'use strict';

// Durable scheduled delivery. A claim is committed before network I/O.
// A crash or timeout after sending is ambiguous; never auto-retry it, because
// Telegram sendMessage has no idempotency key. Operators can inspect the state.
function repository(sql) {
  if (!sql) throw new Error('PostgreSQL requis pour la file de notifications');
  return {
    async init() {
      await sql`create table if not exists telegram_outbox (
        id text primary key, payload jsonb not null, state text not null default 'pending',
        attempts integer not null default 0, created_at timestamptz not null default now(),
        next_at timestamptz not null default now(), expires_at timestamptz not null,
        claimed_at timestamptz, message_id bigint, last_error text
      )`;
      await sql`create index if not exists telegram_outbox_due on telegram_outbox(next_at) where state='pending'`;
    },
    async enqueue(id,payload,expiresAt) {
      if (!Number.isFinite(expiresAt) || expiresAt<=Date.now()) return false;
      const rows=await sql`insert into telegram_outbox(id,payload,expires_at)
        values(${id},${sql.json(payload)},${new Date(expiresAt)})
        on conflict(id) do nothing returning id`;
      return rows.length===1;
    },
    async claim() {
      await sql`update telegram_outbox set state='expired',last_error='Fenêtre expirée'
        where state='pending' and expires_at<=now()`;
      await sql`update telegram_outbox set state='uncertain',last_error='Accusé de réception inconnu après interruption'
        where state='sending' and claimed_at<now()-interval '2 minutes'`;
      const rows=await sql`update telegram_outbox set state='sending',attempts=attempts+1,claimed_at=now()
        where id=(select id from telegram_outbox where state='pending' and next_at<=now()
          and expires_at>now() order by next_at for update skip locked limit 1)
        returning id,payload,attempts,expires_at`;
      return rows[0]||null;
    },
    async finish(job,result) {
      const next=transition(job,result);
      await sql`update telegram_outbox set state=${next.state},last_error=${next.error},
        message_id=${next.messageId},next_at=${new Date(next.nextAt)}
        where id=${job.id} and state='sending' and attempts=${job.attempts}`;
    },
    async status() {
      const summary=await sql`select state,count(*)::int as count from telegram_outbox group by state order by state`;
      const recent=await sql`select id,state,attempts,created_at,expires_at,message_id,last_error
        from telegram_outbox order by created_at desc limit 30`;
      return {summary,recent};
    }
  };
}

function transition(job,result,now=Date.now()) {
  const base={messageId:null,error:null,nextAt:now};
  if(result.ok && Number.isSafeInteger(result.messageId)) return {...base,state:'sent',messageId:result.messageId};
  if(result.kind==='rate_limit' && job.attempts<5) {
    const delay=Math.max(1000,Math.min(300000,Number(result.retryAfterMs)||30000));
    if(now+delay<new Date(job.expires_at).getTime()) return {...base,state:'pending',nextAt:now+delay,error:'Telegram 429'};
  }
  return {...base,state:result.kind==='rejected' || result.kind==='rate_limit'?'failed':'uncertain',
    error:result.kind==='rejected'?'Rejet explicite Telegram':result.kind==='rate_limit'?'Limite de tentatives ou fenêtre expirée':'Réception non confirmée'};
}

async function sendOnce(token,chat,text,opts={},fetcher=globalThis.fetch) {
  if(!token||!chat||typeof text!=='string'||!text.trim()) return {ok:false,kind:'rejected'};
  try {
    const body={chat_id:chat,text,parse_mode:opts.parse_mode||'HTML'};
    if(opts.reply_markup) body.reply_markup=opts.reply_markup;
    const response=await fetcher('https://api.telegram.org/bot'+token+'/sendMessage',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
    const data=await response.json().catch(()=>null);
    if(response.ok&&data?.ok===true&&Number.isSafeInteger(data.result?.message_id))
      return {ok:true,messageId:data.result.message_id};
    if(response.status===429&&data?.ok===false) return {ok:false,kind:'rate_limit',retryAfterMs:Number(data.parameters?.retry_after)*1000};
    if(response.status>=400&&response.status<500&&data?.ok===false) return {ok:false,kind:'rejected'};
    return {ok:false,kind:'uncertain'};
  } catch {return {ok:false,kind:'uncertain'};}
}

module.exports={repository,transition,sendOnce};
