'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const mount=require('../routes/alerts');
function harness(){
 const routes=new Map(); const auth=()=>{};
 const app={}; for(const method of ['get','post','put','all'])app[method]=(path,...handlers)=>routes.set(method+' '+path,handlers);
 let writes=0,network=0; let config={telegramToken:'123456:fake-test-token-1234567890',telegramChat:'123'};
 const DB={saveTradeRecord:async()=>{writes++;},listTrades:async()=>[]};
 const Alerts={get:()=>config,update:patch=>(config={...config,...patch}),start:()=>{}};
 mount(app,{requireAuth:auth,Alerts,DB});
 const response=()=>({statusCode:200,body:null,status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}});
 return {routes,auth,DB,Alerts,response,writes:()=>writes};
}
test('Telegram webhook rejects missing secret, forged sender and groups before network or mutation',async()=>{
 const h=harness(),handle=h.routes.get('post /api/alerts/telegram/webhook').at(-1);
 const old=process.env.TELEGRAM_WEBHOOK_SECRET,fetchOld=global.fetch;
 const secret='s'.repeat(32);process.env.TELEGRAM_WEBHOOK_SECRET=secret;
 let requests=0;global.fetch=async()=>{requests++;throw Error('unexpected');};
 try{
  const update={callback_query:{id:'x',data:'trade:open:XAUUSD:BUY',from:{id:123},message:{chat:{id:123,type:'private'}}}};
  for(const [body,header,status] of [[update,'wrong',401],[{callback_query:{...update.callback_query,from:{id:456}}},secret,403],[{callback_query:{...update.callback_query,message:{chat:{id:123,type:'group'}}}},secret,403]]){
   const res=h.response();await handle({body,get:()=>header},res);assert.equal(res.statusCode,status);
  }
  assert.equal(requests,0);assert.equal(h.writes(),0);
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  const res=h.response();await handle({body:update,get:()=>secret},res);assert.equal(res.statusCode,503);
 }finally{global.fetch=fetchOld;if(old===undefined)delete process.env.TELEGRAM_WEBHOOK_SECRET;else process.env.TELEGRAM_WEBHOOK_SECRET=old;}
});
test('recap routes require authentication and configuration masks token',async()=>{
 const h=harness();
 for(const route of ['get /api/recap/du-jour','post /api/recap/envoyer-telegram','post /api/alerts/telegram/briefing'])assert.equal(h.routes.get(route)[0],h.auth);
 assert.equal(h.routes.has('all /api/alerts/telegram/briefing'),false);
 const res=h.response();await h.routes.get('get /api/alerts').at(-1)({},res);
 assert.equal(res.body.config.telegramToken,'••••••••');
 assert.ok(!JSON.stringify(res.body).includes(h.Alerts.get().telegramToken));
 const put=h.response();await h.routes.get('put /api/alerts').at(-1)({body:{telegramToken:'••••••••'}},put);
 assert.equal(h.Alerts.get().telegramToken,'123456:fake-test-token-1234567890');
});
