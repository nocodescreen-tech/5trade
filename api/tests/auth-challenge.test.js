'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {create,parseCookies}=require('../security/auth-challenge');
test('cookie parser ignores invalid encodings and does not inherit prototype keys',()=>{
 const result=parseCookies('bad=%ZZ; s5_session=abc; __proto__=x; s5_session=duplicate');
 assert.equal(result.s5_session,'abc');assert.equal(result.bad,undefined);
 assert.equal(Object.getPrototypeOf(result),null);
});
test('OTP challenge binds browser, account, purpose and expiry; is consumed once',()=>{
 let time=1000;const c=create({now:()=>time,ttlMs:10000});
 const headers=[];const res={append:(k,v)=>headers.push(v)};
 const token=c.issue(res,'owner','login');
 const req={headers:{cookie:'s5_challenge='+token}};
 assert.match(headers[0],/HttpOnly; SameSite=Strict/);
 assert.equal(c.check({headers:{}},'owner','login'),null);
 assert.equal(c.check(req,'other','login'),null);
 assert.equal(c.check(req,'owner','signup'),null);
 assert.equal(c.check(req,'owner','login'),token);
 assert.equal(c.consume(token),true);assert.equal(c.consume(token),false);
 const fresh=c.issue(res,'owner','login');
 time+=10001;
 assert.equal(c.check({headers:{cookie:'s5_challenge='+fresh}},'owner','login'),null);
});
test('new challenge revokes previous challenge for same account',()=>{
 const c=create();const res={append(){}};
 const a=c.issue(res,'owner','login');const b=c.issue(res,'owner','login');
 assert.notEqual(a,b);
 assert.equal(c.check({headers:{cookie:'s5_challenge='+a}},'owner','login'),null);
});
