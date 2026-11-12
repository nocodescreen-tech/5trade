const { useState, useEffect, useRef, useMemo, useCallback } = React;
const RB = window.ReactBits || {};
const { SplashCursor, SpotlightCard, LatticeLoader, Counter } = RB;

const API_BASE = (window.location.port === '5173' || window.location.protocol === 'file:')
  ? 'http://localhost:3001/api' : '/api';

// Version de l'interface (affichée en en-tête) : permet de voir d'un coup d'œil
// si la page ouverte est bien la dernière, ou une version restée en cache.
const UI_VERSION = 'r2026-10-12a';
const api = (path, opts = {}) =>
  fetch(`${API_BASE}${path}`, { credentials: 'include', ...opts });

const REDUCED = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ══════════════ Primitives animées ══════════════ */

function Reveal({ children, delay = 0, className = '', style = {} }) {
  const ref = useRef(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (REDUCED()) { setSeen(true); return; }
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setSeen(true); io.disconnect(); }
    }, { threshold: 0.12, rootMargin: '0px 0px -40px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref}
      className={`reveal ${seen ? 'in' : ''} ${className}`}
      style={{ transitionDelay: `${delay}ms`, ...style }}>
      {children}
    </div>
  );
}

function Tilt({ children, max = 9, scale = 1.015, className = '', style = {} }) {
  const ref = useRef(null);
  const onMove = (e) => {
    const el = ref.current;
    if (!el || REDUCED()) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform =
      `perspective(900px) rotateY(${px * max * 2}deg) rotateX(${-py * max * 2}deg) scale(${scale})`;
  };
  const reset = () => { if (ref.current) ref.current.style.transform = ''; };
  return (
    <div ref={ref} className={`tilt ${className}`} style={style}
      onMouseMove={onMove} onMouseLeave={reset}>
      {children}
    </div>
  );
}

function Skeleton({ h = 14, w = '100%', r = 8, style = {} }) {
  return <div className="skel" style={{ height: h, width: w, borderRadius: r, ...style }} />;
}

function Spinner({ size = 16, color = '#fff' }) {
  return <span className="spin" style={{ width: size, height: size, borderTopColor: color }} />;
}

/* Curseur animé : halo + anneau + point, ripples au clic */
function CursorFX() {
  useEffect(() => {
    if (REDUCED()) return;
    if (window.matchMedia('(hover: none), (pointer: coarse)').matches) return;
    const glow = document.getElementById('fx-glow');
    const ring = document.getElementById('fx-ring');
    const dot  = document.getElementById('fx-dot');
    if (!glow || !ring || !dot) return;

    let mx = window.innerWidth / 2, my = window.innerHeight / 2;
    let gx = mx, gy = my, rx = mx, ry = my, raf = 0;

    const onMove = (e) => {
      mx = e.clientX; my = e.clientY;
      dot.style.transform = `translate(${mx}px,${my}px) translate(-50%,-50%)`;
    };
    const onOver = (e) => {
      const t = e.target.closest('button, a, input, select, textarea, .drop, .tilt');
      ring.style.width  = t ? '52px' : '36px';
      ring.style.height = t ? '52px' : '36px';
    };
    const onDown = (e) => {
      ring.classList.add('click');
      const sp = document.createElement('span');
      sp.className = 'fx-ripple';
      sp.style.left = e.clientX + 'px';
      sp.style.top  = e.clientY + 'px';
      document.body.appendChild(sp);
      setTimeout(() => sp.remove(), 760);
    };
    const onUp = () => ring.classList.remove('click');

    const loop = () => {
      gx += (mx - gx) * 0.10; gy += (my - gy) * 0.10;
      rx += (mx - rx) * 0.22; ry += (my - ry) * 0.22;
      glow.style.transform = `translate(${gx}px,${gy}px) translate(-50%,-50%)`;
      ring.style.transform = `translate(${rx}px,${ry}px) translate(-50%,-50%)`;
      raf = requestAnimationFrame(loop);
    };

    glow.style.opacity = '1';
    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('mouseover', onOver, { passive: true });
    window.addEventListener('mousedown', onDown);
    window.addEventListener('mouseup', onUp);
    loop();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseover', onOver);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  return (
    <>
      <div id="fx-glow"></div>
      <div id="fx-ring"></div>
      <div id="fx-dot"></div>
    </>
  );
}

/* Loader 3D — cube en rotation */
function Loader3D({ size = 42, label = '' }) {
  const half = size / 2;
  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:12 }}>
      <span className="cube-wrap" style={{ width:size, height:size }}>
        <span className="cube" style={{ '--d': `${half}px` }}>
          {[0,1,2,3,4,5].map(i => <b key={i}></b>)}
        </span>
      </span>
      {label && <span style={{ color:'var(--muted)', fontSize:13 }}>{label}</span>}
    </span>
  );
}

/* Validation 3D — coche animée */
function Check3D({ label = 'Vérifié' }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:14, padding:'10px 0' }}>
      <div className="check3d">
        <span className="check-ring"></span>
        <i className="fas fa-check"></i>
      </div>
      <span style={{ color:'#6ee7b7', fontSize:13.5, fontWeight:600 }}>{label}</span>
    </div>
  );
}

function ActionBadge({ action }) {
  const map = {
    BUY:  { bg:'rgba(16,185,129,.16)', fg:'#34d399', br:'rgba(16,185,129,.4)', ic:'fa-arrow-trend-up' },
    SELL: { bg:'rgba(239,68,68,.16)',  fg:'#f87171', br:'rgba(239,68,68,.4)',  ic:'fa-arrow-trend-down' },
    HOLD: { bg:'rgba(245,158,11,.16)', fg:'#fbbf24', br:'rgba(245,158,11,.4)', ic:'fa-pause' },
    WAIT: { bg:'rgba(148,163,184,.16)',fg:'#cbd5e1', br:'rgba(148,163,184,.35)',ic:'fa-hourglass-half' }
  };
  const s = map[action] || map.HOLD;
  return (
    <span className="badge" style={{ background:s.bg, color:s.fg, border:`1px solid ${s.br}` }}>
      <i className={`fas ${s.ic}`}></i>{action}
    </span>
  );
}

function StatTile({ icon, label, value, decimals = 0, suffix = '', color = '#60a5fa', delay = 0 }) {
  return (
    <Reveal delay={delay}>
      <Tilt max={7}>
        <SpotlightCard className="panel" spotlightColor="rgba(37,99,235,.22)">
          <div style={{ padding:'16px 18px' }}>
            <div style={{ display:'flex', alignItems:'center', gap:9, color:'var(--muted)', fontSize:11.5,
              fontWeight:700, letterSpacing:'.05em', textTransform:'uppercase' }}>
              <i className={`fas ${icon}`} style={{ color }}></i>{label}
            </div>
            <div style={{ marginTop:6, color:'#fff', fontWeight:800, fontSize:30, letterSpacing:'-1px' }}>
              {Counter ? <Counter value={value} decimals={decimals} suffix={suffix} fontSize={30} /> : `${value}${suffix}`}
            </div>
          </div>
        </SpotlightCard>
      </Tilt>
    </Reveal>
  );
}

/* ══════════════ MASCOTTE ANIMÉE ══════════════ */

function AuthMascot({ mode = 'login', focus = null }) {
  const covering = focus === 'password';
  const lookingUp = focus === 'username' || focus === 'email' || covering;
  const look = focus === 'username' ? -3 : focus === 'email' ? 0 : covering ? 0 : 3;

  return (
    <div className="mascot-bob" style={{ display:'flex', justifyContent:'center', marginBottom:-4 }}>
      <svg viewBox="0 0 200 214" width="152" height="163"
        className={`mascot ${mode}`}
        role="img" aria-label="Assistant 5trade">
        <defs>
          <linearGradient id="mBody" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#55677f" />
            <stop offset="1" stopColor="#2c3648" />
          </linearGradient>
          <linearGradient id="mHead" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#1b2434" />
            <stop offset="1" stopColor="#121826" />
          </linearGradient>
          <radialGradient id="mGlow" cx="50%" cy="50%">
            <stop offset="0" stopColor="rgba(37,99,235,.15)" />
            <stop offset="1" stopColor="rgba(37,99,235,0)" />
          </radialGradient>
        </defs>

        <ellipse cx="100" cy="206" rx="56" ry="10" fill="rgba(37,99,235,.07)" />
        <circle cx="100" cy="96" r="86" fill="url(#mGlow)" />

        {/* corps */}
        <path d="M62 205 C62 152 78 130 100 130 C122 130 138 152 138 205 Z" fill="url(#mBody)" />
        <path d="M100 130 L100 205" stroke="rgba(255,255,255,.13)" strokeWidth="1.4" />

        {/* bras (masqués quand la mascotte se couvre les yeux) */}
        <g style={{ opacity: covering ? 0 : 1, transition:'opacity .35s ease' }}>
          <path d="M64 144 C47 154 41 170 46 185" stroke="#3d4c66" strokeWidth="12"
            fill="none" strokeLinecap="round" />
          <path d="M136 144 C153 154 159 170 154 185" stroke="#3d4c66" strokeWidth="12"
            fill="none" strokeLinecap="round" />
        </g>

        {/* tête */}
        <circle cx="100" cy="84" r="45" fill="url(#mHead)"
          stroke="rgba(148,163,184,.3)" strokeWidth="1.6" />

        {/* casque / cheveux */}
        <path d="M55 76 C57 46 78 31 100 31 C122 31 143 46 145 76 C131 63 118 59 100 59 C82 59 69 63 55 76 Z"
          fill="url(#mBody)" />

        {/* yeux */}
        <g className="blink" style={{ transformOrigin:'100px 82px', transformBox:'view-box' }}>
          <ellipse cx="86" cy="82" rx="10.5" ry="11.5" fill="#080c14" stroke="rgba(148,163,184,.4)" strokeWidth="1.2" />
          <ellipse cx="114" cy="82" rx="10.5" ry="11.5" fill="#080c14" stroke="rgba(148,163,184,.4)" strokeWidth="1.2" />
        </g>

        {/* pupilles (suivent le champ actif) */}
        <g style={{ transform:`translate(${look}px,${lookingUp ? -1.5 : 1.5}px)`,
          transition:'transform .5s cubic-bezier(.3,1,.3,1)' }}>
          <circle cx="86" cy="82" r="4.6" fill="#7fa8d8" />
          <circle cx="114" cy="82" r="4.6" fill="#7fa8d8" />
        </g>

        {/* mains devant les yeux */}
        <g style={{
          opacity: covering ? 1 : 0,
          transform: `scale(${covering ? 1 : 0.55})`,
          transformOrigin: '100px 84px', transformBox: 'view-box',
          transition: 'opacity .26s, transform .34s cubic-bezier(.2,.9,.2,1)'
        }}>
          <circle cx="85" cy="80" r="15" fill="#3d4c66" />
          <circle cx="115" cy="80" r="15" fill="#3d4c66" />
          <circle cx="85" cy="80" r="15" fill="none" stroke="rgba(255,255,255,.2)" strokeWidth="1.2" />
          <circle cx="115" cy="80" r="15" fill="none" stroke="rgba(255,255,255,.2)" strokeWidth="1.2" />
        </g>

        {/* bouche */}
        <path
          d={covering
            ? 'M92 106 Q100 100 108 106'
            : mode === 'signup'
              ? 'M88 101 Q100 113 112 101'
              : 'M90 104 Q100 109 110 104'}
          stroke="#8dc0ff" strokeWidth="3" fill="none" strokeLinecap="round"
          style={{ transition:'transform .3s' }} />
      </svg>
    </div>
  );
}

/* ══════════════ AUTH ══════════════ */

function Auth({ onLogin }) {
  const [mode, setMode] = useState('login');
  const [step, setStep] = useState('creds');
  const [form, setForm] = useState({ username:'', email:'', password:'' });
  const [digits, setDigits] = useState(['','','','','','']);
  const [ctx, setCtx] = useState({ username:'', purpose:'', email:'' });
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [tick, setTick] = useState(0);
  const [focus, setFocus] = useState(null);
  const [ok, setOk] = useState(false);
  const boxes = useRef([]);

  useEffect(() => {
    api('/account-exists').then(r => r.json()).then(d => {
      if (d.exists) setMode('login');
      else { setMode('signup'); setForm(f => ({ ...f, email: d.ownerEmail || '' })); }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const submitCreds = async (e) => {
    e.preventDefault(); setBusy(true); setErr(''); setInfo('');
    try {
      const r = await api(`/${mode}`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify(form)
      });
      const d = await r.json();
      if (d.success && d.otpRequired) {
        setCtx({ username: form.username, purpose: d.purpose, email: d.email });
        setDigits(['','','','','','']); setStep('otp'); setCooldown(60);
        setInfo(`Code envoyé à ${d.email}`);
        setTimeout(() => boxes.current[0] && boxes.current[0].focus(), 120);
      } else if (d.success && d.user) onLogin(d.user);
      else setErr(d.error || 'Erreur');
    } catch { setErr('Serveur injoignable'); }
    finally { setBusy(false); }
  };

  const setDigit = (i, v) => {
    const c = v.replace(/\D/g, '');
    if (!c) { const n=[...digits]; n[i]=''; setDigits(n); return; }
    if (c.length > 1) {  // coller le code complet
      const n = [...digits];
      c.slice(0,6).split('').forEach((ch,k) => { if (i+k < 6) n[i+k] = ch; });
      setDigits(n);
      const last = Math.min(i + c.length, 5);
      boxes.current[last] && boxes.current[last].focus();
      return;
    }
    const n = [...digits]; n[i] = c; setDigits(n);
    if (i < 5) boxes.current[i+1] && boxes.current[i+1].focus();
  };

  const onKey = (i, e) => {
    if (e.key === 'Backspace' && !digits[i] && i > 0) boxes.current[i-1] && boxes.current[i-1].focus();
    if (e.key === 'ArrowLeft' && i > 0) boxes.current[i-1].focus();
    if (e.key === 'ArrowRight' && i < 5) boxes.current[i+1].focus();
  };

  const code = digits.join('');

  const submitOtp = async (e) => {
    if (e) e.preventDefault();
    if (code.length !== 6 || busy) return;
    setBusy(true); setErr('');
    try {
      const r = await api('/verify-otp', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ username: ctx.username, code, purpose: ctx.purpose })
      });
      const d = await r.json();
      if (d.success) {
        setOk(true);
        setTimeout(() => onLogin(d.user), 1150);
      } else { setErr(d.error || 'Code invalide'); setDigits(['','','','','','']); boxes.current[0] && boxes.current[0].focus(); }
    } catch { setErr('Serveur injoignable'); }
    finally { setBusy(false); }
  };

  useEffect(() => { if (code.length === 6) submitOtp(); }, [code]);

  const resend = async () => {
    if (cooldown > 0) return;
    setErr('');
    try {
      const r = await api('/resend-otp', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ username: ctx.username, purpose: ctx.purpose })
      });
      const d = await r.json();
      if (d.success) { setInfo(`Nouveau code envoyé à ${d.email}`); setCooldown(60); }
      else setErr(d.error || 'Erreur');
    } catch { setErr('Serveur injoignable'); }
  };

  const pwd = form.password || '';
  const strength = (pwd.length >= 8 ? 1 : 0) + (/[A-Z]/.test(pwd) ? 1 : 0) +
                   (/[a-z]/.test(pwd) ? 1 : 0) + (/[0-9]/.test(pwd) ? 1 : 0) +
                   (/[^A-Za-z0-9]/.test(pwd) ? 1 : 0);

  return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div style={{ width:'100%', maxWidth:440 }}>
        <Reveal>
          <Tilt max={6} scale={1}>
            <SpotlightCard className="panel glow-ring" spotlightColor="rgba(37,99,235,.25)">
              <div className="auth-card" style={{ position:'relative', overflow:'hidden' }}>
                {ok && (
                  <div className="modal-veil" style={{ position:'absolute', inset:0, zIndex:9, display:'flex',
                    alignItems:'center', justifyContent:'center', background:'rgba(7,10,17,.9)',
                    backdropFilter:'blur(8px)', borderRadius:16 }}>
                    <div className="modal-card">
                      <Check3D label="Identité vérifiée" />
                    </div>
                  </div>
                )}

                <div style={{ textAlign:'center', marginBottom:18 }}>
                  <div className="auth-title" style={{ fontSize:26, fontWeight:800, letterSpacing:'-.6px',
                    color:'var(--txt)', lineHeight:1.15 }}>
                    5trade
                  </div>
                  <div style={{ marginTop:6, fontSize:12.5, color:'var(--muted)', lineHeight:1.45 }}>
                    Plateforme d'analyse de trading assistée par IA
                  </div>
                </div>

                {step === 'creds' && (
                  <div className="mascot-wrap"><AuthMascot mode={mode} focus={focus} /></div>
                )}

                {step === 'creds' && (<div className="authpane" key={mode}>
                  <div className="seg" role="tablist" aria-label="Connexion ou inscription" style={{ marginBottom:16 }}>
                    {['login','signup'].map(m => (
                      <button key={m} className={`seg-item ${mode===m?'on':''}`} type="button"
                        role="tab" aria-selected={mode===m}
                        onClick={()=>{setMode(m);setErr('');setInfo('')}}>
                        <i className={`fas ${m==='login'?'fa-right-to-bracket':'fa-user-plus'}`} aria-hidden="true"></i>
                        {m==='login' ? 'Connexion' : 'Inscription'}
                      </button>
                    ))}
                  </div>

                  <form onSubmit={submitCreds}>
                    <label className="lbl">Nom d'utilisateur</label>
                    <input className="fld" value={form.username} autoFocus required
                      onFocus={()=>setFocus('username')} onBlur={()=>setFocus(null)}
                      onChange={e=>setForm({...form, username:e.target.value})} />

                    {mode==='signup' && (<>
                      <label className="lbl">Email de vérification</label>
                      <input className="fld" type="email" value={form.email}
                        onFocus={()=>setFocus('email')} onBlur={()=>setFocus(null)}
                        onChange={e=>setForm({...form, email:e.target.value})} />
                    </>)}

                    <label className="lbl">Mot de passe</label>
                    <input className="fld" type="password" value={form.password} required
                      onFocus={()=>setFocus('password')} onBlur={()=>setFocus(null)}
                      onChange={e=>setForm({...form, password:e.target.value})} />

                    {mode==='signup' && (<>
                      <div style={{ display:'flex', gap:5, marginTop:9 }}>
                        {[0,1,2,3,4].map(i => (
                          <span key={i} style={{
                            flex:1, height:4, borderRadius:9,
                            background: i < strength
                              ? (strength<=2 ? '#ef4444' : strength<=3 ? '#f59e0b' : '#10b981')
                              : 'rgba(27,36,51,.9)',
                            transition:'background .3s'
                          }}></span>
                        ))}
                      </div>
                      <p style={{ fontSize:11, color:'var(--dim)', marginTop:7, lineHeight:1.5 }}>
                        8 caractères minimum, avec majuscule, minuscule et chiffre. Un code de vérification sera envoyé par email.
                      </p>
                    </>)}

                    {err && <div style={{ background:'rgba(239,68,68,.12)', border:'1px solid rgba(239,68,68,.35)',
                      color:'#fca5a5', padding:11, borderRadius:11, marginTop:12, fontSize:13 }}>
                      <i className="fas fa-circle-exclamation" style={{marginRight:7}}></i>{err}</div>}
                    {info && <div style={{ background:'rgba(16,185,129,.1)', border:'1px solid rgba(16,185,129,.3)',
                      color:'#6ee7b7', padding:11, borderRadius:11, marginTop:12, fontSize:13 }}>
                      <i className="fas fa-circle-check" style={{marginRight:7}}></i>{info}</div>}

                    <button className="btn" type="submit" disabled={busy} style={{ width:'100%', marginTop:16 }}>
                      {busy ? <Spinner /> : <i className={`fas ${mode==='login'?'fa-right-to-bracket':'fa-user-plus'}`}></i>}
                      {mode==='login' ? 'Se connecter' : "S'inscrire"}
                    </button>
                  </form>
                </div>)}

                {step === 'otp' && (
                  <form onSubmit={submitOtp} className="authpane" key="otp">
                    <div style={{ textAlign:'center', marginBottom:16 }}>
                      <div className="floaty" style={{ display:'inline-flex', width:52, height:52, borderRadius:15,
                        alignItems:'center', justifyContent:'center', background:'rgba(37,99,235,.14)',
                        border:'1px solid rgba(37,99,235,.3)' }}>
                        <i className="fas fa-shield-halved" style={{ fontSize:21, color:'#60a5fa' }}></i>
                      </div>
                      <p style={{ color:'var(--muted)', fontSize:13, marginTop:11, lineHeight:1.6 }}>
                        Saisissez le code à 6 chiffres envoyé à<br/>
                        <b style={{ color:'var(--txt)' }}>{ctx.email}</b>
                      </p>
                    </div>

                    <div style={{ display:'flex', gap:8, justifyContent:'center' }}>
                      {digits.map((d,i) => (
                        <input key={i} ref={el => boxes.current[i] = el}
                          className={`otp-box otp-in ${d ? 'filled' : ''}`}
                          style={{ animationDelay: `${i * 55}ms` }}
                          value={d} inputMode="numeric" maxLength={6}
                          autoComplete={i===0 ? 'one-time-code' : 'off'}
                          onChange={e => setDigit(i, e.target.value)}
                          onKeyDown={e => onKey(i, e)}
                          onFocus={e => e.target.select()} />
                      ))}
                    </div>

                    {busy && (
                      <div style={{ display:'flex', justifyContent:'center', marginTop:16 }}>
                        <Loader3D size={40} label="Vérification du code…" />
                      </div>
                    )}

                    {err && <div className="shake" style={{ background:'rgba(239,68,68,.12)', border:'1px solid rgba(239,68,68,.35)',
                      color:'#fca5a5', padding:11, borderRadius:11, marginTop:12, fontSize:13, textAlign:'center' }}>{err}</div>}
                    {info && <div style={{ background:'rgba(16,185,129,.1)', border:'1px solid rgba(16,185,129,.3)',
                      color:'#6ee7b7', padding:11, borderRadius:11, marginTop:12, fontSize:13, textAlign:'center' }}>{info}</div>}

                    <button className="btn ok" type="submit" disabled={busy || code.length!==6}
                      style={{ width:'100%', marginTop:16 }}>
                      {busy ? <Spinner /> : <i className="fas fa-check"></i>}Valider
                    </button>

                    <div style={{ display:'flex', justifyContent:'space-between', marginTop:12 }}>
                      <button type="button" className="btn ghost sm"
                        onClick={()=>{setStep('creds');setErr('');setInfo('');setDigits(['','','','','','']);}}>
                        <i className="fas fa-arrow-left"></i>Retour
                      </button>
                      <button type="button" className="btn ghost sm" onClick={resend} disabled={cooldown>0}>
                        <i className="fas fa-rotate-right"></i>
                        {cooldown>0 ? `Renvoyer (${cooldown}s)` : 'Renvoyer le code'}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </SpotlightCard>
          </Tilt>
        </Reveal>
        <p style={{ textAlign:'center', color:'var(--dim)', fontSize:11.5, marginTop:16 }}>
          <i className="fas fa-lock" style={{marginRight:6}}></i>
          Connexion sécurisée · session httpOnly · validation par code à usage unique
        </p>
      </div>
    </div>
  );
}

/* ══════════════ ANALYSE ══════════════ */

function Analyzer({ onDone }) {
  const [files, setFiles] = useState([]);
  const [tfs, setTfs] = useState('M5, M30, H1');
  const [pair, setPair] = useState('XAUUSD');
  const [notes, setNotes] = useState('');
  const [maxStrat, setMaxStrat] = useState(3);
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState(0);
  const [hot, setHot] = useState(false);
  const [err, setErr] = useState('');
  const [phase, setPhase] = useState('');
  const timer = useRef(null);

  const add = (fl) => {
    const arr = Array.from(fl).filter(f => f.type.startsWith('image/'));
    setFiles(prev => [...prev, ...arr].slice(0, 4));
  };

  const stepLabels = ['Analyse des graphiques…','Recherche dans la base…','Combinaison des stratégies…','Génération du plan…'];

  const run = async () => {
    if (!files.length) { setErr('Ajoutez au moins une capture.'); return; }
    setBusy(true); setErr(''); setProg(8); setPhase(stepLabels[0]);
    let i = 0;
    timer.current = setInterval(() => {
      i = Math.min(i + 1, stepLabels.length - 1);
      setPhase(stepLabels[i]);
      setProg(p => Math.min(p + 22, 88));
    }, 2200);

    const fd = new FormData();
    files.forEach(f => fd.append('charts', f));
    fd.append('pair', pair); fd.append('timeframes', tfs);
    fd.append('notes', notes); fd.append('maxStrategies', String(maxStrat));

    try {
      const r = await api('/analyze', { method:'POST', body: fd });
      const d = await r.json();
      if (d.success) { setProg(100); setPhase('Terminé');
        setTimeout(() => { onDone(d); setBusy(false); setProg(0); setPhase(''); }, 420); }
      else { setErr(d.error || 'Erreur d\'analyse'); setBusy(false); setProg(0); }
    } catch (e) { setErr('Erreur: ' + e.message); setBusy(false); setProg(0); }
    finally { clearInterval(timer.current); }
  };

  return (
    <Reveal>
      <SpotlightCard className="panel" spotlightColor="rgba(37,99,235,.2)">
        <div style={{ padding:'22px 22px 24px' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:10, marginBottom:16 }}>
            <h2 style={{ fontSize:18, fontWeight:800, display:'flex', alignItems:'center', gap:10 }}>
              <i className="fas fa-images" style={{ color:'#60a5fa' }}></i>Analyse multi-timeframe
            </h2>
            <span className="badge" style={{ background:'rgba(37,99,235,.14)', color:'#8fb4ff' }}>
              <i className="fas fa-layer-group"></i>jusqu'à 4 captures
            </span>
          </div>

          <div style={{ display:'grid', gap:14, gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))' }}>
            <div>
              <label className="lbl" style={{marginTop:0}}>Paire</label>
              <input className="fld" value={pair} onChange={e=>setPair(e.target.value.toUpperCase())} />
            </div>
            <div>
              <label className="lbl" style={{marginTop:0}}>Timeframes (ordre des images)</label>
              <input className="fld" value={tfs} onChange={e=>setTfs(e.target.value)} placeholder="M5, M30, H1" />
            </div>
            <div>
              <label className="lbl" style={{marginTop:0}}>Stratégies à combiner</label>
              <select className="fld" aria-label="Nombre maximum de stratégies analysées" value={maxStrat} onChange={e=>setMaxStrat(e.target.value)}>
                {[2,3,4].map(n=> <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>

          <label className="lbl">Contexte du trader (optionnel)</label>
          <textarea className="fld" rows="2" value={notes} onChange={e=>setNotes(e.target.value)}
            placeholder="Ex : scalp London sur XAUUSD, biais H1 haussier…" />

          <div className={`drop ${hot?'hot':''}`} style={{ marginTop:16 }}
            onClick={()=>document.getElementById('f-charts').click()}
            onDragOver={e=>{e.preventDefault();setHot(true)}}
            onDragLeave={()=>setHot(false)}
            onDrop={e=>{e.preventDefault();setHot(false);add(e.dataTransfer.files)}}>
            <input id="f-charts" type="file" accept="image/*" multiple style={{display:'none'}}
              onChange={e=>add(e.target.files)} />
            <div className="floaty" style={{ display:'inline-flex', width:52, height:52, borderRadius:15,
              alignItems:'center', justifyContent:'center', background:'rgba(37,99,235,.12)' }}>
              <i className="fas fa-cloud-arrow-up" style={{ fontSize:22, color:'#60a5fa' }}></i>
            </div>
            <p style={{ color:'var(--muted)', marginTop:10, fontSize:13.5, fontWeight:600 }}>
              Glissez vos captures TradingView ici
            </p>
            <p style={{ color:'var(--dim)', fontSize:11.5, marginTop:4 }}>ou cliquez · PNG / JPG · 4 max</p>
          </div>

          {files.length > 0 && (
            <div style={{ display:'grid', gap:12, gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))', marginTop:14 }}>
              {files.map((f,i) => (
                <div key={i} className="thumb">
                  <img src={URL.createObjectURL(f)} alt={f.name} />
                  <div style={{ position:'absolute', top:6, left:6, background:'rgba(7,10,17,.82)',
                    border:'1px solid var(--border)', borderRadius:8, padding:'2px 8px',
                    fontSize:10.5, fontWeight:700, color:'#8fb4ff' }}>
                    {(tfs.split(',')[i]||`#${i+1}`).trim()}
                  </div>
                  <button onClick={()=>setFiles(files.filter((_,j)=>j!==i))}
                    style={{ position:'absolute', top:6, right:6, width:24, height:24, borderRadius:8,
                      border:'1px solid rgba(239,68,68,.4)', background:'rgba(7,10,17,.82)',
                      color:'#f87171', cursor:'pointer', fontSize:11 }}>
                    <i className="fas fa-times"></i>
                  </button>
                </div>
              ))}
            </div>
          )}

          {busy && (
            <div style={{ marginTop:16 }}>
              <div className="bar"><i style={{ width:`${prog}%` }}></i></div>
              <div style={{ display:'flex', alignItems:'center', gap:10, marginTop:10, color:'var(--muted)', fontSize:12.5 }}>
                <Spinner size={15} color="#60a5fa" />
                <span>{phase}</span>
                <span style={{ marginLeft:'auto', color:'var(--dim)' }}>{prog}%</span>
              </div>
            </div>
          )}

          {err && <div style={{ background:'rgba(239,68,68,.12)', border:'1px solid rgba(239,68,68,.35)',
            color:'#fca5a5', padding:11, borderRadius:11, marginTop:12, fontSize:13 }}>{err}</div>}

          <button className="btn ok" style={{ width:'100%', marginTop:16, padding:'13px' }}
            onClick={run} disabled={busy || !files.length}>
            {busy ? <Spinner /> : <i className="fas fa-bolt"></i>}
            {busy ? 'Analyse en cours…' : "Lancer l'analyse"}
          </button>
        </div>
      </SpotlightCard>
    </Reveal>
  );
}

/* ══════════════ RÉSULTAT ══════════════ */

function Result({ result, onToJournal }) {
  const [open, setOpen] = useState(false);
  const { analysis, recommendations: rec } = result;

  // On ne devine jamais un prix : le plan est textuel (zone/déclencheur).
  // On reporte paire, sens, stratégies et le plan en notes ; le trader saisit
  // ses vrais niveaux dans le journal.
  const toJournal = () => onToJournal && onToJournal({
    pair: analysis.pair,
    direction: rec.action === 'SELL' ? 'SELL' : 'BUY',
    strategyIds: (rec.strategiesUsed || []).map(s => s.id).filter(Boolean),
    originAnalysisId: analysis.analysisId || null,
    notes: [
      `Plan ${rec.action} (${rec.confidence})`,
      rec.reason,
      rec.entry && rec.entry.zone ? `Zone : ${rec.entry.zone}` : null,
      rec.entry && rec.entry.trigger ? `Déclencheur : ${rec.entry.trigger}` : null
    ].filter(Boolean).join('\n')
  });

  const KV = ({ k, v }) => (
    <div style={{ display:'flex', justifyContent:'space-between', gap:12, padding:'6px 0',
      borderBottom:'1px solid rgba(27,36,51,.55)' }}>
      <span style={{ color:'var(--muted)', fontSize:12.5 }}>{k}</span>
      <span style={{ fontWeight:600, fontSize:13, textAlign:'right' }}>{v || '—'}</span>
    </div>
  );

  return (
    <div style={{ marginTop:18 }}>
      <Reveal>
        <SpotlightCard className="panel" spotlightColor="rgba(16,185,129,.18)">
          <div style={{ padding:'22px' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:12 }}>
              <h2 style={{ fontSize:19, fontWeight:800, display:'flex', alignItems:'center', gap:10 }}>
                <i className="fas fa-crosshairs" style={{ color:'#34d399' }}></i>
                Plan d'action — {analysis.pair}
              </h2>
              <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                <ActionBadge action={rec.action} />
                <span className="badge" style={{ background:'rgba(148,163,184,.12)', color:'var(--muted)' }}>
                  <i className="fas fa-gauge-high"></i>{rec.confidence}
                </span>
                <span className="badge" style={{ background:'rgba(148,163,184,.12)', color:'var(--muted)' }}>
                  <i className="fas fa-image"></i>{analysis.imagesAnalyzed}
                </span>
                {onToJournal && (
                  <button className="btn sm" onClick={toJournal}
                    title="Reporter ce plan dans le journal de trades">
                    <i className="fas fa-receipt"></i>Enregistrer ce trade
                  </button>
                )}
              </div>
            </div>

            <div style={{ marginTop:14, padding:15, borderRadius:13,
              background:'linear-gradient(135deg,rgba(16,185,129,.11),rgba(37,99,235,.07))',
              borderLeft:'3px solid #10b981', fontSize:13.5, lineHeight:1.7 }}>
              {rec.reason}
              {rec.strategiesCombined && rec.strategiesCombined.length > 0 && (
                <div style={{ marginTop:9 }}>
                  <span style={{ fontSize:11.5, color:'var(--muted)', fontWeight:600 }}>COMBINAISON : </span>
                  {rec.strategiesCombined.map((s,i)=> <span key={i} className="tag">{s}</span>)}
                </div>
              )}
            </div>
          </div>
        </SpotlightCard>
      </Reveal>

      <div style={{ display:'grid', gap:14, gridTemplateColumns:'repeat(auto-fit,minmax(290px,1fr))', marginTop:14 }}>
        {[
          { t:'Entrée', ic:'fa-sign-in-alt', c:'#60a5fa', rows:[
              ['Zone', rec.entry?.zone], ['Déclencheur', rec.entry?.trigger], ['Timeframe', rec.entry?.timeframe] ] },
          { t:'Stop Loss & Risque', ic:'fa-shield-halved', c:'#f87171', rows:[
              ['Stop loss', rec.stopLoss?.level], ['Logique', rec.stopLoss?.reason],
              ['Risque / trade', rec.riskManagement?.riskPerTrade], ['R:R', rec.riskManagement?.rr] ] }
        ].map((box, idx) => (
          <Reveal key={box.t} delay={80 + idx*70}>
            <div className="panel" style={{ padding:18, height:'100%' }}>
              <h3 style={{ fontWeight:700, fontSize:14, marginBottom:10, display:'flex', alignItems:'center', gap:9 }}>
                <i className={`fas ${box.ic}`} style={{ color:box.c }}></i>{box.t}
              </h3>
              {box.rows.map(([k,v]) => <KV key={k} k={k} v={v} />)}
            </div>
          </Reveal>
        ))}
      </div>

      {rec.takeProfit && rec.takeProfit.length > 0 && (
        <Reveal delay={140}>
          <div className="panel" style={{ padding:18, marginTop:14 }}>
            <h3 style={{ fontWeight:700, fontSize:14, marginBottom:10, display:'flex', alignItems:'center', gap:9 }}>
              <i className="fas fa-bullseye" style={{ color:'#34d399' }}></i>Objectifs
            </h3>
            {rec.takeProfit.map((tp,i) => (
              <div key={i} style={{ display:'flex', gap:12, alignItems:'center', padding:'9px 12px',
                borderRadius:10, background:'rgba(16,185,129,.07)', marginBottom:7, border:'1px solid rgba(16,185,129,.18)' }}>
                <span className="badge" style={{ background:'rgba(16,185,129,.18)', color:'#34d399' }}>TP{i+1}</span>
                <b style={{ fontSize:13.5 }}>{tp.level}</b>
                <span style={{ color:'var(--muted)', fontSize:12.5 }}>{tp.reason}</span>
              </div>
            ))}
          </div>
        </Reveal>
      )}

      {rec.executionPlan && rec.executionPlan.length > 0 && (
        <Reveal delay={180}>
          <div className="panel" style={{ padding:18, marginTop:14 }}>
            <h3 style={{ fontWeight:700, fontSize:14, marginBottom:12, display:'flex', alignItems:'center', gap:9 }}>
              <i className="fas fa-list-ol" style={{ color:'#fbbf24' }}></i>Plan d'exécution
            </h3>
            {rec.executionPlan.map((s,i) => (
              <div key={i} style={{ display:'flex', gap:12, marginBottom:12 }}>
                <div style={{ flexShrink:0, width:28, height:28, borderRadius:9,
                  background:'rgba(245,158,11,.16)', border:'1px solid rgba(245,158,11,.35)',
                  color:'#fbbf24', fontWeight:800, fontSize:12.5, display:'flex',
                  alignItems:'center', justifyContent:'center' }}>{s.step}</div>
                <div style={{ flex:1, paddingBottom:8, borderBottom:'1px solid rgba(27,36,51,.5)' }}>
                  <div style={{ fontSize:12.5, fontWeight:700, color:'#fbbf24' }}>{s.when}</div>
                  <div style={{ fontSize:13.5, marginTop:3, lineHeight:1.6 }}>{s.do}</div>
                  {s.before && <div style={{ fontSize:12, color:'var(--muted)', marginTop:3 }}>
                    <i className="fas fa-arrow-left" style={{marginRight:5}}></i>Avant : {s.before}</div>}
                </div>
              </div>
            ))}
          </div>
        </Reveal>
      )}

      {rec.nextSteps && rec.nextSteps.length > 0 && (
        <Reveal delay={210}>
          <div className="panel" style={{ padding:18, marginTop:14 }}>
            <h3 style={{ fontWeight:700, fontSize:14, marginBottom:9, display:'flex', alignItems:'center', gap:9 }}>
              <i className="fas fa-forward" style={{ color:'#60a5fa' }}></i>Ensuite
            </h3>
            {rec.nextSteps.map((s,i) => (
              <div key={i} style={{ fontSize:13.5, color:'#c9d4e0', padding:'4px 0', display:'flex', gap:9 }}>
                <i className="fas fa-chevron-right" style={{ color:'#2563eb', fontSize:10, marginTop:6 }}></i>{s}
              </div>
            ))}
          </div>
        </Reveal>
      )}

      {rec.invalidation && (
        <Reveal delay={240}>
          <div style={{ marginTop:14, padding:14, borderRadius:12,
            background:'rgba(239,68,68,.1)', border:'1px solid rgba(239,68,68,.3)' }}>
            <b style={{ fontSize:13, color:'#f87171' }}>
              <i className="fas fa-ban" style={{marginRight:7}}></i>Invalidation</b>
            <span style={{ fontSize:13, color:'#fca5a5', marginLeft:7 }}>{rec.invalidation}</span>
          </div>
        </Reveal>
      )}

      <Reveal delay={260}>
        <div style={{ marginTop:16 }}>
          <button className="btn ghost sm" onClick={()=>setOpen(!open)}>
            <i className={`fas fa-chevron-${open?'up':'down'}`}></i>
            {open ? 'Masquer' : 'Voir'} l'analyse visuelle détaillée
          </button>
          {open && (
            <pre className="panel-soft" style={{ marginTop:11, padding:16, whiteSpace:'pre-wrap',
              wordBreak:'break-word', fontSize:13, lineHeight:1.65, color:'#c9d4e0',
              fontFamily:'ui-monospace,Consolas,monospace', maxHeight:400, overflow:'auto' }}>
              {analysis.visionAnalysis}
            </pre>
          )}
          <div style={{ marginTop:12, fontSize:11.5, color:'var(--dim)' }}>
            {rec.candidatesFound} stratégie(s) trouvée(s) · {rec.strategiesUsed?.length || 0} retenue(s) pour la combinaison
          </div>
        </div>
      </Reveal>
    </div>
  );
}

/* ══════════════ AJOUT DE CONNAISSANCE ══════════════ */

function AddKnowledge({ refresh }) {
  const [tab, setTab] = useState('upload');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const [manual, setManual] = useState({ title:'', content:'', type:'strategy' });
  const [urls, setUrls] = useState('');
  const [sq, setSq] = useState('');
  const [slim, setSlim] = useState(5);
  const [forum, setForum] = useState('babypips');
  const [fkw, setFkw] = useState('');
  // « Je lui explique une strategie, il analyse, rassemble les infos, me la rend
  //  et la sauvegarde. »
  const [decrire, setDecrire] = useState('');
  const [fiche, setFiche] = useState(null);
  const [decrireBusy, setDecrireBusy] = useState(false);
  const [decrireErr, setDecrireErr] = useState('');

  const post = async (path, body, isForm) => {
    setBusy(true); setRes(null);
    try {
      const r = await api(path, {
        method:'POST',
        headers: isForm ? {} : { 'Content-Type':'application/json' },
        body: isForm ? body : JSON.stringify(body)
      });
      const d = await r.json();
      setRes({ ok: d.success !== false, data: d });
      if (d.success) refresh();
    } catch (e) { setRes({ ok:false, data:{ error:e.message } }); }
    finally { setBusy(false); }
  };

  /** Envoie la description au moteur, qui la structure et l'enregistre. */
  const analyserDescription = async () => {
    setDecrireBusy(true); setDecrireErr(''); setFiche(null);
    try {
      const r = await api('/strategies/decrire', {
        method:'POST', headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ texte: decrire })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Analyse refusée');
      setFiche(d);
      refresh();
    } catch (e) { setDecrireErr(e.message); }
    finally { setDecrireBusy(false); }
  };

  const METHODS = [
    { id:'decrire', label:'Décrire',  icon:'fa-wand-magic-sparkles' },
    { id:'upload', label:'Documents', icon:'fa-file-arrow-up' },
    { id:'manual', label:'Manuel',    icon:'fa-pen' },
    { id:'url',    label:'Depuis URL',icon:'fa-link' },
    { id:'search', label:'Recherche web', icon:'fa-magnifying-glass' },
    { id:'forum',  label:'Forums',    icon:'fa-comments' }
  ];

  const summary = (() => {
    if (!res) return null;
    const d = res.data;
    if (d.saved) return `${d.saved.length} stratégie(s) sauvegardée(s) · ${d.found?.length || 0} résultat(s) trouvé(s)`;
    if (d.results) return d.results.map(r => `${r.success ? '✓' : '✗'} ${r.url || r.strategy?.title}`).join(' · ');
    if (d.strategy) return `Ajouté : ${d.strategy.title}`;
    return 'Terminé';
  })();

  return (
    <Reveal>
      <SpotlightCard className="panel" spotlightColor="rgba(124,58,237,.2)">
        <div style={{ padding:'22px' }}>
          <h2 style={{ fontSize:18, fontWeight:800, marginBottom:14, display:'flex', alignItems:'center', gap:10 }}>
            <i className="fas fa-brain" style={{ color:'var(--accent2)' }}></i>Ajouter à la base de connaissance
          </h2>

          <div className="nav" style={{ marginBottom:20 }}>
            {METHODS.map(m => (
              <button key={m.id} type="button"
                className={`nav-item ${tab===m.id?'on':''}`}
                onClick={()=>{setTab(m.id);setRes(null)}}>
                <i className={`fas ${m.icon}`}></i>{m.label}
              </button>
            ))}
          </div>

          {tab==='decrire' && (<>
            <p style={{ fontSize:13, color:'var(--muted)', marginBottom:12 }}>
              Explique ta stratégie avec tes mots. L'application l'analyse, en tire une
              fiche structurée — règles, style, unités de temps, entrée, invalidation — et
              l'enregistre. Elle est ensuite utilisable dans « Ma stratégie ».
            </p>
            <textarea className="fld" rows="8" value={decrire}
              onChange={e=>setDecrire(e.target.value)}
              placeholder="Ex. Je scalpe les indices synthétiques en 1 minute. J'attends que le prix balaie un plus bas évident puis revienne vite au-dessus. Là je regarde si la bougie de retour laisse un FVG ou un order block : quand le prix revient tester cette zone et rejette, j'achète. Stop sous le plus bas du balayage, objectif sur l'équilibre du range. Je ne trade pas la session asiatique." />
            <div style={{ display:'flex', gap:12, alignItems:'center', marginTop:10, flexWrap:'wrap' }}>
              <button className="btn" disabled={decrireBusy || decrire.trim().length < 30}
                onClick={analyserDescription}>
                {decrireBusy
                  ? <><i className="fas fa-spinner fa-spin"></i> Analyse…</>
                  : <><i className="fas fa-wand-magic-sparkles"></i> Analyser et enregistrer</>}
              </button>
              <span style={{ fontSize:12, color:'var(--dim)' }}>
                {decrire.trim().length} caractère(s){decrire.trim().length < 30 ? ' — 30 minimum' : ''}
              </span>
            </div>
            {decrireErr && (
              <p style={{ color:'#f87171', fontSize:12.5, marginTop:10 }}>
                <i className="fas fa-circle-exclamation" style={{ marginRight:6 }}></i>{decrireErr}
              </p>
            )}

            {fiche && (
              <div className="panel" style={{ marginTop:14, padding:'14px 16px',
                borderColor:'rgba(16,185,129,.35)' }}>
                <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', marginBottom:9 }}>
                  <b style={{ fontSize:14 }}>{fiche.strategy.title}</b>
                  <span className="badge" style={{ background:'rgba(16,185,129,.14)', color:'#34d399' }}>
                    <i className="fas fa-check" style={{ marginRight:5 }}></i>enregistrée
                  </span>
                  {fiche.moteur.style && <span className="tag">{fiche.moteur.style}</span>}
                  {(fiche.moteur.timeframes || []).map(t => <span key={t} className="tag">{t}</span>)}
                </div>
                {fiche.fiche && fiche.fiche.resume && (
                  <p style={{ fontSize:13, color:'var(--muted)', margin:'0 0 11px' }}>{fiche.fiche.resume}</p>
                )}
                <div style={{ display:'grid', gap:7, fontSize:12.5 }}>
                  <div>
                    <b style={{ color:'#93c5fd' }}>Règles retenues : </b>
                    {(fiche.moteur.regles || []).join(' + ') || 'toutes'}
                  </div>
                  <div>
                    <b style={{ color:'#93c5fd' }}>Alignement : </b>
                    {(fiche.moteur.timeframes || []).join(' + ') || 'unités du graphique'}
                    {fiche.moteur.seuilAlignes ? ` · au moins ${fiche.moteur.seuilAlignes} d'accord` : ''}
                  </div>
                  <div>
                    <b style={{ color:'#93c5fd' }}>Force minimale : </b>
                    {Math.round((fiche.moteur.seuilForce || 0) * 100)} %
                    {' · stop '}{fiche.moteur.atrStop}× ATR
                  </div>
                  {fiche.fiche && fiche.fiche.entree && (
                    <div><b style={{ color:'#93c5fd' }}>Entrée : </b>{fiche.fiche.entree}</div>)}
                  {fiche.fiche && fiche.fiche.invalidation && (
                    <div><b style={{ color:'#93c5fd' }}>Invalidation : </b>{fiche.fiche.invalidation}</div>)}
                  {fiche.fiche && fiche.fiche.objectif && (
                    <div><b style={{ color:'#93c5fd' }}>Objectif : </b>{fiche.fiche.objectif}</div>)}
                  {fiche.fiche && fiche.fiche.contexte && (
                    <div><b style={{ color:'#93c5fd' }}>À éviter : </b>{fiche.fiche.contexte}</div>)}
                  {(fiche.strategy.structured && fiche.strategy.structured.concepts || []).length > 0 && (
                    <div>
                      <b style={{ color:'#93c5fd' }}>Concepts : </b>
                      {fiche.strategy.structured.concepts.join(', ')}
                    </div>
                  )}
                </div>
                <p style={{ fontSize:11.5, color:'var(--dim)', marginTop:11 }}>
                  Utilisable tout de suite : onglet Direct → « Ma stratégie ».
                  Tu peux l'ajuster ensuite depuis l'onglet Stratégies.
                </p>
              </div>
            )}
          </>)}

          {tab==='upload' && (<>
            <p style={{ fontSize:13, color:'var(--muted)', marginBottom:12 }}>
              PDF, DOCX, TXT ou MD — plusieurs fichiers à la fois. Le texte est extrait puis indexé.
            </p>
            <div className="drop" onClick={()=>document.getElementById('f-docs').click()}>
              <input id="f-docs" type="file" multiple accept=".pdf,.docx,.txt,.md" style={{display:'none'}}
                onChange={e=>{ const fd=new FormData(); Array.from(e.target.files).forEach(f=>fd.append('documents',f)); post('/upload-strategies', fd, true); }} />
              <i className="fas fa-file-arrow-up" style={{ fontSize:26, color:'#60a5fa' }}></i>
              <p style={{ color:'var(--muted)', marginTop:9, fontSize:13.5, fontWeight:600 }}>Cliquez pour choisir des fichiers</p>
            </div>
          </>)}

          {tab==='manual' && (<>
            <label className="lbl" style={{marginTop:0}}>Titre</label>
            <input className="fld" value={manual.title} onChange={e=>setManual({...manual,title:e.target.value})} />
            <label className="lbl">Contenu (règles, conditions, gestion du risque)</label>
            <textarea className="fld" rows="8" value={manual.content}
              onChange={e=>setManual({...manual,content:e.target.value})} />
            <label className="lbl">Type</label>
            <select className="fld" aria-label="Type de plan manuel" value={manual.type} onChange={e=>setManual({...manual,type:e.target.value})}>
              <option value="strategy">Stratégie</option>
              <option value="concept">Concept</option>
              <option value="pattern">Pattern</option>
              <option value="money-management">Gestion du risque</option>
            </select>
            <button className="btn" style={{ marginTop:14 }} disabled={busy}
              onClick={()=>post('/knowledge', manual)}>
              {busy ? <Spinner /> : <i className="fas fa-plus"></i>}Ajouter
            </button>
          </>)}

          {tab==='url' && (<>
            <p style={{ fontSize:13, color:'var(--muted)', marginBottom:12 }}>
              L'IA lit la page, en extrait les stratégies et les structure (entrée, SL, TP, timeframes, conditions).
            </p>
            <label className="lbl" style={{marginTop:0}}>URLs (une par ligne)</label>
            <textarea className="fld" rows="5" value={urls} onChange={e=>setUrls(e.target.value)}
              placeholder="https://www.babypips.com/learn/forex/…" />
            <button className="btn" style={{ marginTop:14 }} disabled={busy}
              onClick={()=>post('/scrape-strategies', { urls: urls.split('\n').map(u=>u.trim()).filter(Boolean) })}>
              {busy ? <Spinner /> : <i className="fas fa-download"></i>}Importer &amp; structurer
            </button>
          </>)}

          {tab==='search' && (<>
            <p style={{ fontSize:13, color:'var(--muted)', marginBottom:12 }}>
              Recherche web autonome, scraping des meilleurs résultats et sauvegarde automatique.
            </p>
            <label className="lbl" style={{marginTop:0}}>Requête</label>
            <input className="fld" value={sq} onChange={e=>setSq(e.target.value)}
              placeholder="ex : order block strategy XAUUSD scalping" />
            <label className="lbl">Pages à sauvegarder</label>
            <select className="fld" aria-label="Niveau de détail de la réponse" value={slim} onChange={e=>setSlim(e.target.value)}>
              {[3,5,8,10].map(n=><option key={n} value={n}>{n}</option>)}
            </select>
            <button className="btn ok" style={{ marginTop:14, width:'100%' }}
              disabled={busy || !sq}
              onClick={()=>post('/search-and-save', { query: sq, limit: Number(slim), autoSave: true })}>
              {busy ? <Spinner /> : <i className="fas fa-magnifying-glass"></i>}Chercher &amp; sauvegarder
            </button>
          </>)}

          {tab==='forum' && (<>
            <label className="lbl" style={{marginTop:0}}>Source</label>
            <select className="fld" aria-label="Forum de la source" value={forum} onChange={e=>setForum(e.target.value)}>
              <option value="babypips">BabyPips</option>
              <option value="forexfactory">ForexFactory</option>
              <option value="tradingview">TradingView</option>
              <option value="reddit">Reddit r/Forex</option>
              <option value="investopedia">Investopedia</option>
            </select>
            <label className="lbl">Mots-clés (optionnel)</label>
            <input className="fld" value={fkw} onChange={e=>setFkw(e.target.value)} placeholder="ex : liquidity sweep" />
            <button className="btn" style={{ marginTop:14 }} disabled={busy}
              onClick={()=>post('/scrape-forums', { forum, keywords: fkw, limit: 5 })}>
              {busy ? <Spinner /> : <i className="fas fa-comments"></i>}Miner depuis {forum}
            </button>
          </>)}

          {busy && (
            <div style={{ marginTop:18, display:'flex', alignItems:'center', gap:12 }}>
              {LatticeLoader
                ? <LatticeLoader label="Traitement" status="working" color="var(--accent2)" fontSize={12} />
                : <><Spinner size={18} color="var(--accent2)" /><span style={{color:'var(--muted)',fontSize:13}}>Traitement…</span></>}
            </div>
          )}

          {res && !busy && (
            <div style={{ marginTop:16, padding:13, borderRadius:11, fontSize:12.5, lineHeight:1.6,
              background: res.ok ? 'rgba(16,185,129,.1)' : 'rgba(239,68,68,.1)',
              border: `1px solid ${res.ok ? 'rgba(16,185,129,.3)' : 'rgba(239,68,68,.3)'}`,
              color: res.ok ? '#6ee7b7' : '#fca5a5' }}>
              <div style={{ fontWeight:700, marginBottom:4 }}>
                <i className={`fas ${res.ok ? 'fa-circle-check' : 'fa-circle-exclamation'}`} style={{marginRight:7}}></i>
                {res.ok ? 'Succès' : 'Échec'}
              </div>
              <div>{res.data.error || summary}</div>
            </div>
          )}
        </div>
      </SpotlightCard>
    </Reveal>
  );
}

/* ══════════════ STRATÉGIES ══════════════ */

function Strategies({ strategies, onDelete, onSaved }) {
  const [q, setQ] = useState('');
  const [remote, setRemote] = useState(null);   // résultats du moteur plein-texte
  const [searching, setSearching] = useState(false);
  // Édition en place : on modifie une stratégie sans quitter la liste.
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ title:'', content:'', type:'strategy' });
  // Fonctionnement de la stratégie : règles, style, unités de temps, seuils et
  // réglages de calcul. C'est ce qui décide COMMENT elle analyse le marché.
  const [moteur, setMoteur] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const MOTEUR_VIDE = {
    style: '', regles: ['R1','R2','R3','R4'], seuilForce: 0.35, seuilRegles: 2,
    timeframes: [], seuilAlignes: 2, swingsWindow: 2, toleranceLiquidite: 0.0008,
    impulsion: 3, atrStop: 1.5
  };
  const REGLES_INFO = [
    { id:'R1', label:'Balayage de liquidité' },
    { id:'R2', label:'Rupture de structure' },
    { id:'R3', label:'Zone réactive (OB / FVG)' },
    { id:'R4', label:'Position premium / discount' }
  ];
  const TF_INFO = ['1m','5m','15m','30m','1h','4h','1d'];
  const STYLES_INFO = [
    { id:'', label:'— aucun (déduit du texte) —' },
    { id:'scalping', label:'Scalping (1m / 5m / 15m, stop serré)' },
    { id:'intraday', label:'Intraday (5m / 15m / 1h)' },
    { id:'swing', label:'Swing (1h / 4h / 1d, stop large)' }
  ];

  const ouvrirEdition = (s) => {
    setEditing(s.id);
    setForm({ title: s.title || '', content: s.content || s.structured?.summary || '', type: s.type || 'strategy' });
    setMoteur(s.moteur ? { ...MOTEUR_VIDE, ...s.moteur } : null);
    setErr('');
  };

  const enregistrer = async () => {
    setBusy(true); setErr('');
    try {
      const r = await api('/knowledge/' + encodeURIComponent(editing), {
        method:'PUT', headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ ...form, moteur })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Modification refusée');
      setEditing(null);
      if (onSaved) await onSaved();       // recharge la liste ET les profils
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  // Recherche serveur (accents, pondération titre/tags/contenu, extrait).
  // En dessous de 2 caractères on affiche la liste complète.
  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) { setRemote(null); setSearching(false); return; }
    let alive = true;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const r = await api('/search?q=' + encodeURIComponent(query));
        const d = await r.json();
        if (alive) setRemote(r.ok ? d.results : []);
      } catch { if (alive) setRemote([]); }
      finally { if (alive) setSearching(false); }
    }, 250);
    return () => { alive = false; clearTimeout(timer); };
  }, [q]);

  const list = useMemo(() => {
    if (!remote) return strategies;
    const byId = new Map(strategies.map(s => [s.id, s]));
    return remote
      .map(r => { const s = byId.get(r.id); return s ? { ...s, _excerpt: r.excerpt, _score: r.score } : null; })
      .filter(Boolean);
  }, [strategies, remote]);

  return (
    <div>
      <Reveal>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:14,
          flexWrap:'wrap', marginBottom:16 }}>
          <h2 style={{ fontSize:18, fontWeight:800, display:'flex', alignItems:'center', gap:10 }}>
            <i className="fas fa-book" style={{ color:'#60a5fa' }}></i>
            Base de connaissance
            <span className="badge" style={{ background:'rgba(37,99,235,.14)', color:'#8fb4ff' }}>
              {remote ? `${list.length} / ${strategies.length}` : strategies.length}
            </span>
          </h2>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            {searching && <Spinner size={14} />}
            {remote && !searching && (
              <span style={{ fontSize:11.5, color:'var(--muted)' }}>
                <i className="fas fa-magnifying-glass" style={{ marginRight:5 }}></i>plein-texte
              </span>
            )}
            <input className="fld" style={{ maxWidth:280, margin:0 }}
              placeholder="Rechercher (accents ignorés)…"
              value={q} onChange={e=>setQ(e.target.value)} />
          </div>
        </div>
      </Reveal>

      {list.length === 0 && (
        <div className="panel" style={{ padding:34, textAlign:'center', color:'var(--muted)', fontSize:13.5 }}>
          <i className="fas fa-inbox" style={{ fontSize:26, color:'var(--dim)', display:'block', marginBottom:10 }}></i>
          {remote
            ? <>Aucune stratégie ne correspond à « {q.trim()} » — tous les termes doivent être présents.</>
            : <>Aucune stratégie pour l'instant — utilisez l'onglet « Ajouter ».</>}
        </div>
      )}

      <div className="grid-auto">
        {list.map((s, i) => (
          <Reveal key={s.id} delay={Math.min(i*45, 360)}>
            <SpotlightCard className="panel" spotlightColor="rgba(37,99,235,.2)">
              <div style={{ padding:17, height:'100%', display:'flex', flexDirection:'column' }}>
                <div style={{ display:'flex', justifyContent:'space-between', gap:9, alignItems:'flex-start' }}>
                  <h3 style={{ fontSize:14.5, fontWeight:700, lineHeight:1.35 }}>{s.title}</h3>
                  <span className="badge" style={{ flexShrink:0, background:'rgba(148,163,184,.12)', color:'var(--muted)' }}>
                    {s.source || s.type}
                  </span>
                </div>
                {editing === s.id ? (
                  <div style={{ margin:'9px 0 11px', display:'grid', gap:8 }}>
                    <input className="fld" style={{ margin:0 }} value={form.title}
                      onChange={e=>setForm(f=>({ ...f, title:e.target.value }))} placeholder="Titre" />
                    <select className="fld" aria-label="Type d'entrée" style={{ margin:0 }} value={form.type}
                      onChange={e=>setForm(f=>({ ...f, type:e.target.value }))}>
                      <option value="strategy">stratégie</option>
                      <option value="concept">concept</option>
                      <option value="guide">guide</option>
                    </select>
                    <textarea className="fld" rows={7} style={{ margin:0, fontFamily:'ui-monospace,monospace', fontSize:12 }}
                      value={form.content}
                      onChange={e=>setForm(f=>({ ...f, content:e.target.value }))}
                      placeholder="Contenu — ce texte conditionne les règles qui seront appliquées en mode « Ma stratégie »." />
                    <p style={{ margin:0, fontSize:11.5, color:'var(--dim)' }}>
                      Les étiquettes et les règles d'analyse sont recalculées depuis ce texte.
                    </p>

                    {/* Fonctionnement : décider COMMENT la stratégie analyse,
                        au lieu de le déduire du texte. */}
                    <div style={{ border:'1px solid rgba(27,36,51,.7)', borderRadius:8, padding:'10px 12px', display:'grid', gap:9 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                        <b style={{ fontSize:12.5 }}>Fonctionnement</b>
                        <span style={{ fontSize:11, color: moteur ? '#34d399' : 'var(--dim)' }}>
                          {moteur ? 'défini explicitement' : 'déduit du texte'}
                        </span>
                        <button onClick={() => setMoteur(m => m ? null : { ...MOTEUR_VIDE })}
                          style={{ marginLeft:'auto', background:'none', border:'none', color:'#60a5fa', cursor:'pointer', fontSize:12 }}>
                          {moteur ? 'Revenir à la déduction' : 'Définir le fonctionnement'}
                        </button>
                      </div>

                      {moteur && (<>
                        <div>
                          <div style={{ fontSize:11.5, color:'var(--muted)', marginBottom:4 }}>Style de trading (fixe les unités de temps)</div>
                          <select className="fld" aria-label="Style du moteur" style={{ margin:0, width:'100%' }} value={moteur.style || ''}
                            onChange={e => setMoteur(m => ({ ...m, style: e.target.value, timeframes: [] }))}>
                            {STYLES_INFO.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
                          </select>
                        </div>

                        <div>
                          <div style={{ fontSize:11.5, color:'var(--muted)', marginBottom:4 }}>Règles appliquées</div>
                          <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
                            {REGLES_INFO.map(r => (
                              <label key={r.id} style={{ display:'flex', gap:5, alignItems:'center', fontSize:12, cursor:'pointer' }}>
                                <input type="checkbox" checked={(moteur.regles || []).includes(r.id)}
                                  onChange={() => setMoteur(m => ({ ...m,
                                    regles: (m.regles || []).includes(r.id)
                                      ? (m.regles || []).filter(x => x !== r.id)
                                      : [...(m.regles || []), r.id] }))} />
                                {r.id} · {r.label}
                              </label>
                            ))}
                          </div>
                        </div>

                        <div>
                          <div style={{ fontSize:11.5, color:'var(--muted)', marginBottom:4 }}>
                            Unités de temps examinées ensemble (alignement)
                          </div>
                          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                            {TF_INFO.map(t => (
                              <label key={t} style={{ display:'flex', gap:4, alignItems:'center', fontSize:12, cursor:'pointer' }}>
                                <input type="checkbox" checked={(moteur.timeframes || []).includes(t)}
                                  onChange={() => setMoteur(m => {
                                    // Le seuil suit le nombre d'unités cochées : 2 unités → 2
                                    // alignements exigés, 3 → 3, 4 → 4. C'est la règle de la
                                    // stratégie, pas un plafond de la plateforme.
                                    const liste = (m.timeframes || []).includes(t)
                                      ? (m.timeframes || []).filter(x => x !== t)
                                      : [...(m.timeframes || []), t];
                                    return { ...m, timeframes: liste, seuilAlignes: liste.length || 1 };
                                  })} />
                                {t}
                              </label>
                            ))}
                          </div>
                          <div style={{ color:'var(--muted)', fontSize:11.5, marginTop:6 }}>
                            Toutes les unités cochées doivent s'aligner : {(moteur.timeframes || []).length || 0} cochée(s)
                            → seuil {moteur.seuilAlignes || 1}. Une stratégie en 2 unités n'exige pas de 3e.
                          </div>
                        </div>

                        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))', gap:8 }}>
                          <label style={{ fontSize:12 }}>
                            <div style={{ color:'var(--muted)', marginBottom:3 }}>
                              Force mini {((moteur.seuilForce || 0) * 100).toFixed(0)} %
                            </div>
                            <input type="range" min="0" max="1" step="0.05" value={moteur.seuilForce || 0}
                              onChange={e => setMoteur(m => ({ ...m, seuilForce: Number(e.target.value) }))}
                              style={{ width:'100%' }} />
                          </label>
                          <label style={{ fontSize:12 }}>
                            <div style={{ color:'var(--muted)', marginBottom:3 }}>Unités à aligner</div>
                            <input className="fld" type="number" min="1" max="5" value={moteur.seuilAlignes || 2}
                              onChange={e => setMoteur(m => ({ ...m, seuilAlignes: Number(e.target.value) }))} />
                          </label>
                          <label style={{ fontSize:12 }}>
                            <div style={{ color:'var(--muted)', marginBottom:3 }}>Stop (× ATR)</div>
                            <input className="fld" type="number" min="0.5" max="5" step="0.5" value={moteur.atrStop || 1.5}
                              onChange={e => setMoteur(m => ({ ...m, atrStop: Number(e.target.value) }))} />
                          </label>
                          <label style={{ fontSize:12 }}>
                            <div style={{ color:'var(--muted)', marginBottom:3 }}>Fenêtre des swings</div>
                            <input className="fld" type="number" min="1" max="5" value={moteur.swingsWindow || 2}
                              onChange={e => setMoteur(m => ({ ...m, swingsWindow: Number(e.target.value) }))} />
                          </label>
                        </div>
                      </>)}
                    </div>
                  </div>
                ) : (
                  <p style={{ fontSize:12.5, color:'var(--muted)', lineHeight:1.6, margin:'9px 0 11px', flex:1 }}>
                    {s._excerpt
                      ? s._excerpt
                      : `${(s.structured?.summary || s.content || '').slice(0,190)}…`}
                  </p>
                )}
                <div style={{ marginBottom:11 }}>
                  {(s.tags||[]).slice(0,6).map((t,k)=> <span key={k} className="tag">{t}</span>)}
                </div>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
                  paddingTop:10, borderTop:'1px solid rgba(27,36,51,.6)' }}>
                  <span style={{ fontSize:11, color:'var(--dim)' }}>
                    <i className="fas fa-clock" style={{marginRight:5}}></i>
                    {new Date(s.createdAt).toLocaleDateString('fr-FR')}
                  </span>
                  <div style={{ display:'flex', gap:8 }}>
                    {s.sourceUrl && (
                      <a href={s.sourceUrl} target="_blank" rel="noreferrer"
                        style={{ color:'#60a5fa', fontSize:12.5 }}>
                        <i className="fas fa-external-link-alt"></i></a>
                    )}
                    {editing === s.id ? (
                      <>
                        <button onClick={enregistrer} disabled={busy}
                          style={{ background:'none', border:'none', color:'#34d399', cursor:'pointer', fontSize:12.5 }}>
                          {busy ? '…' : <><i className="fas fa-check"></i> Enregistrer</>}
                        </button>
                        <button onClick={()=>setEditing(null)}
                          style={{ background:'none', border:'none', color:'var(--muted)', cursor:'pointer', fontSize:12.5 }}>
                          <i className="fas fa-xmark"></i>
                        </button>
                      </>
                    ) : (
                      <button onClick={()=>ouvrirEdition(s)} title="Modifier le titre, le type et le contenu"
                        style={{ background:'none', border:'none', color:'#60a5fa', cursor:'pointer', fontSize:12.5 }}>
                        <i className="fas fa-pen"></i>
                      </button>
                    )}
                    <button onClick={()=>onDelete(s.id)}
                      style={{ background:'none', border:'none', color:'#f87171', cursor:'pointer', fontSize:12.5 }}>
                      <i className="fas fa-trash"></i>
                    </button>
                  </div>
                </div>
              </div>
            </SpotlightCard>
          </Reveal>
        ))}
      </div>
    </div>
  );
}

/* ══════════════ HISTORIQUE ══════════════ */

function History({ history }) {
  if (!history.length) {
    return (
      <div className="panel" style={{ padding:34, textAlign:'center', color:'var(--muted)', fontSize:13.5 }}>
        <i className="fas fa-clock-rotate-left" style={{ fontSize:26, color:'var(--dim)', display:'block', marginBottom:10 }}></i>
        Aucune analyse pour l'instant.
      </div>
    );
  }
  return (
    <div>
      <Reveal>
        <h2 style={{ fontSize:18, fontWeight:800, marginBottom:16, display:'flex', alignItems:'center', gap:10 }}>
          <i className="fas fa-clock-rotate-left" style={{ color:'#60a5fa' }}></i>Historique des analyses
        </h2>
      </Reveal>
      <div style={{ position:'relative', paddingLeft:22 }}>
        <div style={{ position:'absolute', left:7, top:6, bottom:6, width:2,
          background:'linear-gradient(180deg,rgba(37,99,235,.6),rgba(124,58,237,.15))' }}></div>
        {history.map((h,i) => (
          <Reveal key={h.id} delay={Math.min(i*50, 300)}>
            <div style={{ position:'relative', marginBottom:13 }}>
              <div style={{ position:'absolute', left:-21, top:16, width:12, height:12, borderRadius:'50%',
                background: h.action==='BUY' ? '#10b981' : h.action==='SELL' ? '#ef4444' : '#f59e0b',
                border:'2px solid #070a11', boxShadow:'0 0 10px rgba(37,99,235,.5)' }}></div>
              <div className="panel" style={{ padding:15 }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:10, flexWrap:'wrap' }}>
                  <span style={{ fontWeight:700, fontSize:14, display:'flex', alignItems:'center', gap:9 }}>
                    {h.pair}
                    <span style={{ color:'var(--muted)', fontWeight:500, fontSize:12.5 }}>{h.timeframes}</span>
                    <ActionBadge action={h.action} />
                  </span>
                  <span style={{ fontSize:11, color:'var(--dim)' }}>{new Date(h.timestamp).toLocaleString('fr-FR')}</span>
                </div>
                <div style={{ fontSize:12.5, color:'var(--muted)', marginTop:6, lineHeight:1.6 }}>{h.reason}</div>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </div>
  );
}

/* ══════════════ MARCHÉ EN DIRECT ══════════════ */

/* Graphique TradingView Lightweight Charts : chandeliers + volume + niveaux.
   Zoom, déplacement et échelle de prix sont natifs (molette, glisser-déposer). */
function PriceChart({ candles, levels, signal, height, symbol, tf, report }) {
  const boxRef = useRef(null);
  const overlayRef = useRef(null);
  const api = useRef({ chart: null, series: null, vol: null, lines: [], full: true });
  // Suit le couple symbole/unité de temps : tout changement impose un
  // rechargement COMPLET de la série. Sans cela, un simple update() sur un
  // symbole dont l'échelle de prix est très différente (BTC ≈ 83 000 →
  // Volatility 75 ≈ 43 000) laissait un graphique vide.
  const keyRef = useRef(null);
  // Sans la bibliothèque, mieux vaut le dire que laisser un cadre vide.
  const [libMissing, setLibMissing] = useState(!window.LightweightCharts);
  // La bibliothèque peut arriver APRÈS le premier rendu (repli CDN) : on guette
  // sa disponibilité pour dessiner dès qu'elle est là, au lieu de rester sur un
  // cadre vide jusqu'au prochain rechargement de page.
  const [libPrete, setLibPrete] = useState(!!window.LightweightCharts);
  // Compteur de ce qui est REELLEMENT dessine : la preuve visible que le calque
  // tourne. Sans lui, un calque inactif et un graphique sans zones se
  // ressemblent (un cadre vide).
  const [zonesTracees, setZonesTracees] = useState(null);

  useEffect(() => {
    if (window.LightweightCharts) { setLibPrete(true); setLibMissing(false); return; }
    const reveil = () => {
      if (window.LightweightCharts) { setLibPrete(true); setLibMissing(false); }
    };
    window.addEventListener('lwc-pret', reveil);
    const veille = setInterval(() => {
      if (window.LightweightCharts) { setLibPrete(true); setLibMissing(false); clearInterval(veille); }
    }, 500);
    return () => { window.removeEventListener('lwc-pret', reveil); clearInterval(veille); };
  }, []);

  useEffect(() => {
    const box = boxRef.current;
    const LC = window.LightweightCharts;
    if (!box || !LC) { setLibMissing(true); return; }
    setLibMissing(false);
    const chart = LC.createChart(box, {
      layout: { background: { type: 'solid', color: '#080c14' }, textColor: '#cbd5e1', fontSize: 11,
        fontFamily: 'ui-sans-serif, system-ui, sans-serif' },
      grid: { vertLines: { color: 'rgba(148,163,184,.07)' }, horzLines: { color: 'rgba(148,163,184,.07)' } },
      crosshair: {
        mode: LC.CrosshairMode.Normal,
        vertLine: { color: 'rgba(148,163,184,.55)', width: 1, style: LC.LineStyle.Dashed, labelBackgroundColor: '#1e293b' },
        horzLine: { color: 'rgba(148,163,184,.55)', width: 1, style: LC.LineStyle.Dashed, labelBackgroundColor: '#1e293b' }
      },
      rightPriceScale: { borderColor: 'rgba(148,163,184,.18)', scaleMargins: { top: 0.08, bottom: 0.24 } },
      timeScale: { borderColor: 'rgba(148,163,184,.18)', timeVisible: true, secondsVisible: false, rightOffset: 4 },
      localization: { locale: 'fr-FR' },
      handleScroll: true, handleScale: true
    });
    const series = chart.addCandlestickSeries({
      upColor: '#22d38a', downColor: '#f2545b',
      borderUpColor: '#22d38a', borderDownColor: '#f2545b',
      wickUpColor: '#22d38a', wickDownColor: '#f2545b',
      priceLineVisible: true, priceLineColor: 'rgba(255,255,255,.4)', priceLineStyle: LC.LineStyle.Dashed
    });
    const vol = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol',
      lastValueVisible: false, priceLineVisible: false });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    api.current = { chart, series, vol, lines: [], full: true };

    // La taille ne doit jamais rester à zéro : dans un onglet en arrière-plan
    // ou un panneau pas encore disposé, clientWidth vaut 0 et le graphique
    // resterait invisible. On remesure à plusieurs moments.
    const fit = () => {
      const w = box.clientWidth, h = box.clientHeight;
      if (w > 0 && h > 0) chart.applyOptions({ width: w, height: h });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    const t1 = setTimeout(fit, 250);
    const t2 = setTimeout(fit, 1200);
    return () => {
      clearTimeout(t1); clearTimeout(t2); ro.disconnect(); chart.remove();
      api.current = { chart: null, series: null, vol: null, lines: [], full: true };
    };
  }, [libPrete]);

  // setData au premier chargement (ou après changement de symbole/timeframe),
  // puis update du seul dernier point : c'est ce qui rend le direct fluide.
  useEffect(() => {
    // Toute erreur de dessin est rattrapée ici : elle ne doit jamais remonter à
    // React et faire disparaître toute l'interface (erreur vécue).
    try {
    const { chart, series, vol } = api.current;
    if (!series || !candles || !candles.length) return;
    const sigKey = `${symbol}|${tf}`;
    if (keyRef.current !== sigKey) { api.current.full = true; keyRef.current = sigKey; }
    const toTime = c => Math.floor(c.t / 1000);
    const point = c => ({ time: toTime(c), open: c.o, high: c.h, low: c.l, close: c.c });
    const bar = c => ({ time: toTime(c), value: c.v || 0, color: c.c >= c.o ? 'rgba(34,211,138,.32)' : 'rgba(242,84,91,.32)' });
    if (api.current.full) {
      series.setData(candles.map(point));
      if (vol) vol.setData(candles.map(bar));
      api.current.chart.timeScale().fitContent();
      api.current.full = false;
      api.current.lastTime = toTime(candles[candles.length - 1]);
    } else {
      const last = candles[candles.length - 1];
      const t = toTime(last);
      // PIÈGE (erreur vécue) : après une reconnexion ou un rechargement, la
      // bougie reçue peut être PLUS ANCIENNE que le dernier point affiché. Un
      // update() lève alors « Cannot update oldest data » — une exception que
      // React ne rattrape pas, et toute l'application tombe. On recharge donc
      // la série complète dans ce cas.
      if (api.current.lastTime !== undefined && t < api.current.lastTime) {
        series.setData(candles.map(point));
        if (vol) vol.setData(candles.map(bar));
      } else {
        series.update(point(last));
        if (vol) vol.update(bar(last));
      }
      api.current.lastTime = t;
    }
    // Prix de référence pour hiérarchiser les niveaux : le dernier close connu.
    const dernierClose = candles[candles.length - 1];
    if (dernierClose && Number.isFinite(dernierClose.c)) api.current.lastClose = dernierClose.c;
    } catch (e) {
      // On repart d'un rechargement complet au prochain rendu.
      api.current.full = true;
    }
  }, [candles, symbol, tf]);

  // (Le rechargement complet au changement de symbole/timeframe est géré
  //  dans l'effet des données via keyRef — un effet séparé s'exécutait dans
  //  le mauvais ordre et laissait la série précédente à l'écran.)

  // Niveaux calculés (FVG, order blocks, swings, liquidité) en lignes de prix
  useEffect(() => {
    const { series } = api.current;
    if (!series) return;
    api.current.lines.forEach(l => { try { series.removePriceLine(l); } catch (e) {} });
    // L'axe ne supporte pas vingt-cinq étiquettes : elles se chevauchaient, se
    // superposaient au prix et rendaient le graphique illisible. On garde les
    // niveaux qui décident — les plus proches du prix — plus le support et la
    // résistance les plus proches, et on ANNONCE les autres au lieu de les
    // faire disparaître en silence.
    const tous = (levels || []).filter(l => Number.isFinite(l.price));
    const MAX_NIVEAUX = 6;
    const ref = Number.isFinite(api.current.lastClose) ? api.current.lastClose
      : (tous.length ? tous.map(l => l.price).sort((a, b) => a - b)[Math.floor(tous.length / 2)] : null);

    let gardes = tous;
    if (ref !== null && tous.length > MAX_NIVEAUX) {
      const choisis = [...tous]
        .sort((a, b) => Math.abs(a.price - ref) - Math.abs(b.price - ref))
        .slice(0, MAX_NIVEAUX);
      const plusBas = tous.filter(l => l.price <= ref).sort((a, b) => b.price - a.price)[0];
      const plusHaut = tous.filter(l => l.price >= ref).sort((a, b) => a.price - b.price)[0];
      for (const l of [plusBas, plusHaut]) {
        if (!l || choisis.includes(l)) continue;
        const loin = choisis.reduce((p, c) => Math.abs(c.price - ref) > Math.abs(p.price - ref) ? c : p, choisis[0]);
        choisis.splice(choisis.indexOf(loin), 1, l);
      }
      gardes = choisis;
    }
    api.current.niveauxMasques = Math.max(0, tous.length - gardes.length);

    api.current.lines = gardes.map(l => {
      const color = l.side === 'support' ? 'rgba(34,211,138,.8)'
        : l.side === 'resistance' ? 'rgba(242,84,91,.8)'
        : l.side === 'liquidité' ? 'rgba(245,158,11,.75)' : 'rgba(96,165,250,.75)';
      return series.createPriceLine({ price: l.price, color, lineWidth: 1,
        lineStyle: window.LightweightCharts.LineStyle.Dashed, axisLabelVisible: true, title: l.kind });
    });
  }, [levels]);

  // Repère du signal sur la bougie concernée
  useEffect(() => {
    const { series } = api.current;
    if (!series || !signal || !signal.at) return;
    const buy = signal.direction === 'BUY';
    try {
      series.setMarkers([{ time: Math.floor(signal.at / 1000),
        position: buy ? 'belowBar' : 'aboveBar',
        color: signal.status === 'confirme' && signal.levels ? (buy ? '#22d38a' : '#f2545b') : '#64748b',
        shape: buy ? 'arrowUp' : 'arrowDown',
        // Gris = règles d'accord SANS niveaux publiés, donc rien à exécuter.
        text: (signal.status === 'confirme' && signal.levels ? '' : 'règles ') + (buy ? 'ACHAT' : 'VENTE') }]);
    } catch (e) {}
  }, [signal]);

  // ── Calque de zones : OB, FVG, liquidité, premium/discount, OTE ──
  // Tout est redessiné quand les données changent, quand on zoome ou qu'on
  // déplace le graphique, et quand la taille change. C'est ce qui fait bouger
  // les zones AVEC le prix au lieu d'afficher un dessin figé.
  useEffect(() => {
    const { chart, series } = api.current;
    const cvs = overlayRef.current;
    if (!chart || !series || !cvs) return;
    // Le rapport courant est stocké ici : dessiner() le relit à chaque redessin.
    api.current.report = report;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const dessiner = () => {
      const w = cvs.clientWidth, h = cvs.clientHeight;
      if (!w || !h) return;
      const cw = Math.round(w * dpr), chh = Math.round(h * dpr);
      if (cvs.width !== cw || cvs.height !== chh) { cvs.width = cw; cvs.height = chh; }
      const ctx = cvs.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const rep = api.current.report;
      if (!rep) return;
      const compte = { ob: 0, fvg: 0, liq: 0, sweep: 0, labels: 0 };
      // Budget de TEXTE : toutes les zones restent tracées, mais seules quelques
      // unes portent un libellé. Vingt-cinq étiquettes au même x se
      // chevauchaient et rendaient le graphique illisible ; les tracés, eux,
      // restent lisibles.
      const BUDGET_LABELS = 6;
      const peutEtiqueter = () => compte.labels < BUDGET_LABELS;

      // Conversion temps → pixel, prix → pixel. null si hors de la vue.
      const X = t => { try { const v = chart.timeScale().timeToCoordinate(t); return Number.isFinite(v) ? v : null; } catch (e) { return null; } };
      const Y = p => { try { const v = series.priceToCoordinate(p); return Number.isFinite(v) ? v : null; } catch (e) { return null; } };
      const tFin = api.current.lastTime;
      if (!Number.isFinite(tFin)) return;

      const zone = (t0, t1, p1, p2, fond, bord, etiquette) => {
        const x0 = X(t0), x1 = X(t1), y0 = Y(p1), y1 = Y(p2);
        if (x0 === null || x1 === null || y0 === null || y1 === null) return;
        const g = Math.min(x0, x1), d = Math.max(x0, x1);
        const ht = Math.min(y0, y1), bs = Math.max(y0, y1);
        if (d < 0 || g > w || bs < 0 || ht > h) return;
        const lg = Math.max(2, d - g), hh = Math.max(1.5, bs - ht);
        ctx.fillStyle = fond; ctx.fillRect(g, ht, lg, hh);
        if (bord) { ctx.strokeStyle = bord; ctx.lineWidth = 1; ctx.strokeRect(g + .5, ht + .5, lg - 1, hh - 1); }
        if (etiquette && hh > 11 && peutEtiqueter()) {
          ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
          ctx.fillStyle = bord || 'rgba(226,232,240,.75)';
          ctx.fillText(etiquette, g + 4, ht + 10);
          compte.labels++;
        }
      };

      const bande = (p1, p2, fond, bord, etiquette) => {
        const y0 = Y(p1), y1 = Y(p2);
        if (y0 === null || y1 === null) return;
        const ht = Math.min(y0, y1), bs = Math.max(y0, y1);
        if (bs < 0 || ht > h) return;
        ctx.fillStyle = fond; ctx.fillRect(0, ht, w, Math.max(1.5, bs - ht));
        if (bord) {
          ctx.strokeStyle = bord; ctx.setLineDash([5, 4]); ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(0, ht + .5); ctx.lineTo(w, ht + .5);
          ctx.moveTo(0, bs - .5); ctx.lineTo(w, bs - .5); ctx.stroke(); ctx.setLineDash([]);
        }
        if (etiquette && bs - ht > 12 && peutEtiqueter()) {
          ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
          ctx.fillStyle = bord || 'rgba(226,232,240,.7)';
          ctx.fillText(etiquette, 6, ht + 11);
          compte.labels++;
        }
      };

      // Order blocks : de leur bougie d'origine jusqu'à maintenant.
      for (const ob of (rep.orderBlocks || [])) {
        const t0 = Math.floor((ob.t || 0) / 1000);
        if (!t0 || !Number.isFinite(ob.low) || !Number.isFinite(ob.high)) continue;
        const haussier = /bull|haus/i.test(String(ob.type || ''));
        compte.ob++;
        zone(t0, tFin, ob.low, ob.high,
          haussier ? 'rgba(34,211,138,.10)' : 'rgba(242,84,91,.10)',
          haussier ? 'rgba(34,211,138,.42)' : 'rgba(242,84,91,.42)',
          'OB ' + (haussier ? 'haussier' : 'baissier'));
      }
      // Déséquilibres (FVG)
      for (const f of (rep.fvgs || [])) {
        const t0 = Math.floor((f.t || 0) / 1000);
        if (!t0 || !Number.isFinite(f.low) || !Number.isFinite(f.high)) continue;
        const haussier = /bull|haus/i.test(String(f.type || ''));
        compte.fvg++;
        zone(t0, tFin, f.low, f.high,
          haussier ? 'rgba(96,165,250,.10)' : 'rgba(251,191,36,.10)',
          haussier ? 'rgba(96,165,250,.40)' : 'rgba(251,191,36,.40)',
          'FVG ' + (haussier ? 'haussier' : 'baissier'));
      }
      // Premium / discount et zone d'entrée optimale : bandes de fond.
      const pd = rep.premiumDiscount;
      if (pd && Number.isFinite(pd.equilibrium) && Number.isFinite(pd.high) && Number.isFinite(pd.low)) {
        bande(pd.equilibrium, pd.high, 'rgba(242,84,91,.045)', 'rgba(242,84,91,.35)', 'PREMIUM');
        bande(pd.low, pd.equilibrium, 'rgba(34,211,138,.045)', 'rgba(34,211,138,.35)', 'DISCOUNT');
        if (pd.ote && Number.isFinite(pd.ote.deep) && Number.isFinite(pd.ote.shallow)) {
          bande(pd.ote.deep, pd.ote.shallow, 'rgba(245,158,11,.10)', 'rgba(245,158,11,.5)', 'OTE 0,618-0,786');
        }
      }
      // Liquidité : là où sont posés les stops.
      ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
      for (const l of (rep.liquidity || [])) {
        const y = Y(l.price);
        if (y === null || y < 0 || y > h) continue;
        ctx.strokeStyle = 'rgba(245,158,11,.55)';
        ctx.setLineDash([2, 4]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, y + .5); ctx.lineTo(w, y + .5); ctx.stroke();
        ctx.setLineDash([]);
        compte.liq++;
        if (peutEtiqueter()) {
          ctx.fillStyle = 'rgba(245,158,11,.9)';
          ctx.fillText((l.type || 'liquidite') + (l.touches ? ' (' + l.touches + ')' : ''), 6, y - 3);
          compte.labels++;
        }
      }
      // Balayages : l'extrême atteint est entouré.
      for (const s of (rep.sweeps || [])) {
        const x = X(Math.floor((s.at || 0) / 1000));
        const y = Y(s.extreme || s.level);
        if (x === null || y === null) continue;
        compte.sweep++;
        ctx.strokeStyle = 'rgba(167,139,250,.85)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.stroke();
      }

      // On ne declenche un rendu que si le compte change : redessiner au zoom ne
      // doit pas provoquer une cascade de rendus React.
      const cle = `${compte.ob}-${compte.fvg}-${compte.liq}-${compte.sweep}`;
      if (api.current.cleZones !== cle) {
        api.current.cleZones = cle;
        setZonesTracees(compte);
      }
    };

    api.current.dessiner = dessiner;
    dessiner();
    // Redessin à chaque déplacement, zoom ou redimensionnement : sans ces
    // abonnements les zones resteraient collées à leur position d'origine.
    let sub = null;
    try { sub = chart.timeScale().subscribeVisibleLogicalRangeChange(dessiner); } catch (e) {}
    const ro = new ResizeObserver(dessiner);
    ro.observe(cvs);
    const t1 = setTimeout(dessiner, 120);
    const t2 = setTimeout(dessiner, 700);
    return () => {
      clearTimeout(t1); clearTimeout(t2); ro.disconnect();
      try { if (sub) chart.timeScale().unsubscribeVisibleLogicalRangeChange(sub); } catch (e) {}
      api.current.dessiner = null;
    };
  }, [candles, report, levels]);

  const reset = () => { try { api.current.chart.timeScale().fitContent(); } catch (e) {} };

  return (
    <div className="chart-mobile" style={{ position: 'relative' }}>
      <div ref={boxRef} className="chart-mobile" style={{ width: '100%', height, borderRadius: 10, overflow: 'hidden' }} />
      {/* Calque de ZONES par-dessus les bougies : order blocks, FVG, premium /
          discount, OTE, liquidité. Lightweight Charts ne propose pas de
          rectangles — on dessine donc nous-mêmes, en convertissant le prix et le
          temps en pixels. Le calque suit le zoom et le déplacement. */}
      <canvas ref={overlayRef}
        style={{ position:'absolute', inset:0, width:'100%', height:'100%',
          pointerEvents:'none', borderRadius:10, zIndex:3 }} />
      {/* Preuve visible que le calque tourne : si ce compteur est absent, le
          navigateur affiche encore l'ancienne page (cache). S'il affiche 0
          partout, les données ne sont pas arrivées. */}
      {zonesTracees && (
        <div style={{ position:'absolute', left:10, bottom:8, zIndex:4, pointerEvents:'none',
          fontSize:11, color:'#94a3b8', background:'rgba(8,12,20,.78)',
          padding:'3px 9px', borderRadius:6, border:'1px solid rgba(148,163,184,.2)' }}>
          <i className="fas fa-layer-group" style={{ marginRight:6, color:'#60a5fa' }}></i>
          zones tracées : {zonesTracees.ob} OB · {zonesTracees.fvg} FVG ·
          {' '}{zonesTracees.liq} liquidité · {zonesTracees.sweep} balayage(s)
        </div>
      )}
      {libMissing && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 8, textAlign: 'center',
          background: 'rgba(8,12,20,.92)', borderRadius: 10, fontSize: 13, color: '#fbbf24' }}>
          <i className="fas fa-triangle-exclamation" style={{ fontSize: 20 }}></i>
          <b>Bibliothèque de graphique non chargée</b>
          <span style={{ color: 'var(--muted)', maxWidth: 380 }}>
            La page vient d'une version en cache. Rechargez-la en forçant :
            <b> Ctrl + Maj + R</b> (ou Ctrl + F5).
          </span>
        </div>
      )}
      <button className="btn ghost sm" onClick={reset} title="Revenir au prix actuel"
        style={{ position: 'absolute', top: 8, right: 92, zIndex: 5 }}>
        <i className="fas fa-crosshairs"></i>
      </button>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   TERMINAL 5TRADE — écran Direct
   3 niveaux, dans cet ordre : MARKET INTELLIGENCE → STRATEGY INTELLIGENCE
   → DECISION ENGINE. L'utilisateur lit d'abord la DÉCISION, puis les
   stratégies, puis les raisons.

   Règle absolue : aucun chiffre inventé. Tout vient du moteur (DecisionEngine,
   Signals, Playbooks, Preuves) ou est marqué « indisponible ».
   ══════════════════════════════════════════════════════════════════════════ */

// Palette sémantique unique du terminal (vert achat, rouge vente, ambre
// attente, gris inactif, bleu information). Aucune autre couleur.
const TT = {
  ok: '#10b981', bad: '#ef4444', warn: '#f59e0b', neu: '#94a3b8', info: '#3b82f6',
  okBg: 'rgba(16,185,129,.12)', badBg: 'rgba(239,68,68,.12)',
  warnBg: 'rgba(245,158,11,.12)', neuBg: 'rgba(148,163,184,.10)',
  infoBg: 'rgba(59,130,246,.12)', line: 'rgba(27,36,51,.85)'
};

const TT_TONE = {
  ok: { c: TT.ok, bg: TT.okBg }, bad: { c: TT.bad, bg: TT.badBg },
  warn: { c: TT.warn, bg: TT.warnBg }, neu: { c: TT.neu, bg: TT.neuBg },
  info: { c: TT.info, bg: TT.infoBg }
};

/** Prix : 5 décimales sous 1000 (FX), 2 au-dessus (indices, crypto). */
const ttFmt = p => {
  const n = Number(p);
  if (p === null || p === undefined || !Number.isFinite(n)) return '—';
  return n >= 1000
    ? n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : n.toFixed(5);
};

const ttHeure = t => {
  if (!t) return '—';
  try { return new Date(t).toLocaleTimeString('fr-FR'); } catch { return '—'; }
};

const ttAge = ms => {
  if (ms === null || ms === undefined) return '—';
  if (ms < 60000) return Math.round(ms / 1000) + ' s';
  if (ms < 3600000) return Math.round(ms / 60000) + ' min';
  return Math.round(ms / 3600000) + ' h';
};

function TtLabel({ children, style }) {
  return (
    <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.09em',
      textTransform: 'uppercase', color: 'var(--dim)', ...style }}>{children}</div>
  );
}

function TtPill({ tone = 'neu', children, title, style }) {
  const t = TT_TONE[tone] || TT_TONE.neu;
  return (
    <span title={title} style={{ display: 'inline-flex', alignItems: 'center', gap: 5,
      fontSize: 10.5, fontWeight: 700, letterSpacing: '.04em', padding: '3px 9px',
      borderRadius: 6, background: t.bg, color: t.c, whiteSpace: 'nowrap', ...style }}>
      {children}
    </span>
  );
}

// ── Indicateur de synchronisation ─────────────────────────────────────────
function LiveStatusIndicator({ live, offline, ticks, lastUpdate, onRefresh, busy }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <TtPill tone={live ? 'ok' : 'warn'}>
        <span className="dot-live" style={{ width: 6, height: 6 }}></span>
        {live ? 'EN DIRECT' : 'CONNEXION…'}
      </TtPill>
      {offline && <TtPill tone="warn" title="Réseau absent : bougies servies du cache local.">CACHE</TtPill>}
      {lastUpdate && (
        <span style={{ fontSize: 11, color: 'var(--dim)', fontVariantNumeric: 'tabular-nums' }}>
          {ticks} maj · {ttHeure(lastUpdate)}
        </span>
      )}
      <button className="btn ghost sm" onClick={onRefresh} disabled={busy}
        title="Recharger les données du marché" style={{ padding: '5px 9px' }}>
        <i className={`fas ${busy ? 'fa-spinner fa-spin' : 'fa-rotate'}`}></i>
      </button>
    </div>
  );
}

// ── NIVEAU 03 : Live Decision Center — l'état global, en un coup d'œil ────
function LiveDecisionCenter({ decision, sse, price, at, symbol, tf, providerLabel, confluence }) {
  // Le verdict vient du DecisionEngine (/api/decision) ; le flux SSE sert de
  // repli immédiat. Les deux sortent du MÊME moteur — jamais deux calculs.
  const src = decision || sse || null;
  // « confirmé » a DEUX sens dans ce dépôt et il ne faut pas les confondre :
  //   • le verdict du direct dit « les règles R1–R8 sont d'accord » ;
  //   • la décision dit « ce signal est exécutable après tous les filtres ».
  // Seule la seconde autorise le mot CONFIRMÉ. Mesuré au banc de divergence :
  // 4 séries sur 16 affichaient « confirmé » sans rien d'exécutable derrière.
  const vientDUneDecision = !!(src && src.decision);
  const refusRisque = !!(src && src.risque && src.risque.consulte && src.risque.ok === false);
  const etatBrut = (vientDUneDecision && refusRisque && src.decision === 'ATTENTE') ? 'ATTENTE_RISQUE'
    : vientDUneDecision ? src.decision
      : (src && src.status === 'confirme'
        ? (src.direction === 'BUY' ? 'ACHAT_REGLES' : 'VENTE_REGLES') : null);

  const ETATS = {
    ACHAT:    { label: 'ACHAT CONFIRMÉ', tone: 'ok',   ico: 'fa-arrow-trend-up',
      sous: 'Signal d\'achat validé par toutes les règles obligatoires.' },
    VENTE:    { label: 'VENTE CONFIRMÉE', tone: 'bad', ico: 'fa-arrow-trend-down',
      sous: 'Signal de vente validé par toutes les règles obligatoires.' },
    // Accord des règles SEUL : ce n'est pas une entrée, et le dire autrement est
    // la faute la plus coûteuse qu'un terminal puisse commettre.
    ACHAT_REGLES: { label: 'RÈGLES ALIGNÉES — ACHAT', tone: 'warn', ico: 'fa-circle-check',
      sous: 'Les règles d\'achat sont d\'accord. Ce n\'est pas une entrée exécutable : l\'arbitrage n\'a pas conclu.' },
    VENTE_REGLES: { label: 'RÈGLES ALIGNÉES — VENTE', tone: 'warn', ico: 'fa-circle-check',
      sous: 'Les règles de vente sont d\'accord. Ce n\'est pas une entrée exécutable : l\'arbitrage n\'a pas conclu.' },
    ATTENTE:  { label: 'ATTENTE', tone: 'warn', ico: 'fa-hourglass-half',
      sous: 'Signaux contradictoires : le moteur n\'arbitre pas à ta place.' },
    // Le setup est bon, le COMPTE ne suit pas. Ce n'est pas la même chose qu'une
    // attente technique, et les confondre ferait chercher la cause au mauvais endroit.
    ATTENTE_RISQUE: { label: 'ATTENTE — RISQUE REFUSÉ', tone: 'bad', ico: 'fa-shield-halved',
      sous: 'Le setup est valide, mais les plafonds du compte interdisent cette prise.' },
    NO_TRADE: { label: 'NO TRADE', tone: 'neu', ico: 'fa-ban',
      sous: 'Aucun signal exécutable après tous les filtres.' }
  };
  const etat = ETATS[etatBrut] || { label: 'ANALYSE…', tone: 'info', ico: 'fa-satellite-dish',
    sous: 'Le moteur évalue le marché…' };
  const tone = TT_TONE[etat.tone];

  // Métriques — uniquement quand le moteur les fournit réellement.
  const conf = confluence && confluence.confluence ? confluence.confluence : null;
  const trace = src && src.trace ? src.trace : null;
  const nbUnites = conf && Array.isArray(conf.detail) ? conf.detail.length : null;
  const biais = (src && src.biais) || (trace && trace.arbitrage && trace.arbitrage.biais) || null;
  const validation = trace && trace.validation ? trace.validation : null;
  const detection = trace && trace.detection ? trace.detection : null;
  const execution = trace && trace.execution ? trace.execution : null;

  // Aucun « undefined » à l'écran : on lit le compteur du moteur s'il existe,
  // sinon on recompte `details`, sinon on affiche « — ».
  const nb = x => (Number.isFinite(x) ? x : null);
  const compte = (niveau, champ, total) => {
    const n = nb(niveau && niveau[champ]);
    const t = nb(niveau && niveau.total) ?? nb(total);
    return (n === null || t === null) ? '—' : `${n} / ${t}`;
  };
  const metres = [
    { k: 'Biais directionnel', v: biais
        ? biais.toUpperCase()
        : '—',
      tone: biais === 'haussier' ? 'ok' : biais === 'baissier' ? 'bad'
        : biais === 'partagé' ? 'warn' : 'neu' },
    { k: 'Confirmation MTF',
      v: conf ? `${conf.nbAlignes} / ${nbUnites || '—'} unités`
        : compte(trace && trace.confirmation, 'confirmes', detection ? (detection.details || []).length : null),
      tone: conf ? (conf.aligne ? 'ok' : 'warn') : 'neu' },
    { k: 'Conditions validées',
      v: compte(validation, 'valides', detection ? (detection.details || []).length : null),
      tone: validation && validation.bloques > 0 ? 'warn' : validation ? 'ok' : 'neu' },
    { k: 'Entrée exécutable',
      v: execution ? (execution.executables > 0 ? 'OUI' : 'NON') : '—',
      tone: execution ? (execution.executables > 0 ? 'ok' : 'neu') : 'neu' }
  ];

  return (
    <div className="panel" style={{ padding: 0, marginBottom: 12, overflow: 'hidden',
      borderColor: tone.c + '66' }}>
      {/* Bandeau d'état */}
      <div style={{ padding: '16px 18px', background: tone.bg,
        borderBottom: `1px solid ${tone.c}33` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <TtLabel style={{ color: tone.c, margin: 0 }}>Décision du moteur</TtLabel>
          <span style={{ flex: '1 1 auto' }}></span>
          <span style={{ fontSize: 11, color: 'var(--dim)' }}>
            {providerLabel || symbol} · {tf}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 6, flexWrap: 'wrap' }}>
          <i className={`fas ${etat.ico}`} style={{ fontSize: 30, color: tone.c }}></i>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 26, fontWeight: 900, letterSpacing: '-.02em',
              color: tone.c, lineHeight: 1.1 }}>{etat.label}</div>
            <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3, lineHeight: 1.5 }}>
              {(src && src.raison) || etat.sous}
            </div>
            {/* État du garde-fou de compte, TOUJOURS dit : « non vérifié » n'est pas
                « validé ». C'est la différence entre un terminal et un guichet. */}
            {src && src.risque && (
              <div style={{ fontSize: 11.5, marginTop: 5, lineHeight: 1.45,
                color: src.risque.ok === false ? '#fca5a5' : src.risque.consulte ? '#6ee7b7' : 'var(--dim)' }}>
                <i className={`fas ${src.risque.ok === false ? 'fa-shield-halved'
                  : src.risque.consulte ? 'fa-check-double' : 'fa-circle-question'}`}
                  style={{ marginRight: 6 }}></i>
                {src.risque.ok === false
                  ? <>Risque : refusé — {(src.risque.refus || []).join(' · ')}</>
                  : src.risque.consulte
                    ? <>Risque : plafonds du compte respectés pour cette prise</>
                    : <>Risque : <b>non vérifié</b> — {src.risque.motif || "aucun état de compte n'a été fourni à la décision"}</>}
              </div>
            )}
          </div>
          <span style={{ flex: '1 1 auto' }}></span>
          <div style={{ textAlign: 'right' }}>
            <TtLabel>Prix actuel</TtLabel>
            <div style={{ fontSize: 28, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
              letterSpacing: '-.02em', color: '#fff' }}>{ttFmt(price)}</div>
            {at && <div style={{ fontSize: 10.5, color: 'var(--dim)' }}>{ttHeure(at)}</div>}
          </div>
        </div>
      </div>

      {/* Métriques */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(135px,1fr))' }}>
        {metres.map((m, i) => {
          const t = TT_TONE[m.tone] || TT_TONE.neu;
          return (
            <div key={m.k} style={{ padding: '11px 14px',
              borderTop: '1px solid ' + TT.line,
              borderRight: i < metres.length - 1 ? '1px solid ' + TT.line : 'none' }}>
              <TtLabel>{m.k}</TtLabel>
              <div style={{ fontSize: 16, fontWeight: 800, marginTop: 3, color: t.c,
                fontVariantNumeric: 'tabular-nums' }}>{m.v}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Trade Setup — seulement quand les niveaux sont réellement calculables ──
/* Compteur d'attente : une analyse prend 6 à 20 s (alignement multi-unités +
   décision). Un spinner muet laisse croire à un blocage ; un compteur montre
   que ça avance. */
function TempsAnalyse({ depuis }) {
  const [s, setS] = React.useState(0);
  React.useEffect(() => {
    const t = setInterval(() => setS(Math.round((Date.now() - (depuis || Date.now())) / 1000)), 1000);
    return () => clearInterval(t);
  }, [depuis]);
  return <span style={{ fontVariantNumeric: 'tabular-nums' }}> ({s} s)</span>;
}

function TradeSetupCard({ signal, decision, sens, onToJournal, symbol, tf, provider, providerLabel }) {
  const lv = signal && signal.levels ? signal.levels : null;
  const ok = lv && Number.isFinite(Number(lv.entry)) && Number.isFinite(Number(lv.stop));
  if (!ok) {
    // Deux situations différentes, deux messages différents : « le moteur
    // cherche encore » n'est pas « le moteur a conclu qu'il n'y a rien ».
    // Les confondre affichait un verdict pendant l'analyse.
    // « En cours » veut dire : le moteur n'a pas encore répondu. Si le moteur a
    // répondu NO_TRADE, ce n'est PAS en cours — c'est une conclusion, et elle a
    // une raison. Annoncer « analyse en cours » dans ce cas laissait l'écran
    // tourner indéfiniment sur une analyse terminée.
    // Le repli SSE porte la même information : sans lui, la bande affichait
    // NO TRADE (via le flux) pendant que cette carte affichait « analyse en
    // cours » (via la requête REST pas encore revenue).
    const enCours = !decision;
    const motifMoteur = decision
      ? (signal && signal.levels ? null : (decision.raison || decision.decision || 'aucun setup exécutable'))
      : null;
    return (
      <div className="panel" style={{ padding: '11px 14px', marginBottom: 12,
        borderColor: 'rgba(148,163,184,.3)' }}>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          <i className={`fas ${enCours ? 'fa-spinner fa-spin' : 'fa-circle-info'}`}
            style={{ marginRight: 7, color: TT.neu }}></i>
          {enCours
            ? <React.Fragment>
                Analyse du marché en cours : les niveaux ne sont pas encore calculés.
                <TempsAnalyse depuis={window.__debutAnalyse} />
              </React.Fragment>
            : <>Aucun setup exécutable — {motifMoteur}. Le moteur ne publie pas de trade qu'il ne peut pas chiffrer.</>}
        </div>
      </div>
    );
  }
  const achat = (signal.sens === 'long') || sens === 'BUY';
  const col = achat ? TT.ok : TT.bad;
  const risque = Math.abs(Number(lv.entry) - Number(lv.stop));
  const rr = Number.isFinite(Number(signal.rr)) && Number(signal.rr) > 0
    ? Number(signal.rr)
    : (Number.isFinite(Number(lv.target1)) && risque > 0
      ? Math.abs(Number(lv.target1) - Number(lv.entry)) / risque : null);

  const ligne = (k, v, c) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10,
      padding: '5px 0', borderBottom: '1px solid ' + TT.line }}>
      <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{k}</span>
      <b style={{ fontSize: 12.5, color: c || '#e2e8f0', fontVariantNumeric: 'tabular-nums' }}>{v}</b>
    </div>
  );

  return (
    <div className="panel" style={{ padding: '13px 15px', marginBottom: 12, borderColor: col + '55' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <i className="fas fa-crosshairs" style={{ color: col }}></i>
        <b style={{ fontSize: 13 }}>Setup de trade</b>
        <TtPill tone={achat ? 'ok' : 'bad'}>{achat ? 'ACHAT' : 'VENTE'}</TtPill>
        {signal.nom && <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{signal.nom}</span>}
        <span style={{ flex: '1 1 auto' }}></span>
        {onToJournal && (
          <button className="btn ghost sm" style={{ padding: '5px 9px' }}
            onClick={() => onToJournal({
              pair: symbol, direction: achat ? 'BUY' : 'SELL',
              entry: Number(lv.entry), sl: Number(lv.stop),
              tp: Number.isFinite(Number(lv.target1)) ? Number(lv.target1) : null,
              timeframe: tf, provider, providerLabel,
              signalStatus: 'confirme', signalStrength: signal.force,
              notes: `Setup ${achat ? 'achat' : 'vente'} — ${signal.nom || 'moteur'}`
            })}
            title="Ouvrir le journal avec ce setup pré-rempli">
            <i className="fas fa-floppy-disk"></i>Journal
          </button>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: '0 18px' }}>
        <div>
          {ligne('Entrée', ttFmt(lv.entry))}
          {ligne('Invalidation', ttFmt(lv.stop), TT.bad)}
        </div>
        <div>
          {ligne('Objectif 1', ttFmt(lv.target1), TT.ok)}
          {ligne('Objectif 2', ttFmt(lv.target2), TT.ok)}
        </div>
        <div>
          {ligne('Risque / Rendement', rr ? rr.toFixed(2) : '—', rr ? '#e2e8f0' : 'var(--dim)')}
          {ligne('R attendu (modèle)',
            signal.modele && Number.isFinite(signal.modele.rAttendu)
              ? `${signal.modele.rAttendu > 0 ? '+' : ''}${signal.modele.rAttendu} R`
              : 'non couvert',
            signal.modele && Number.isFinite(signal.modele.rAttendu) && signal.modele.rAttendu > 0 ? TT.ok : 'var(--dim)')}
        </div>
      </div>
      <p style={{ margin: '8px 0 0', fontSize: 10.5, color: 'var(--dim)' }}>
        Obj 3 non affiché : le moteur ne le calcule pas. Aucun niveau n'est estimé.
      </p>
    </div>
  );
}

// ── Condition Tracker : ✓ REMPLIE / ◷ EN ATTENTE / ✕ MANQUANTE ────────────
function ConditionChecklist({ items }) {
  if (!items || !items.length) {
    return <div style={{ fontSize: 11.5, color: 'var(--dim)' }}>
      Aucune condition détaillée disponible pour cette stratégie.
    </div>;
  }
  const etat = it => {
    if (it.ok === true) return { ico: 'fa-check', tone: 'ok', label: 'REMPLIE' };
    if (it.ok === false) return { ico: 'fa-xmark', tone: 'bad', label: 'MANQUANTE' };
    return { ico: 'fa-clock', tone: 'warn', label: 'EN ATTENTE' };
  };
  return (
    <div style={{ display: 'grid', gap: 5 }}>
      {items.map((it, i) => {
        const e = etat(it);
        const t = TT_TONE[e.tone];
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8,
            padding: '5px 8px', borderRadius: 6, background: 'rgba(148,163,184,.045)' }}>
            <i className={`fas ${e.ico}`} style={{ color: t.c, fontSize: 10, marginTop: 3, width: 10 }}></i>
            <span style={{ flex: 1, fontSize: 12, color: '#dbe4f0' }}>
              {it.nom}
              {it.valeur !== undefined && it.valeur !== null && String(it.valeur) !== '' && (
                <span style={{ color: 'var(--muted)' }}> = {String(it.valeur)}</span>
              )}
              {it.seuil ? <span style={{ color: 'var(--dim)' }}> (seuil {String(it.seuil)})</span> : null}
              {it.detail && <span style={{ color: 'var(--dim)' }}> — {it.detail}</span>}
            </span>
            <span style={{ fontSize: 9.5, fontWeight: 700, color: t.c, whiteSpace: 'nowrap' }}>{e.label}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Strategy Card : une stratégie = un état lisible + conditions repliables ─
function StrategyCard({ nom, categorie, etat, direction, conditionsOk, conditionsTotal,
  etape, prochaine, at, conditions, defautOuvert }) {
  const ETATS = {
    VALIDEE:  { label: 'VALIDÉE', tone: 'ok', ico: 'fa-circle-check' },
    ACTIVE:   { label: 'ACTIVE', tone: 'info', ico: 'fa-satellite-dish' },
    ATTENTE:  { label: 'EN ATTENTE', tone: 'warn', ico: 'fa-clock' },
    BLOQUEE:  { label: 'BLOQUÉE', tone: 'bad', ico: 'fa-circle-xmark' },
    INACTIVE: { label: 'INACTIVE', tone: 'neu', ico: 'fa-circle-minus' },
    EXPIREE:  { label: 'EXPIRÉE', tone: 'neu', ico: 'fa-hourglass-end' }
  };
  const e = ETATS[etat] || ETATS.INACTIVE;
  const t = TT_TONE[e.tone];
  const sensCol = direction === 'BUY' || direction === 'long' ? TT.ok
    : direction === 'SELL' || direction === 'short' ? TT.bad : TT.neu;
  const sensLab = direction === 'BUY' || direction === 'long' ? 'ACHAT'
    : direction === 'SELL' || direction === 'short' ? 'VENTE' : 'NEUTRE';

  return (
    <details open={!!defautOuvert} style={{ border: `1px solid ${t.c}33`, borderRadius: 10,
      background: 'rgba(148,163,184,.03)', overflow: 'hidden' }}>
      <summary style={{ cursor: 'pointer', padding: '9px 11px', listStyle: 'none',
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <i className={`fas ${e.ico}`} style={{ color: t.c, fontSize: 12 }}></i>
        <b style={{ fontSize: 12.5, color: '#e8eef7' }}>{nom}</b>
        <TtPill tone={e.tone}>{e.label}</TtPill>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: sensCol }}>{sensLab}</span>
        {conditionsTotal > 0 && (
          <span style={{ fontSize: 11, color: 'var(--dim)', fontVariantNumeric: 'tabular-nums' }}>
            {conditionsOk}/{conditionsTotal} conditions
          </span>
        )}
        {categorie && <span style={{ fontSize: 10.5, color: 'var(--dim)' }}>· {categorie}</span>}
        <span style={{ flex: '1 1 auto' }}></span>
        {at && <span style={{ fontSize: 10, color: 'var(--dim)' }}>{ttAge(at)}</span>}
      </summary>
      <div style={{ padding: '0 11px 11px' }}>
        {etape && (
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 6 }}>
            <i className="fas fa-route" style={{ marginRight: 6, color: TT.info, fontSize: 10 }}></i>
            {etape}
          </div>
        )}
        {prochaine && (
          <div style={{ fontSize: 11.5, color: TT.warn, marginBottom: 7 }}>
            <i className="fas fa-arrow-right" style={{ marginRight: 6, fontSize: 9 }}></i>
            Pour avancer : {prochaine}
          </div>
        )}
        <ConditionChecklist items={conditions} />
      </div>
    </details>
  );
}

// ── NIVEAU 02 : Strategy Monitor ─────────────────────────────────────────
function StrategyMonitor({ playbooks, signaux, statuts, filtre, setFiltre, typeTrade, setTypeTrade }) {
  const FILTRES = [
    ['all', 'Toutes'], ['BUY', 'Achat'], ['SELL', 'Vente'],
    ['validated', 'Validées'], ['waiting', 'En attente'], ['blocked', 'Bloquées'],
    ['scalping', 'Scalping'], ['intraday', 'Intraday'], ['swing', 'Swing']
  ];

  // 1. Types de trade (playbooks) — la lecture « métier » de l'avancement.
  const pbs = (playbooks || []).map(pb => {
    const etat = pb.pret ? 'VALIDEE'
      : (pb.prerequisOk < pb.prerequisTotal ? 'BLOQUEE' : 'ATTENTE');
    const conditions = [
      ...(pb.prerequis || []).map(p => ({ nom: p.label, ok: p.ok === true, detail: p.detail })),
      ...(pb.etapes || []).map(e => ({
        nom: `Étape ${e.numero} — ${e.label}`,
        ok: e.ok === null || e.ok === undefined ? null : e.ok === true,
        detail: e.detail
      }))
    ];
    return {
      cle: 'pb:' + pb.type, nom: pb.nom, categorie: 'Type de trade', type: pb.type,
      etat, direction: null,
      conditionsOk: conditions.filter(c => c.ok === true).length,
      conditionsTotal: conditions.length,
      etape: `${pb.avancement} · ${pb.duree} · ${(pb.timeframes || []).join('/')}`,
      prochaine: pb.pret ? null : (pb.blocage || null),
      conditions, at: null, defautOuvert: pb.pret
    };
  });

  // 2. Signaux par stratégie/motif du moteur (arbitrage réel).
  const sigs = (signaux || []).map((s, i) => ({
    cle: 'sig:' + (s.id || i), nom: s.nom || s.id || 'Signal',
    categorie: s.source === 'strategie' ? 'Stratégie' : s.source === 'structure' ? 'Structure' : 'Motif',
    etat: s.status === 'confirme' ? 'VALIDEE' : s.status === 'surveiller' ? 'ATTENTE' : 'BLOQUEE',
    direction: s.sens, conditionsOk: (s.conditions || []).filter(c => c.ok).length,
    conditionsTotal: (s.conditions || []).length,
    etape: `force ${Number(s.force || 0).toFixed(2)}/1`,
    prochaine: s.raison || null,
    conditions: (s.conditions || []).map(c => ({ nom: c.nom, valeur: c.valeur, seuil: c.seuil, ok: c.ok })),
    at: null, defautOuvert: false
  }));

  // 3. Évaluations persistées (toutes les stratégies suivies).
  const evals = (statuts || []).map((s, i) => ({
    cle: 'ev:' + i, nom: s.strategie + (s.version ? ` v${s.version}` : ''),
    categorie: `${s.symbole || ''} ${s.timeframe || ''}`.trim(),
    etat: s.statut === 'VALID' ? 'VALIDEE' : s.statut === 'WAITING' ? 'ATTENTE'
      : s.statut === 'INVALID' ? 'BLOQUEE' : 'INACTIVE',
    direction: s.direction,
    conditionsOk: s.conditionRemplies, conditionsTotal: s.conditionTotal,
    etape: s.score !== null && s.score !== undefined ? `score ${Number(s.score).toFixed(2)}` : null,
    prochaine: (s.obligatoiresManquantes || []).length
      ? `manque : ${s.obligatoiresManquantes.join(', ')}` : null,
    conditions: (s.obligatoiresManquantes || []).map(nom => ({ nom, ok: false })),
    at: s.ageMs, defautOuvert: false
  }));

  let tous = [...pbs, ...sigs, ...evals];

  // Filtres
  if (filtre === 'validated') tous = tous.filter(x => x.etat === 'VALIDEE');
  else if (filtre === 'waiting') tous = tous.filter(x => x.etat === 'ATTENTE');
  else if (filtre === 'blocked') tous = tous.filter(x => x.etat === 'BLOQUEE');
  else if (filtre === 'BUY') tous = tous.filter(x => x.direction === 'BUY' || x.direction === 'long');
  else if (filtre === 'SELL') tous = tous.filter(x => x.direction === 'SELL' || x.direction === 'short');
  else if (['scalping', 'intraday', 'swing'].includes(filtre)) {
    tous = tous.filter(x => x.type === filtre || (x.cle.startsWith('pb:') && x.type === filtre));
  }
  if (typeTrade !== 'auto') tous = tous.filter(x => x.type === typeTrade);

  // Compteurs réels
  const compte = etat => tous.filter(x => x.etat === etat).length;
  const nbValides = compte('VALIDEE'), nbAttente = compte('ATTENTE'), nbBloquees = compte('BLOQUEE');
  const nbStrategies = new Set((statuts || []).map(s => s.strategie)).size;

  return (
    <div className="panel" style={{ padding: '13px 15px', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap', marginBottom: 10 }}>
        <i className="fas fa-layer-group" style={{ color: TT.info }}></i>
        <b style={{ fontSize: 13 }}>État des stratégies</b>
        <TtPill tone="ok">{nbValides} validée{nbValides > 1 ? 's' : ''}</TtPill>
        <TtPill tone="warn">{nbAttente} en attente</TtPill>
        <TtPill tone="bad">{nbBloquees} bloquée{nbBloquees > 1 ? 's' : ''}</TtPill>
        {nbStrategies > 0 && (
          <span style={{ fontSize: 10.5, color: 'var(--dim)' }}>
            {nbStrategies} stratégie(s) évaluée(s)
          </span>
        )}
        <span style={{ flex: '1 1 auto' }}></span>
        <select className="fld" aria-label="Filtrer les stratégies"
          style={{ width: 'auto', margin: 0, padding: '4px 8px', fontSize: 11.5 }}
          value={typeTrade} onChange={e => setTypeTrade(e.target.value)}>
          <option value="auto">Tous les types</option>
          {(playbooks || []).map(pb => <option key={pb.type} value={pb.type}>{pb.nom}</option>)}
        </select>
      </div>

      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 10 }}>
        {FILTRES.map(([k, lab]) => (
          <button key={k} onClick={() => setFiltre(k)}
            style={{ fontSize: 11, fontWeight: 600, padding: '4px 9px', borderRadius: 999,
              cursor: 'pointer', fontFamily: 'inherit',
              border: `1px solid ${filtre === k ? TT.info + '88' : 'var(--border)'}`,
              background: filtre === k ? TT.infoBg : 'transparent',
              color: filtre === k ? '#93c5fd' : 'var(--muted)' }}>{lab}</button>
        ))}
      </div>

      <TtLabel style={{ marginBottom: 6 }}>Cheminement du signal & stratégies en cours</TtLabel>
      {tous.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--muted)', padding: '8px 10px',
          borderRadius: 8, background: 'rgba(148,163,184,.05)' }}>
          <i className="fas fa-circle-minus" style={{ marginRight: 7 }}></i>
          Aucune stratégie ne correspond à ce filtre. Le moteur n'en invente pas.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 7 }}>
          {tous.map(x => (
            <StrategyCard key={x.cle} nom={x.nom} categorie={x.categorie} etat={x.etat}
              direction={x.direction} conditionsOk={x.conditionsOk} conditionsTotal={x.conditionsTotal}
              etape={x.etape} prochaine={x.prochaine} at={x.at} conditions={x.conditions}
              defautOuvert={x.defautOuvert} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Matrice multi-timeframes ─────────────────────────────────────────────
function MultiTimeframeMatrix({ confluence }) {
  if (!confluence || !confluence.confluence) {
    return (
      <div className="panel" style={{ padding: '11px 14px', marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          <i className="fas fa-crosshairs" style={{ marginRight: 7, color: TT.neu }}></i>
          Alignement multi-timeframes indisponible (historique insuffisant sur les unités supérieures).
        </div>
      </div>
    );
  }
  const c = confluence.confluence;
  const detail = (c.detail || []);
  const parTF = new Map((confluence.parTimeframe || []).map(x => [x.tf, x]));
  const tendCol = t => t === 'bullish' ? TT.ok : t === 'bearish' ? TT.bad : TT.warn;
  const tendLab = t => t === 'bullish' ? 'HAUSSIER' : t === 'bearish' ? 'BAISSIER' : 'RANGE';

  return (
    <div className="panel" style={{ padding: '13px 15px', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap', marginBottom: 9 }}>
        <i className="fas fa-crosshairs" style={{ color: TT.warn }}></i>
        <b style={{ fontSize: 13 }}>Alignement multi-timeframes</b>
        <TtPill tone={c.aligne ? 'ok' : 'warn'}>
          {c.aligne ? 'ALIGNÉ' : 'NON ALIGNÉ'} · {c.nbAlignes}/{detail.length}
        </TtPill>
        <span style={{ fontSize: 10.5, color: 'var(--dim)' }}>
          seuil {c.seuilAlignes} unité(s)
        </span>
      </div>

      {/* Progression d'alignement. La barre pousse par `transform: scaleX` :
          animer `width` recalculerait la mise en page à chaque image. */}
      <div
        className="m-bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={detail.length || 1}
        aria-valuenow={c.nbAlignes}
        aria-label={`Alignement ${c.nbAlignes} sur ${detail.length || 0} unités de temps`}
        style={{ height: 4, marginBottom: 10 }}
      >
        <span
          className="m-bar__fill"
          data-animate="in"
          style={{
            '--m-value': detail.length ? c.nbAlignes / detail.length : 0,
            background: c.aligne ? TT.ok : TT.warn,
          }}
        ></span>
      </div>

      <div className="m-list" style={{ display: 'flex', gap: 5, overflowX: 'auto', paddingBottom: 4 }}>
        {detail.map(t => {
          const info = parTF.get(t.tf) || {};
          const col = tendCol(t.tendance);
          return (
            <div key={t.tf} style={{ minWidth: 74, flex: '1 0 auto', textAlign: 'center',
              padding: '7px 6px', borderRadius: 8,
              border: `1px solid ${t.confirme ? col + '77' : 'var(--border)'}`,
              background: t.confirme ? col + '14' : 'rgba(148,163,184,.04)' }}>
              <div style={{ fontSize: 11.5, fontWeight: 800, color: '#e8eef7' }}>{t.tf}</div>
              <div style={{ fontSize: 9.5, fontWeight: 700, color: col, marginTop: 2 }}>
                {tendLab(t.tendance)}
              </div>
              <div style={{ fontSize: 9.5, color: 'var(--dim)', marginTop: 1 }}>
                {info.direction && info.direction !== 'NEUTRE' ? info.direction : '—'}
              </div>
              <i className={`fas ${t.confirme ? 'fa-circle-check' : 'fa-circle-minus'}`}
                style={{ fontSize: 9, color: t.confirme ? TT.ok : TT.neu, marginTop: 3 }}></i>
            </div>
          );
        })}
      </div>
      {c.motif && <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--dim)' }}>{c.motif}</p>}
      {c.contreTendance && (
        <p style={{ margin: '4px 0 0', fontSize: 11, color: TT.bad }}>
          <i className="fas fa-triangle-exclamation" style={{ marginRight: 5 }}></i>
          Contre-tendance détectée : le signal va contre une unité supérieure.
        </p>
      )}
    </div>
  );
}

// ── Signal Explanation — les 4 couches, séparées ─────────────────────────
function SignalExplanation({ trace, decision, signal }) {
  if (!trace && !signal) {
    return (
      <div className="panel" style={{ padding: '11px 14px', marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          Explication indisponible : le moteur n'a pas encore arbitré ce marché.
        </div>
      </div>
    );
  }
  const couches = trace ? [
    { n: '1', k: 'Biais du marché', v: trace.arbitrage ? trace.arbitrage.biais : null, o: trace.detection },
    { n: '2', k: 'Validation stratégie', v: trace.validation && trace.validation.resume, o: trace.validation },
    { n: '3', k: 'Confirmation d\'entrée', v: trace.confirmation && trace.confirmation.resume, o: trace.confirmation },
    { n: '4', k: 'Éligibilité d\'exécution', v: trace.execution && trace.execution.resume, o: trace.execution }
  ] : [];
  // Premier blocage réel, tous niveaux confondus.
  let blocage = null;
  if (trace) {
    for (const niveau of ['validation', 'confirmation', 'execution']) {
      const t = trace[niveau];
      if (!t || !Array.isArray(t.details)) continue;
      const d = t.details.find(x => x.ok === false && x.blocages && x.blocages.length);
      if (d) { blocage = `${d.nom} — ${d.blocages[0]}`; break; }
    }
  }

  return (
    <div className="panel" style={{ padding: '13px 15px', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 9 }}>
        <i className="fas fa-circle-question" style={{ color: TT.info }}></i>
        <b style={{ fontSize: 13 }}>Pourquoi cette décision</b>
      </div>
      <div style={{ display: 'grid', gap: 6 }}>
        {couches.map(c => {
          const ok = c.o && c.o.ok === true;
          const tone = !c.o ? 'neu' : ok ? 'ok' : 'warn';
          const t = TT_TONE[tone];
          return (
            <div key={c.k} style={{ display: 'flex', gap: 9, alignItems: 'baseline',
              fontSize: 12, padding: '5px 8px', borderRadius: 6, background: t.bg }}>
              <span style={{ fontSize: 9.5, fontWeight: 800, color: t.c, minWidth: 12 }}>{c.n}</span>
              <b style={{ color: t.c, minWidth: 150 }}>{c.k}</b>
              <span style={{ flex: 1, color: 'var(--muted)' }}>
                {c.v || (c.o ? c.o.resume : 'non évalué')}
              </span>
              <i className={`fas ${ok ? 'fa-check' : c.o ? 'fa-xmark' : 'fa-minus'}`}
                style={{ color: t.c, fontSize: 10 }}></i>
            </div>
          );
        })}
      </div>
      {blocage && (
        <div style={{ marginTop: 8, padding: '7px 10px', borderRadius: 7,
          background: TT.badBg, border: '1px solid ' + TT.bad + '44', fontSize: 11.5, color: '#fca5a5' }}>
          <i className="fas fa-lock" style={{ marginRight: 7 }}></i>
          Ce qui bloque : {blocage}
        </div>
      )}
      {decision && decision.raison && (
        <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--dim)' }}>
          Arbitrage : {decision.raison}
        </p>
      )}
      {signal && (
        <div style={{ marginTop: 9, paddingTop: 8, borderTop: '1px solid ' + TT.line,
          fontSize: 11.5, color: 'var(--muted)', display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600, color: '#dbe4f0' }}>Détail du verdict</span>
          <span>
            {signal.confirmations}/{(signal.reglesEvaluees || signal.reglesActives || []).length || signal.confirmations} règle(s) d'accord
          </span>
          <span title={signal.forceDetail ? signal.forceDetail.lecture
            : 'Score interne du moteur — ce n\'est pas un taux de réussite.'}>
            {' · '}force {signal.forceNiveau || '—'}
            {' '}<span style={{ color: 'var(--dim)' }}>({Number(signal.strength || 0).toFixed(2)}/1)</span>
          </span>
          {signal.trend ? <span>{' · '}tendance {signal.trend}</span> : null}
          {(signal.reglesSansAvis || []).length > 0 && (
            <span title={(signal.reglesLecture || '') +
              ' — une règle sans avis n\'est ni d\'accord ni contre : elle n\'a rien trouvé sur ce graphique.'}
              style={{ color: 'var(--dim)' }}>
              {' · '}{signal.reglesSansAvis.length} sans avis ({signal.reglesSansAvis.join(', ')})
            </span>
          )}
          {(signal.reglesOpposees || []).length > 0 && (
            <span style={{ color: TT.bad }}>
              {' · '}{signal.reglesOpposees.length} contre ({signal.reglesOpposees.join(', ')})
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ── NIVEAU 01 : Market Intelligence (structure du marché) ────────────────
function MarketStructurePanel({ carte, report }) {
  if (!carte) return null;
  const tendCol = carte.tendance === 'bullish' ? TT.ok
    : carte.tendance === 'bearish' ? TT.bad : TT.warn;
  const tendLab = carte.tendance === 'bullish' ? 'HAUSSIÈRE'
    : carte.tendance === 'bearish' ? 'BAISSIÈRE' : 'RANGE';
  const liq = (carte.liquidite || []).slice()
    .sort((a, b) => (a.distanceAtr ?? 99) - (b.distanceAtr ?? 99))[0];
  const z = carte.zoneLaPlusProche;
  const ev = carte.evenement;
  const pos = carte.position;

  const cell = (label, valeur, couleur) => (
    <div style={{ minWidth: 118 }}>
      <TtLabel>{label}</TtLabel>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: couleur || '#e2e8f0', marginTop: 2 }}>
        {valeur}
      </div>
    </div>
  );

  return (
    <div className="panel" style={{ padding: '13px 15px', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap', marginBottom: 10 }}>
        <span style={{ fontSize: 9.5, fontWeight: 800, color: TT.info, letterSpacing: '.08em' }}>01</span>
        <i className="fas fa-sitemap" style={{ color: TT.info }}></i>
        <b style={{ fontSize: 13 }}>Intelligence de marché</b>
        {carte.session && carte.session.killZone && carte.session.killZone !== 'aucune en ce moment' && (
          <TtPill tone="warn">kill zone {carte.session.killZone}</TtPill>
        )}
      </div>
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        {cell('Tendance', tendLab, tendCol)}
        {ev ? cell('Dernière cassure', `${ev.type} @ ${ttFmt(ev.niveau)}`,
          ev.sens === 'long' ? TT.ok : TT.bad)
          : cell('Dernière cassure', 'aucune (range)', 'var(--muted)')}
        {pos ? cell('Position', `${pos.zone}`, pos.zone === 'premium' ? TT.bad : TT.ok) : null}
        {z ? cell('Zone la plus proche', `${z.type} · ${z.distanceAtr} ATR`, '#93c5fd') : null}
        {liq ? cell('Liquidité', `${liq.type} ${ttFmt(liq.prix)}`, TT.warn) : null}
        {Number.isFinite(carte.atr) ? cell('ATR', ttFmt(carte.atr), 'var(--muted)') : null}
        {carte.session ? cell('Session', carte.session.courante || '—', 'var(--muted)') : null}
      </div>

      {report && (
        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: 'pointer', fontSize: 11.5, color: 'var(--muted)' }}>
            Détail technique (Fibonacci, niveaux, inventaire)
          </summary>
          <div style={{ display: 'grid', gap: 8, marginTop: 8, fontSize: 11.5 }}>
            {report.structure && (
              <div style={{ color: 'var(--muted)' }}>
                Structure : tendance <b style={{ color: '#e2e8f0' }}>{report.structure.trend}</b>
                {report.structure.recent && report.structure.recent.length > 0 && (
                  <> · {(report.structure.recent || []).map(r => `${r.label} ${ttFmt(r.price)}`).join(' · ')}</>
                )}
              </div>
            )}
            {report.fibLevels && (
              <div style={{ color: 'var(--muted)' }}>
                Fibonacci ({report.fibLevels.sens}) :&nbsp;
                {Object.entries(report.fibLevels.levels).map(([k, v]) => `${k}=${ttFmt(v)}`).join(' · ')}
              </div>
            )}
            {Array.isArray(report.levels) && report.levels.length > 0 && (
              <div tabIndex={0} role="region" aria-label="Niveaux calculés"
                style={{ maxHeight: 160, overflowY: 'auto' }}>
                {report.levels.slice(0, 40).map((l, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between',
                    gap: 10, padding: '3px 0', borderBottom: '1px solid ' + TT.line }}>
                    <span style={{ color: 'var(--muted)' }}>{l.kind}</span>
                    <b style={{ fontVariantNumeric: 'tabular-nums' }}>{ttFmt(l.price)}</b>
                  </div>
                ))}
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

// ── Historique des signaux (confirmés / rejetés / expirés) ───────────────
function SignalHistory({ journal }) {
  const RES = {
    tp1: { l: 'OBJ 1', tone: 'ok' }, tp2: { l: 'OBJ 2', tone: 'ok' },
    sl: { l: 'STOP', tone: 'bad' }, be: { l: 'BE', tone: 'neu' },
    expire: { l: 'EXPIRÉ', tone: 'neu' }, ouvert: { l: 'OUVERT', tone: 'info' }
  };
  const liste = (journal || []).slice(0, 20);
  return (
    <details className="panel" style={{ padding: '13px 15px', marginBottom: 12 }}>
      <summary style={{ cursor: 'pointer', fontSize: 12.5, fontWeight: 700 }}>
        <i className="fas fa-clock-rotate-left" style={{ marginRight: 8, color: TT.info }}></i>
        Historique des signaux ({liste.length})
      </summary>
      <div style={{ marginTop: 9 }}>
        {liste.length === 0 ? (
          <div style={{ fontSize: 11.5, color: 'var(--dim)' }}>
            Aucun signal enregistré. Le journal se remplit à chaque signal confirmé ou à surveiller.
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 4 }}>
            {liste.map((s, i) => {
              const r = RES[s.resultat] || RES.ouvert;
              const achat = s.sens === 'long';
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8,
                  fontSize: 11.5, padding: '4px 0', borderBottom: '1px solid ' + TT.line }}>
                  <b style={{ color: achat ? TT.ok : TT.bad, minWidth: 46 }}>
                    {achat ? 'ACHAT' : 'VENTE'}
                  </b>
                  <span style={{ color: '#dbe4f0', minWidth: 76 }}>{s.symbol || '—'}</span>
                  <span style={{ color: 'var(--muted)', flex: 1, overflow: 'hidden',
                    textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.nom || s.id || ''}</span>
                  <span style={{ color: 'var(--dim)', fontVariantNumeric: 'tabular-nums' }}>
                    {s.entree !== undefined ? ttFmt(s.entree) : ''}
                  </span>
                  <TtPill tone={r.tone}>{r.l}</TtPill>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </details>
  );
}

/* ══════════════════════════ ÉCRAN DIRECT ══════════════════════════ */

function LiveMarket({ onToJournal }) {
  const [meta, setMeta] = useState({ symbols: [], timeframes: ['1m', '5m', '15m', '1h'] });
  const [symbol, setSymbol] = useState('R_75');
  const [provider, setProvider] = useState('deriv');
  const [tf, setTf] = useState('5m');
  const [profondeur, setProfondeur] = useState(300);
  const [mode, setMode] = useState('auto');
  const [strategiesChoisies, setStrategiesChoisies] = useState([]);
  const [choixOuvert, setChoixOuvert] = useState(false);
  const [filtreProfil, setFiltreProfil] = useState('');
  const [profils, setProfils] = useState([]);
  const [reglages, setReglages] = useState(false);   // panneau de réglages replié

  const [candles, setCandles] = useState([]);
  const [report, setReport] = useState(null);
  const [vocabulaire, setVocabulaire] = useState(null);
  const [playbooks, setPlaybooks] = useState(null);
  const [decision, setDecision] = useState(null);        // DecisionEngine complet
  const [verdict, setVerdict] = useState(null);           // verdict détaillé (règles, force)
  const [sse, setSse] = useState(null);                   // flux temps réel (repli)
  const [confluence, setConfluence] = useState(null);
  const [statuts, setStatuts] = useState([]);
  const [journal, setJournal] = useState([]);

  const [tick, setTick] = useState(null);
  const [tickRate, setTickRate] = useState(0);
  const tickPrec = useRef(null);
  const [live, setLive] = useState(false);
  const [ticks, setTicks] = useState(0);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState(null);
  const [big, setBig] = useState(false);
  const [vue, setVue] = useState('app');
  const [filtre, setFiltre] = useState('all');
  const [typeTrade, setTypeTrade] = useState('auto');

  const [etroi, setEtroit] = useState(() => typeof window !== 'undefined' && window.innerWidth < 820);
  useEffect(() => {
    const maj = () => setEtroit(window.innerWidth < 820);
    window.addEventListener('resize', maj);
    return () => window.removeEventListener('resize', maj);
  }, []);

  // Profils (stratégies de la base) pour le mode « Ma stratégie ».
  useEffect(() => {
    (async () => {
      try {
        const d = await (await api('/strategies/profiles')).json();
        if (d.success) setProfils(d.profils || []);
      } catch (e) { /* la sélection reste vide, le direct fonctionne en auto */ }
    })();
  }, []);

  // Marchés disponibles.
  useEffect(() => {
    (async () => {
      try {
        const m = await (await api('/market/symbols')).json();
        if (m.success) setMeta({ symbols: m.symbols || [], timeframes: m.timeframes || meta.timeframes });
      } catch (e) { /* hors ligne : on garde les valeurs par défaut */ }
    })();
  }, []);

  const paramsCommuns = useCallback(() => {
    const p = `symbol=${encodeURIComponent(symbol)}&tf=${tf}&provider=${provider}&mode=${mode}`;
    return mode === 'manuel' && strategiesChoisies.length
      ? p + '&strategies=' + encodeURIComponent(strategiesChoisies.join(','))
      : p;
  }, [symbol, tf, provider, mode, strategiesChoisies.join(',')]);

  // Changement de marché : on vide tout de suite (jamais l'ancien marché étiqueté).
  useEffect(() => {
    setCandles([]); setReport(null); setVocabulaire(null);
    setDecision(null); setSse(null); setConfluence(null); setTicks(0);
    window.__debutAnalyse = Date.now();   // point de départ du compteur d'attente
  }, [symbol, tf, provider]);

  // Bougies + structure (playbooks, vocabulaire) — rafraîchi régulièrement.
  const load = useCallback(async () => {
    setErr('');
    try {
      const [cb, st] = await Promise.all([
        api(`/market/candles?symbol=${encodeURIComponent(symbol)}&tf=${tf}&count=${profondeur}&provider=${provider}`)
          .then(r => r.json()).catch(() => null),
        api(`/market/structure?symbol=${encodeURIComponent(symbol)}&tf=${tf}&provider=${provider}`)
          .then(r => r.json()).catch(() => null)
      ]);
      if (cb && cb.success && Array.isArray(cb.candles) && cb.candles.length) setCandles(cb.candles);
      if (cb && cb.offline) setOffline(true);
      if (st && st.success && st.report) {
        setReport(st.report);
        if (st.vocabulaire) setVocabulaire(st.vocabulaire);
        if (st.playbooks) setPlaybooks(st.playbooks);
      }
      if (!cb || !cb.success) {
        setErr((cb && cb.error) || 'chargement des bougies impossible');
      }
    } catch (e) { setErr(String(e.message || e)); }
  }, [symbol, tf, provider, profondeur]);

  useEffect(() => {
    let vivant = true;
    const recharger = () => { if (vivant) load(); };
    recharger();
    const it = setInterval(recharger, 5000);
    return () => { vivant = false; clearInterval(it); };
  }, [load]);

  // Décision complète du moteur (arbitrage 5 niveaux) — et alignement MTF.
  useEffect(() => {
    let vivant = true;
    const chargerDecision = async () => {
      try {
        const d = await (await api(`/decision?${paramsCommuns()}`)).json();
        if (vivant && d.success && d.decision) { setDecision(d.decision); }
      } catch (e) { /* repli : le flux SSE garde le dernier verdict */ }
    };
    const chargerVerdict = async () => {
      try {
        const d = await (await api(`/signals?${paramsCommuns()}`)).json();
        if (vivant && d.success && d.verdict) setVerdict(d.verdict);
      } catch (e) { /* verdict détaillé absent : on n'affiche rien plutôt qu'un faux */ }
    };
    const chargerConfluence = async () => {
      try {
        const d = await (await api(`/signals/confluence?${paramsCommuns()}`)).json();
        if (vivant && d.success) setConfluence(d);
      } catch (e) { /* pas d'alignement : on n'affiche rien plutôt qu'un faux */ }
    };
    const chargerStatuts = async () => {
      try {
        const d = await (await api('/live/statuts')).json();
        if (vivant && d.success) setStatuts(Array.isArray(d.statuts) ? d.statuts : []);
      } catch (e) { /* table absente : liste vide, jamais inventée */ }
    };
    const chargerJournal = async () => {
      try {
        const d = await (await api('/journal-signaux?limite=40')).json();
        if (vivant && d.success) setJournal(Array.isArray(d.signaux) ? d.signaux : []);
      } catch (e) { /* journal absent : section vide */ }
    };
    setDecision(null); setConfluence(null); setVerdict(null);
    chargerDecision(); chargerVerdict(); chargerConfluence(); chargerStatuts(); chargerJournal();
    const iDec = setInterval(() => { if (vivant) chargerDecision(); }, 15000);
    const iVer = setInterval(() => { if (vivant) chargerVerdict(); }, 15000);
    const iConf = setInterval(() => { if (vivant) chargerConfluence(); }, 60000);
    const iStat = setInterval(() => { if (vivant) chargerStatuts(); }, 30000);
    const iJour = setInterval(() => { if (vivant) chargerJournal(); }, 60000);
    return () => {
      vivant = false;
      clearInterval(iDec); clearInterval(iVer); clearInterval(iConf);
      clearInterval(iStat); clearInterval(iJour);
    };
  }, [paramsCommuns]);

  // Bougies en direct (SSE).
  useEffect(() => {
    setLive(false);
    const es = new EventSource(`/api/market/stream?symbol=${encodeURIComponent(symbol)}&tf=${tf}&provider=${provider}`);
    es.addEventListener('hello', () => setLive(true));
    es.addEventListener('candle', ev => {
      try {
        const c = JSON.parse(ev.data);
        setCandles(prev => {
          if (!prev.length) return [c];
          const last = prev[prev.length - 1];
          if (last.t === c.t) return [...prev.slice(0, -1), c];
          if (c.t > last.t) return [...prev, c].slice(-400);
          return prev;
        });
        setTicks(n => n + 1);
        setLastUpdate(Date.now());
      } catch (e) { /* trame illisible : ignorée */ }
    });
    es.addEventListener('error', () => setLive(false));
    return () => es.close();
  }, [symbol, tf, provider]);

  // Ticks bruts (prix réel).
  useEffect(() => {
    if (!symbol) return;
    setTick(null); setTickRate(0); tickPrec.current = null;
    const es = new EventSource(`/api/market/ticks?symbol=${encodeURIComponent(symbol)}&provider=${provider}`);
    let recus = 0;
    es.addEventListener('tick', ev => {
      try {
        const t = JSON.parse(ev.data);
        setTick({ ...t, prec: tickPrec.current });
        tickPrec.current = t.prix;
        recus++;
      } catch (e) { /* tick illisible */ }
    });
    es.addEventListener('error', () => {});
    const compteur = setInterval(() => { setTickRate(recus); recus = 0; }, 1000);
    return () => { clearInterval(compteur); es.close(); };
  }, [symbol, provider]);

  // Verdict en direct (SSE) : repli immédiat du Decision Center.
  useEffect(() => {
    setSse(null);
    const es = new EventSource(`/api/signals/stream?${paramsCommuns()}`);
    es.addEventListener('signal', ev => {
      try { setSse(JSON.parse(ev.data)); } catch (e) { /* trame illisible */ }
    });
    return () => es.close();
  }, [paramsCommuns]);

  const analyser = async () => {
    setBusy(true); setErr('');
    try {
      const r = await (await api('/market/analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, tf, provider, maxStrategies: 3 })
      })).json();
      if (!r.success) throw new Error(r.error || 'analyse impossible');
      setResult(r);
    } catch (e) { setErr(String(e.message || e)); }
    finally { setBusy(false); }
  };

  const last = candles.length ? candles[candles.length - 1] : null;
  const prix = tick ? tick.prix : (last ? last.c : null);
  const cur = meta.symbols.find(s => s.symbol === symbol && s.provider === provider);
  const providerLabel = cur ? (cur.tv || cur.providerLabel) : provider;
  const sensAffiche = (decision && decision.signal && decision.signal.sens)
    || (sse && sse.direction) || null;
  // Verdict du flux : porte le mode et la stratégie réellement appliquée
  // (mode manuel). Sert aussi à nommer la stratégie à l'écran.
  const signal = sse;
  // Setup chiffré : le meilleur signal de l'arbitrage. S'il vient d'un motif,
  // ses niveaux vivent dans entree/stop/objectifs — on les remonte pour ne pas
  // perdre un setup pourtant validé par le moteur.
  const meilleurSetup = (() => {
    if (!decision || !decision.signal) return null;
    const s = decision.signal;
    if (s.levels) return s;
    const plein = (decision.signaux || []).find(x => x.id === s.id);
    return plein ? { ...s, levels: {
      entry: plein.entree, stop: plein.stop,
      target1: (plein.objectifs || [])[0], target2: (plein.objectifs || [])[1]
    } } : s;
  })();

  return (
    <>
      {/* ── En-tête instrument (collant) ── */}
      <div className="panel" style={{ padding: '11px 14px', marginBottom: 12,
        position: 'sticky', top: 0, zIndex: 40, background: 'var(--panel)',
        boxShadow: '0 6px 18px -12px rgba(0,0,0,.9)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '.1em',
              color: 'var(--dim)', textTransform: 'uppercase' }}>5trade terminal</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <b style={{ fontSize: 16 }}>{providerLabel}</b>
              <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                {(cur && cur.label) || symbol} · {tf}
              </span>
              {signal && signal.mode === 'manuel' && signal.strategieAppliquee && (
                <TtPill tone="info"
                  title={`Verdict limité aux règles de : ${(signal.strategieAppliquee.regles || []).join(', ')}`}>
                  <i className="fas fa-book" style={{ fontSize: 9 }}></i>
                  {signal.strategieAppliquee.titre}
                </TtPill>
              )}
            </div>
          </div>
          <span style={{ flex: '1 1 auto' }}></span>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 20, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
              letterSpacing: '-.02em',
              color: tick && tick.prec !== null && tick.prec !== undefined
                ? (tick.prix > tick.prec ? TT.ok : tick.prix < tick.prec ? TT.bad : '#fff')
                : '#fff' }}>{ttFmt(prix)}</div>
            {tickRate > 0 && (
              <div style={{ fontSize: 9.5, color: 'var(--dim)' }}>{tickRate} tick/s</div>
            )}
          </div>
          <LiveStatusIndicator live={live} offline={offline} ticks={ticks}
            lastUpdate={lastUpdate} onRefresh={load} busy={busy} />
          <button className="btn ghost sm" style={{ padding: '5px 9px' }}
            onClick={() => setReglages(r => !r)}
            title="Marché, unité de temps, stratégie">
            <i className={`fas ${reglages ? 'fa-xmark' : 'fa-sliders'}`}></i>
          </button>
        </div>

        {/* Réglages repliés — la décision reste visible */}
        {reglages && (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid ' + TT.line,
            display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select className="fld" aria-label="Marché analysé" style={{ width: 220 }}
              value={`${provider}|${symbol}`}
              onChange={e => { const [pv, sy] = e.target.value.split('|'); setProvider(pv); setSymbol(sy); }}>
              {Object.entries((meta.symbols || []).reduce((acc, s) => {
                const k = s.providerLabel || 'Marchés';
                (acc[k] = acc[k] || []).push(s);
                return acc;
              }, {})).map(([label, list]) => (
                <optgroup key={label} label={label}>
                  {list.map(s => (
                    <option key={`${s.provider}|${s.symbol}`} value={`${s.provider}|${s.symbol}`}>
                      {s.tv ? `${s.tv} — ${s.label}` : s.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <select className="fld" aria-label="Unité de temps" style={{ width: 92 }}
              value={tf} onChange={e => setTf(e.target.value)}>
              {(meta.timeframes || []).map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select className="fld" aria-label="Mode d'analyse" style={{ width: 148 }}
              value={mode} onChange={e => setMode(e.target.value)}
              title="Auto : l'app combine toutes les règles. Manuel : uniquement les règles d'une stratégie de ta base.">
              <option value="auto">Analyse auto</option>
              <option value="manuel">Ma stratégie</option>
            </select>
            <select className="fld" aria-label="Profondeur d'historique" style={{ width: 112 }}
              value={profondeur} onChange={e => setProfondeur(Number(e.target.value))}>
              {[150, 300, 500, 1000].map(n => <option key={n} value={n}>{n} bougies</option>)}
            </select>

            {mode === 'manuel' && (
              <div style={{ position: 'relative' }}>
                <button className="btn ghost sm" onClick={() => setChoixOuvert(o => !o)}>
                  <i className="fas fa-list-check"></i>
                  {strategiesChoisies.length ? `${strategiesChoisies.length} stratégie(s)` : 'Choisir'}
                </button>
                {choixOuvert && (
                  <div className="panel" style={{ position: 'absolute', zIndex: 60, top: '115%',
                    left: 0, width: 340, maxHeight: 320, overflowY: 'auto', padding: 12 }}>
                    <input className="fld" placeholder="Filtrer…" value={filtreProfil}
                      onChange={e => setFiltreProfil(e.target.value)} style={{ width: '100%', marginBottom: 8 }} />
                    <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                      <button className="btn ghost sm" onClick={() => setStrategiesChoisies(profils.map(p => p.id))}>Tout</button>
                      <button className="btn ghost sm" onClick={() => setStrategiesChoisies([])}>Aucune</button>
                      <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--dim)', alignSelf: 'center' }}>
                        {profils.length} disponible(s)
                      </span>
                    </div>
                    {profils
                      .filter(p => !filtreProfil || String(p.titre || '').toLowerCase().includes(filtreProfil.toLowerCase()))
                      .map(p => (
                        <label key={p.id} style={{ display: 'flex', gap: 8, alignItems: 'center',
                          padding: '5px 2px', fontSize: 12.5, cursor: 'pointer' }}>
                          <input type="checkbox" checked={strategiesChoisies.includes(p.id)}
                            onChange={() => setStrategiesChoisies(l =>
                              l.includes(p.id) ? l.filter(x => x !== p.id) : [...l, p.id])} />
                          <span style={{ flex: 1 }}>{p.titre}</span>
                          <span className="tag" style={{ fontSize: 10 }}>{(p.regles || []).join('+')}</span>
                        </label>
                      ))}
                    {!profils.length && <div style={{ fontSize: 12, color: 'var(--dim)' }}>Aucune stratégie dans la base.</div>}
                  </div>
                )}
              </div>
            )}

            {mode === 'manuel' && strategiesChoisies.length > 0 && (
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
                {strategiesChoisies.map(id => {
                  const p = profils.find(x => x.id === id);
                  return (
                    <span key={id} className="tag" style={{ fontSize: 10.5, cursor: 'pointer' }}
                      title="Cliquer pour retirer" onClick={() => setStrategiesChoisies(l => l.filter(x => x !== id))}>
                      {(p ? p.titre : id).slice(0, 28)}
                      <i className="fas fa-xmark" style={{ marginLeft: 5 }}></i>
                    </span>
                  );
                })}
              </div>
            )}

            <span style={{ flex: '1 1 auto' }}></span>
            <button className="btn ghost sm" onClick={() => setBig(b => !b)}
              title={big ? 'Réduire le graphique' : 'Agrandir le graphique'}>
              <i className={`fas ${big ? 'fa-compress' : 'fa-expand'}`}></i>
            </button>
            <button className="btn ghost sm" onClick={() => setVue(v => v === 'app' ? 'tradingview' : 'app')}>
              <i className={`fas ${vue === 'app' ? 'fa-tv' : 'fa-chart-line'}`}></i>
              {vue === 'app' ? 'TradingView' : 'Vue app'}
            </button>
            <button className="btn" onClick={analyser} disabled={busy}>
              {busy ? <Spinner /> : <><i className="fas fa-bolt"></i>Analyser</>}
            </button>
          </div>
        )}
      </div>

      {err && (
        <div className="panel" style={{ padding: '10px 14px', marginBottom: 12,
          borderColor: 'rgba(239,68,68,.45)', color: '#fca5a5', fontSize: 12.5 }}>
          <i className="fas fa-triangle-exclamation" style={{ marginRight: 8 }}></i>
          {/Pas assez de bougies/i.test(err)
            ? `${err} — marché probablement fermé. Les indices synthétiques (Volatility) et les cryptos cotent 24 h/24.`
            : err}
        </div>
      )}

      {/* 03 — LA DÉCISION, TOUT EN HAUT */}
      <LiveDecisionCenter decision={decision} sse={sse} price={prix}
        at={(decision && decision.at) || (last && last.t)} symbol={symbol} tf={tf}
        providerLabel={providerLabel} confluence={confluence} />

      {/* Setup chiffré, seulement s'il existe */}
      <TradeSetupCard signal={meilleurSetup} decision={decision || (sse && sse.decision ? sse : null)}
        sens={sensAffiche} onToJournal={onToJournal} symbol={symbol} tf={tf}
        provider={provider} providerLabel={providerLabel} />

      {/* Graphique : accessible tôt, sans écraser la décision */}
      <div className="panel" style={{ padding: 14, marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <TtLabel>Graphique</TtLabel>
            {last && (
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                O {ttFmt(last.o)} · H {ttFmt(last.h)} · L {ttFmt(last.l)} · C {ttFmt(last.c)}
              </span>
            )}
          </div>
          <span style={{ fontSize: 11, color: 'var(--dim)' }}>
            {report ? `${report.candles} bougies · ATR ${report.atr14}` : ''}
          </span>
        </div>
        <div className="chart-mobile">
          {vue === 'app' ? (
            <PriceChart candles={candles} report={report}
              levels={report ? report.levels : []} signal={decision && decision.signal}
              height={big ? (etroi ? 460 : 620) : (etroi ? 300 : 430)} symbol={symbol} tf={tf} />
          ) : (
            <TradingViewChart symbole={cur && cur.tv} tf={tf}
              height={big ? (etroi ? 460 : 620) : (etroi ? 300 : 430)} />
          )}
        </div>
      </div>

      {/* 02 — Stratégies */}
      <StrategyMonitor playbooks={playbooks}
        signaux={(decision && decision.signaux) || []}
        statuts={statuts} filtre={filtre} setFiltre={setFiltre}
        typeTrade={typeTrade} setTypeTrade={setTypeTrade} />

      {/* Alignement MTF */}
      <MultiTimeframeMatrix confluence={confluence} />

      {/* Pourquoi cette décision */}
      <SignalExplanation trace={(decision && decision.trace) || (sse && sse.trace)}
        decision={decision} signal={verdict} />

      {/* 01 — Intelligence de marché */}
      <MarketStructurePanel carte={decision && decision.carte} report={report} />

      {/* Historique */}
      <SignalHistory journal={journal} />

      {vocabulaire && vocabulaire.length > 0 && (
        <details className="panel" style={{ padding: '12px 15px', marginBottom: 12 }}>
          <summary style={{ cursor: 'pointer', fontSize: 12.5, fontWeight: 700 }}>
            <i className="fas fa-list-check" style={{ marginRight: 8, color: TT.info }}></i>
            Termes vérifiés sur ce graphique
            {' · '}{vocabulaire.filter(t => t.present).length}/{vocabulaire.length}
          </summary>
          <div style={{ display: 'grid', gap: 4, marginTop: 8 }}>
            {vocabulaire.map(t => (
              <div key={t.sigle} style={{ display: 'flex', gap: 10, alignItems: 'baseline',
                fontSize: 12, opacity: t.present ? 1 : 0.45 }}>
                <i className={`fas ${t.present ? 'fa-circle-check' : 'fa-circle-minus'}`}
                  style={{ width: 12, color: t.present ? TT.ok : TT.neu, fontSize: 10 }}></i>
                <b style={{ width: 104, color: t.present ? '#93c5fd' : 'var(--muted)' }}>{t.sigle}</b>
                <span style={{ flex: 1, color: 'var(--muted)' }}>{t.valeur || t.lecture}</span>
              </div>
            ))}
          </div>
        </details>
      )}

      {result && <Result result={result} />}
    </>
  );
}

/* ══════════════ JOURNAL DE TRADES ══════════════ */

const TRADE_R = {
  win:  { label:'Gain',  color:'#10b981', bg:'rgba(16,185,129,.13)', icon:'fa-arrow-trend-up' },
  loss: { label:'Perte', color:'#ef4444', bg:'rgba(239,68,68,.13)',  icon:'fa-arrow-trend-down' },
  breakeven:{ label:'Neutre', color:'#94a3b8', bg:'rgba(148,163,184,.13)', icon:'fa-equals' }
};

function ResultBadge({ result, status }) {
  if (status === 'open') {
    return <span className="badge" style={{ background:'rgba(37,99,235,.14)', color:'#7cb2ff' }}>
      <i className="fas fa-hourglass-half"></i>en cours</span>;
  }
  const s = TRADE_R[result] || { label:result || '—', color:'#94a3b8', bg:'rgba(148,163,184,.13)', icon:'fa-circle' };
  return <span className="badge" style={{ background:s.bg, color:s.color }}>
    <i className={`fas ${s.icon}`}></i>{s.label}</span>;
}

// ── Journal des SIGNAUX (suivi automatique des issues) ──────────────────
// Différent du journal de trades : ici personne ne saisit rien. Chaque signal
// émis par le moteur est enregistré avec ses niveaux, puis réévalué sur les
// bougies suivantes. On voit donc si l'objectif 1 a été atteint, si le stop a
// été touché, ou si le prix est revenu au point d'entrée (BE).
// ── Statut EN DIRECT des stratégies ────────────────────────────────────────
// Le journal ne montre que les signaux PUBLIÉS. Or le moteur évalue chaque
// marché à chaque cycle, même quand il ne publie rien : c'est ce statut-là
// (VALID / WAITING / INVALID / NO_DATA) qui dit ce qu'il pense maintenant.
function StatutDirectPanel() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  const charger = async () => {
    try {
      const r = await (await api('/live/statuts')).json();
      if (!r.success) throw new Error(r.error || 'lecture impossible');
      setData(r); setErr('');
    } catch (e) { setErr(e.message); }
  };
  useEffect(() => {
    charger();
    const t = setInterval(charger, 30000);
    return () => clearInterval(t);
  }, []);

  const teinte = { VALID: '#34d399', WAITING: '#fbbf24', INVALID: '#f87171', NO_DATA: '#94a3b8' };
  const libelle = { VALID: 'Valide', WAITING: 'En attente', INVALID: 'Invalidé', NO_DATA: 'Pas de données' };
  // DIRECTION et DÉCISION sont deux informations différentes : l'une dit ce que
  // la stratégie voit, l'autre ce que le moteur autorise. « En attente » est un
  // état de décision — il ne doit jamais tenir lieu de direction.
  const dirDe = s => {
    const d = String(s.direction || '').toUpperCase();
    if (d === 'BUY' || d === 'LONG' || d === 'ACHAT') return 'BUY';
    if (d === 'SELL' || d === 'SHORT' || d === 'VENTE') return 'SELL';
    if (d === 'NEUTRAL' || d === 'NEUTRE') return 'NEUTRAL';
    return 'UNKNOWN';
  };
  const teinteDir = { BUY: '#34d399', SELL: '#f87171', NEUTRAL: '#94a3b8', UNKNOWN: '#fbbf24' };
  const surv = data && data.surveillance;
  const statuts = (data && data.statuts) ? data.statuts : [];
  const age = ms => ms === null || ms === undefined ? '—'
    : ms < 60000 ? Math.round(ms / 1000) + ' s'
    : ms < 3600000 ? Math.round(ms / 60000) + ' min' : Math.round(ms / 3600000) + ' h';

  return (
    <div className="panel" style={{ padding:'14px 18px', marginBottom:16 }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap', marginBottom:10 }}>
        <i className="fas fa-satellite-dish" style={{ color: surv && surv.active ? '#34d399' : '#94a3b8' }}></i>
        <b style={{ fontSize:13.5, color:'#fff' }}>Statut en direct</b>
        {surv && (
          <>
            <span className="badge" style={{ fontSize:10,
              background: surv.active ? 'rgba(34,211,138,.14)' : 'rgba(148,163,184,.12)',
              color: surv.active ? '#34d399' : 'var(--muted)' }}>
              {surv.active ? 'surveillance active' : 'surveillance arrêtée'}
            </span>
            <span className="badge" style={{ fontSize:10, background:'rgba(96,165,250,.13)', color:'#93c5fd' }}>
              {surv.marches} marché(s) · {surv.strategies} stratégie(s) · toutes les {surv.intervalleSec} s
            </span>
            {surv.mode === 'generique' && (
              <span className="badge" style={{ fontSize:10, background:'rgba(245,158,11,.14)', color:'#fbbf24' }}
                title="Aucune stratégie cochée : le moteur juge avec ses règles génériques, pas avec une stratégie.">
                mode générique
              </span>
            )}
          </>
        )}
      </div>

      {err && <div style={{ fontSize:11.5, color:'#f87171' }}>{err}</div>}
      {!err && statuts.length === 0 && (
        <div style={{ fontSize:11.5, color:'var(--muted)' }}>
          Aucune évaluation enregistrée pour l'instant. Chaque cycle de surveillance en
          écrit une — si cette liste reste vide alors que la surveillance est active,
          c'est que le moteur n'a pas encore tourné.
        </div>
      )}

      {statuts.length > 0 && (
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11.5 }}>
            <thead>
              <tr style={{ color:'var(--muted)', textAlign:'left' }}>
                <th style={{ padding:'4px 8px 4px 0' }}>Marché</th>
                <th style={{ padding:'4px 8px' }}>Unité</th>
                <th style={{ padding:'4px 8px' }}>Stratégie</th>
                <th style={{ padding:'4px 8px' }} title="Ce que la stratégie voit : BUY, SELL, NEUTRAL ou UNKNOWN">Direction</th>
                <th style={{ padding:'4px 8px' }} title="Ce que le moteur autorise : validé, en attente, rejeté">Décision</th>
                <th style={{ padding:'4px 8px' }}>Conditions</th>
                <th style={{ padding:'4px 8px' }}>Manquantes</th>
                <th style={{ padding:'4px 8px' }}>Âge</th>
              </tr>
            </thead>
            <tbody>
              {statuts.slice(0, 40).map((s, i) => (
                <tr key={i} style={{ borderTop:'1px solid rgba(148,163,184,.12)' }}>
                  <td style={{ padding:'5px 8px 5px 0', color:'#fff' }}>{s.symbole}</td>
                  <td style={{ padding:'5px 8px', color:'var(--muted)' }}>{s.timeframe || '—'}</td>
                  <td style={{ padding:'5px 8px', color:'var(--muted)' }}>
                    {s.strategie}{s.version ? ' · v' + s.version : ''}
                  </td>
                  <td style={{ padding:'5px 8px' }}>
                    {(() => {
                      const d = dirDe(s);
                      return (
                        <span style={{ fontSize:10, fontWeight:600, padding:'2px 7px', borderRadius:4,
                          background: teinteDir[d] + '1c', color: teinteDir[d],
                          border: '1px solid ' + teinteDir[d] + '44' }}>
                          {d === 'BUY' ? 'BUY ↗' : d === 'SELL' ? 'SELL ↘' : d === 'NEUTRAL' ? 'NEUTRAL ·' : 'UNKNOWN ?'}
                        </span>
                      );
                    })()}
                  </td>
                  <td style={{ padding:'5px 8px' }}>
                    <span style={{ fontSize:10, padding:'2px 7px', borderRadius:999,
                      background: (teinte[s.statut] || '#94a3b8') + '22',
                      color: teinte[s.statut] || '#94a3b8' }}>
                      {libelle[s.statut] || s.statut}
                    </span>
                  </td>
                  <td style={{ padding:'5px 8px', color:'var(--muted)' }}>
                    {s.conditionTotal ? s.conditionRemplies + '/' + s.conditionTotal : '—'}
                  </td>
                  <td style={{ padding:'5px 8px', color: s.obligatoiresManquantes.length ? '#f87171' : 'var(--muted)' }}>
                    {s.obligatoiresManquantes.length ? s.obligatoiresManquantes.join(', ') : '—'}
                  </td>
                  <td style={{ padding:'5px 8px', color: s.frais ? 'var(--muted)' : '#fbbf24' }}>
                    {age(s.ageMs)}{s.frais ? '' : ' (figé)'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function JournalSignauxPanel() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [filtre, setFiltre] = useState('tout');

  const px = p => (p === null || p === undefined || !Number.isFinite(Number(p)))
    ? '—' : (Number(p) >= 1000 ? Number(p).toFixed(2) : Number(p).toFixed(5));

  const charger = async () => {
    try {
      const r = await (await api('/journal-signaux?limite=150')).json();
      if (!r.success) throw new Error(r.error || 'lecture impossible');
      setData(r); setErr('');
    } catch (e) { setErr(e.message); }
  };
  useEffect(() => { charger(); }, []);

  const maj = async () => {
    setBusy(true);
    try {
      await api('/journal-signaux/maj', { method: 'POST' });
      await charger();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const st = data && data.stats;
  const libelle = { tp2: 'Objectif 2', tp1: 'Objectif 1', be: 'Retour entrée (BE)', sl: 'Stop touché', expire: 'Expiré', ouvert: 'En cours' };
  const teinte = { tp2: '#34d399', tp1: '#6ee7b7', be: '#fbbf24', sl: '#f87171', expire: '#94a3b8', ouvert: '#60a5fa' };

  const liste = (data && data.signaux ? data.signaux : [])
    .filter(s => filtre === 'tout' ? true : filtre === 'clos' ? s.resultat !== 'ouvert' : s.resultat === 'ouvert');

  return (
    <div className="panel" style={{ padding:'14px 18px', marginBottom:16 }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap', marginBottom:10 }}>
        <i className="fas fa-clipboard-check" style={{ color:'#60a5fa' }}></i>
        <b style={{ fontSize:13.5, color:'#fff' }}>Signaux suivis automatiquement</b>
        {st && (
          <>
            <span className="badge" style={{ fontSize:10, background:'rgba(96,165,250,.13)', color:'#93c5fd' }}>{st.total} enregistré(s)</span>
            <span className="badge" style={{ fontSize:10, background:'rgba(148,163,184,.12)', color:'var(--muted)' }}>{st.ouverts} en cours</span>
            {st.tauxReussite !== null && (
              <span className="badge" style={{ fontSize:10,
                background: st.tauxReussite >= 50 ? 'rgba(34,211,138,.14)' : 'rgba(245,158,11,.14)',
                color: st.tauxReussite >= 50 ? '#34d399' : '#fbbf24' }}>
                {st.tauxReussite} % de réussite
              </span>
            )}
            {st.rTotal !== 0 && (
              <span className="badge"
                title={st.fraisMoyenR > 0
                  ? 'Frais déduits de chaque prise.'
                  : 'Aucun frais configuré : total AVANT frais. Au-delà de ' + st.coutCritique + ' R de frais par prise, cet avantage disparaît.'}
                style={{ fontSize:10, background:'transparent', border:'1px solid rgba(148,163,184,.3)', color: st.rTotal >= 0 ? '#34d399' : '#f87171' }}>
                {st.rTotal >= 0 ? '+' : ''}{st.rTotal} R cumulés{st.fraisMoyenR > 0 ? '' : ' (brut)'}
              </span>
            )}
          </>
        )}
        <span style={{ flex:'1 1 auto' }}></span>
        <select className="fld" aria-label="Filtrer les signaux par résultat" style={{ width:130, fontSize:12 }} value={filtre} onChange={e => setFiltre(e.target.value)}>
          <option value="tout">Tous</option>
          <option value="clos">Tranchés</option>
          <option value="ouvert">En cours</option>
        </select>
        <button className="btn ghost sm" onClick={maj} disabled={busy}>
          {busy ? <Spinner /> : <i className="fas fa-rotate"></i>} Actualiser
        </button>
      </div>

      {err && <div style={{ fontSize:12.5, color:'#fca5a5' }}>{err}</div>}

      {st && st.clos > 0 && (
        <div style={{ display:'flex', gap:14, flexWrap:'wrap', fontSize:12, color:'var(--muted)', marginBottom:10 }}>
          {['tp2','tp1','be','sl','expire'].map(k => (
            <span key={k} style={{ color: teinte[k] }}>
              <i className="fas fa-circle" style={{ fontSize:7, marginRight:5 }}></i>
              {libelle[k]} : {st.parResultat[k] || 0}
            </span>
          ))}
        </div>
      )}

      {liste.length === 0 && (
        <div style={{ fontSize:12.5, color:'var(--muted)' }}>
          Aucun signal enregistré pour l'instant. Laisse le flux « Direct » tourner : chaque signal retenu
          est enregistré avec ses niveaux, puis son issue est vérifiée automatiquement sur les bougies suivantes.
        </div>
      )}

      <div style={{ display:'grid', gap:5 }}>
        {liste.slice(0, 40).map(s => (
          <div key={s.cle} style={{ display:'flex', alignItems:'center', gap:9, flexWrap:'wrap',
            padding:'6px 9px', borderRadius:7, background:'rgba(148,163,184,.04)',
            border:`1px solid ${s.resultat === 'ouvert' ? 'rgba(96,165,250,.22)' : 'rgba(148,163,184,.13)'}` }}>
            <span className="badge" style={{ fontSize:9, background:'rgba(148,163,184,.12)', color:'var(--muted)' }}>
              {s.symbol} {s.timeframe}
            </span>
            <b style={{ fontSize:12, color:'#e2e8f0' }}>{(s.strategie || s.nom || '').slice(0, 40)}</b>
            {/* D'où vient ce signal : une stratégie, un motif de chandelier ou
                la structure du marché. Sans cette étiquette, un motif de
                chandelier ressemble à un signal de stratégie — et personne
                ne peut savoir ce qui a réellement parlé. */}
            <span className="badge" style={{ fontSize:9, background:'rgba(148,163,184,.10)',
              color: s.source === 'strategie' ? '#93c5fd' : 'var(--muted)' }}
              title={s.source === 'strategie'
                ? 'Signal produit par une stratégie déclarée'
                : 'Signal générique : motif ou structure, aucune stratégie déclarée'}>
              {s.source === 'strategie' ? 'stratégie' : s.source === 'motif' ? 'motif' : s.source === 'structure' ? 'structure' : (s.source || 'générique')}
            </span>
            <span className="badge" style={{ fontSize:9, background:'transparent', border:`1px solid ${s.sens === 'long' ? '#34d399' : '#f87171'}`, color: s.sens === 'long' ? '#34d399' : '#f87171' }}>
              {s.sens === 'long' ? 'ACHAT' : 'VENTE'}
            </span>
            <span style={{ fontSize:11, color: teinte[s.resultat] || 'var(--muted)', fontWeight:600 }}>
              {libelle[s.resultat] || s.resultat}
              {Number.isFinite(s.r) ? ` · ${s.r >= 0 ? '+' : ''}${s.r} R` : ''}
            </span>
            <span style={{ fontSize:10.5, color:'var(--dim)' }}>
              entrée {px(s.entree)} · stop {px(s.stop)} · obj. {(s.objectifs || []).map(px).join(' / ')}
            </span>
            {/* Ce que le modèle attendait et la taille qu'on aurait prise : sans
                ces deux chiffres, le journal est une liste de prédictions, pas un
                registre de paper-trading. */}
            {s.modele && Number.isFinite(s.modele.rAttendu) && (
              <span className="badge" style={{ fontSize:9,
                background: s.modele.rAttendu > 0 ? 'rgba(34,211,138,.12)' : 'rgba(242,84,91,.12)',
                color: s.modele.rAttendu > 0 ? '#34d399' : '#f87171' }}
                title={`R attendu au moment de l'émission (modèle v${s.modele.version})`}>
                annoncé {s.modele.rAttendu > 0 ? '+' : ''}{s.modele.rAttendu} R
                {Number.isFinite(s.r) ? ` · réel ${s.r > 0 ? '+' : ''}${s.r} R` : ''}
              </span>
            )}
            {s.risque && Number.isFinite(s.risque.taille) && (
              <span className="badge" style={{ fontSize:9, background:'rgba(96,165,250,.12)', color:'#93c5fd' }}
                title={`Taille calculée à l'émission : ${s.risque.risqueMontant} risqués (${s.risque.risquePct} % de ${s.risque.capital})`}>
                {/* 4 chiffres significatifs : « 0,1969 unité(s) », pas 0,19685039 */}
                {+Number(s.risque.taille).toPrecision(4)} unité(s) · {s.risque.risqueMontant} risqués
              </span>
            )}
            <span style={{ flex:'1 1 auto' }}></span>
            <span style={{ fontSize:10.5, color:'var(--dim)' }}>
              {s.bougiesSuivies ? `${s.bougiesSuivies} bougie(s) suivie(s)` : ''}
              {s.atteintTP1 && s.resultat === 'ouvert' ? ' · TP1 déjà touché' : ''}
            </span>
          </div>
        ))}
      </div>

      {st && (st.combinaisons || []).length > 0 && (
        <div style={{ marginTop:14 }}>
          <div style={{ fontSize:12, color:'var(--muted)', marginBottom:6 }}>
            <i className="fas fa-crosshairs" style={{ marginRight:6 }}></i>
            Où ça gagne vraiment — stratégie × marché × unité de temps
          </div>
          <div style={{ display:'grid', gap:4 }}>
            {(st.combinaisons || [])
              .filter(c => c.fiable)
              .slice(0, 10)
              .map((c, i) => (
                <div key={'c' + i} style={{ display:'flex', alignItems:'center', gap:8, fontSize:11.5 }}>
                  <span style={{ flex:'1 1 260px', color:'#e2e8f0' }}>
                    {(c.strategie || '').slice(0, 34)}
                    <span style={{ color:'var(--dim)' }}> · {c.symbole} {c.timeframe}</span>
                  </span>
                  <span style={{ color:'var(--dim)', minWidth:44, textAlign:'right' }}>{c.total} tr.</span>
                  <span style={{ color:(c.tauxReussite ?? 0) >= 50 ? '#34d399' : '#fbbf24', minWidth:44, textAlign:'right' }}>
                    {c.tauxReussite === null ? '—' : c.tauxReussite + ' %'}
                  </span>
                  <span style={{ color:'var(--dim)', minWidth:56, textAlign:'right' }}>
                    {c.rMoyen > 0 ? '+' : ''}{c.rMoyen} R/tr.
                  </span>
                  <span style={{ color:(c.rTotal ?? 0) >= 0 ? '#34d399' : '#f87171', minWidth:64, textAlign:'right' }}>
                    {(c.rTotal ?? 0) >= 0 ? '+' : ''}{c.rTotal} R
                  </span>
                </div>
              ))}
          </div>
          {(() => {
            const faibles = (st.combinaisons || []).filter(c => !c.fiable).length;
            return faibles > 0 ? (
              <div style={{ fontSize:10.5, color:'var(--dim)', marginTop:6 }}>
                {faibles} autre(s) combinaison(s) masquée(s) : moins de 10 trades tranchés,
                trop peu pour conclure quoi que ce soit.
              </div>
            ) : null;
          })()}
        </div>
      )}

      {(data && (data.preuves || []).length > 0) && (
        <div style={{ marginTop:14 }}>
          <div style={{ fontSize:12, color:'var(--muted)', marginBottom:6 }}>
            <i className="fas fa-list-check" style={{ marginRight:6 }}></i>
            Pourquoi ce signal — conditions vérifiées, nommées
          </div>
          <div style={{ display:'grid', gap:8 }}>
            {(data.preuves || []).slice(0, 6).map((e, i) => {
              const teinte = e.statut === 'VALID' ? '#34d399'
                : e.statut === 'INVALID' ? '#f87171'
                  : e.statut === 'NO_DATA' ? '#94a3b8' : '#fbbf24';
              const remplies = (e.preuves || []).filter(p => p.remplie).length;
              return (
                <div key={'p' + i} style={{ border:'1px solid var(--border)', borderRadius:8, padding:'8px 10px' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8, fontSize:11.5, flexWrap:'wrap' }}>
                    <span style={{ color:'#e2e8f0', fontWeight:600 }}>{e.symbole} {e.timeframe}</span>
                    <span style={{ color:'var(--dim)' }}>{e.strategie_id} v{e.version}</span>
                    <span style={{ color:teinte }}>{e.statut}</span>
                    {e.direction && <span style={{ color:'var(--dim)' }}>{e.direction}</span>}
                    <span style={{ flex:'1 1 auto' }}></span>
                    <span style={{ color:'var(--dim)' }}>
                      {remplies}/{(e.preuves || []).length} condition(s) remplie(s)
                    </span>
                  </div>
                  <div style={{ display:'grid', gap:2, marginTop:6 }}>
                    {(e.preuves || []).map((c, j) => (
                      <div key={'c' + j} style={{ display:'flex', gap:7, alignItems:'baseline', fontSize:11 }}>
                        <span style={{ color: c.remplie ? '#34d399' : '#f87171', width:12 }}>
                          {c.remplie ? '✓' : '✗'}
                        </span>
                        <span style={{ color: c.remplie ? '#cbd5e1' : '#94a3b8', flex:'1 1 auto' }}>
                          {c.condition}
                          {c.obligatoire && (
                            <span style={{ fontSize:9, color:'#fbbf24', marginLeft:6 }}>obligatoire</span>
                          )}
                        </span>
                        {c.detail && (
                          <span style={{ fontSize:10, color:'var(--dim)' }}>{String(c.detail).slice(0, 60)}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {st && Object.keys(st.parStrategie || {}).length > 0 && (
        <div style={{ marginTop:12 }}>
          <div style={{ fontSize:12, color:'var(--muted)', marginBottom:6 }}>
            <i className="fas fa-chart-simple" style={{ marginRight:6 }}></i>Résultats par stratégie / concept
          </div>
          <div style={{ display:'grid', gap:4 }}>
            {Object.entries(st.parStrategie)
              .sort((a, b) => b[1].total - a[1].total)
              .slice(0, 8)
              .map(([nom, v]) => {
                const taux = (v.gagnes + v.perdus) ? Math.round((v.gagnes / (v.gagnes + v.perdus)) * 100) : null;
                return (
                  <div key={nom} style={{ display:'flex', alignItems:'center', gap:10, fontSize:11.5 }}>
                    <span style={{ flex:'1 1 220px', color:'#e2e8f0' }}>{nom.slice(0, 52)}</span>
                    <span style={{ color:'#34d399' }}>{v.gagnes}✓</span>
                    <span style={{ color:'#f87171' }}>{v.perdus}✗</span>
                    {v.be > 0 && <span style={{ color:'#fbbf24' }}>{v.be} BE</span>}
                    <span style={{ color: (taux ?? 0) >= 50 ? '#34d399' : '#fbbf24', minWidth:44, textAlign:'right' }}>
                      {taux === null ? '—' : taux + ' %'}
                    </span>
                    <span style={{ color:'var(--dim)', minWidth:56, textAlign:'right' }}>
                      {v.r >= 0 ? '+' : ''}{v.r.toFixed(1)} R
                    </span>
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Backtest ────────────────────────────────────────────────────────────
// Le moteur rejoué sur l'historique, avec le MÊME code que le direct. C'est la
// seule réponse honnête à « est-ce que ça gagne ? » : le journal ne dit que ce
// qui s'est passé depuis qu'on l'écoute.
function BacktestPanel() {
  const [marches, setMarches] = useState([]);
  const [tf, setTf] = useState('5m');
  const [cles, setCles] = useState({ symbol: 'BTCUSDT', provider: 'binance' });
  const [pas, setPas] = useState(2);
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // Un seul endroit qui décide si les chiffres affichés sont nets ou bruts.
  const fraisActifs = !!(res && res.fraisMoyenR > 0);

  useEffect(() => {
    (async () => {
      try {
        const d = await (await api('/market/symbols')).json();
        if (!d.success) return;
        const s = d.symbols || [];
        setMarches(s);
        const crypto = s.find(x => x.provider === 'binance') || s[0];
        if (crypto) setCles({ symbol: crypto.symbol, provider: crypto.provider });
      } catch (e) {}
    })();
  }, []);

  const lancer = async () => {
    setBusy(true); setErr('');
    try {
      const q = `symbol=${encodeURIComponent(cles.symbol)}&tf=${tf}&provider=${encodeURIComponent(cles.provider)}&pas=${pas}&bougies=800&mode=auto`;
      const d = await (await api('/backtest?' + q)).json();
      if (!d.success) throw new Error(d.error || 'backtest impossible');
      setRes(d);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const r2 = x => (Number.isFinite(x) ? x.toFixed(2) : '—');
  const bloc = (titre, table) => {
    if (!table || !Object.keys(table).length) return null;
    return (
      <div style={{ marginTop:12 }}>
        <div style={{ fontSize:12, color:'var(--muted)', marginBottom:6 }}>{titre}</div>
        <div style={{ display:'grid', gap:3 }}>
          {Object.entries(table).sort((a, b) => b[1].total - a[1].total).slice(0, 8).map(([k, v]) => (
            <div key={k} style={{ display:'flex', alignItems:'center', gap:10, fontSize:11.5 }}>
              <span style={{ flex:'1 1 200px', color:'#e2e8f0' }}>{String(k).slice(0, 46)}</span>
              <span style={{ color:'var(--dim)', minWidth:52 }}>{v.total} prise(s)</span>
              <span style={{ color:'#34d399' }}>{v.gagnes}✓</span>
              <span style={{ color:'#f87171' }}>{v.perdus}✗</span>
              <span style={{ color:'#fbbf24', minWidth:30 }}>{v.be}BE</span>
              <span style={{ color: (v.tauxReussite ?? 0) >= 50 ? '#34d399' : '#fbbf24', minWidth:48, textAlign:'right' }}>
                {v.tauxReussite === null ? '—' : v.tauxReussite + ' %'}
              </span>
              <span style={{ color: v.r >= 0 ? '#34d399' : '#f87171', minWidth:60, textAlign:'right' }}>
                {v.r >= 0 ? '+' : ''}{r2(v.r)} R
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="panel" style={{ padding:'14px 18px', marginBottom:16 }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap', marginBottom:10 }}>
        <i className="fas fa-flask" style={{ color:'#a78bfa' }}></i>
        <b style={{ fontSize:13.5, color:'#fff' }}>Backtest — le moteur rejoué sur l'historique</b>
        <span className="badge" style={{ fontSize:10, background:'rgba(167,139,250,.14)', color:'#c4b5fd' }}>
          coût IA : 0
        </span>
      </div>
      <p style={{ margin:'0 0 12px', fontSize:12.5, color:'var(--muted)' }}>
        Chaque bougie est jugée avec le passé seulement, puis le signal est suivi jusqu'à son
        objectif, son invalidation ou son retour à l'entrée. Même code que le direct.
      </p>

      <div style={{ display:'flex', gap:9, alignItems:'center', flexWrap:'wrap' }}>
        <select className="fld" aria-label="Marché du backtest"
          style={{ width:'auto', maxWidth:'100%', fontSize:12 }}
          value={`${cles.provider}|${cles.symbol}`}
          onChange={e => {
            const [provider, symbol] = e.target.value.split('|');
            setCles({ provider, symbol });
          }}>
          {(marches.length ? marches : [{ symbol:'BTCUSDT', provider:'binance', label:'BTC / USD', providerLabel:'Binance' }])
            .map(m => (
              <option key={`${m.provider}|${m.symbol}`} value={`${m.provider}|${m.symbol}`}>
                {m.providerLabel ? `${m.providerLabel} · ` : ''}{m.label || m.symbol}
              </option>
            ))}
        </select>
        <select className="fld" aria-label="Unité de temps du backtest" style={{ width:90, fontSize:12 }} value={tf} onChange={e => setTf(e.target.value)}>
          {['1m','5m','15m','30m','1h','4h','1d'].map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className="fld" aria-label="Pas d'évaluation" style={{ width:150, fontSize:12 }} value={pas} onChange={e => setPas(Number(e.target.value))}>
          <option value={1}>pas 1 (précis, lent)</option>
          <option value={2}>pas 2 (recommandé)</option>
          <option value={3}>pas 3 (rapide)</option>
        </select>
        <button className="btn sm" onClick={lancer} disabled={busy}>
          {busy ? <Spinner /> : <i className="fas fa-play"></i>} Lancer le backtest
        </button>
        {res && (
          <span style={{ fontSize:11.5, color:'var(--dim)' }}>
            {res.bougies} bougies · {res.evaluations} évaluations · {res.ignoresDoublons} doublon(s) évité(s)
            {Number.isFinite(res.types) && ` · ${res.types} type(s) de configuration`}
            {Number.isFinite(res.concentrationTop3) && ` · top 3 = ${res.concentrationTop3} % des prises`}
          </span>
        )}
      </div>

      {/* Un backtest sur quelques dizaines de bougies n'est pas un résultat :
          c'est une anecdote. Le dire AU-DESSUS des chiffres, pas en bas de page —
          93 bougies en 15m, c'est 23 heures d'or, et « −0,13 R » n'y a aucun
          poids statistique. */}
      {res && res.fiable === false && (
        <div style={{ marginTop:10, fontSize:12, color:'#fbbf24', padding:'8px 10px', borderRadius:8,
          background:'rgba(245,158,11,.08)', border:'1px solid rgba(245,158,11,.25)' }}>
          <i className="fas fa-triangle-exclamation" style={{ marginRight:7 }}></i>
          <b>Échantillon trop court pour conclure.</b> {res.bougies} bougies
          {res.demandees ? ` (${res.demandees} demandées, le courtier en a rendu ${res.bougies})` : ''}
          {Number.isFinite(res.types) ? ` · ${res.types} type(s) de configuration` : ''} —
          les chiffres ci-dessous décrivent ces bougies, pas le marché. Choisis une unité
          de temps plus grande ou un historique plus long.
        </div>
      )}

      {err && <div style={{ marginTop:10, fontSize:12.5, color:'#fca5a5' }}>{err}</div>}

      {res && res.indisponible && (
        <div style={{ marginTop:10, fontSize:12.5, color:'var(--muted)' }}>{res.raison}</div>
      )}

      {res && !res.indisponible && (
        <>
          <div style={{ display:'flex', gap:22, flexWrap:'wrap', marginTop:14, fontSize:13 }}>
            <span><span style={{ color:'var(--muted)' }}>Prises </span><b>{res.clos}</b></span>
            <span><span style={{ color:'var(--muted)' }}>Objectifs </span><b style={{ color:'#34d399' }}>{res.gagnes}</b></span>
            <span><span style={{ color:'var(--muted)' }}>Stops </span><b style={{ color:'#f87171' }}>{res.perdus}</b></span>
            <span><span style={{ color:'var(--muted)' }}>BE </span><b style={{ color:'#fbbf24' }}>{res.be}</b></span>
            <span><span style={{ color:'var(--muted)' }}>Réussite </span>
              <b style={{ color: (res.tauxReussite ?? 0) >= 50 ? '#34d399' : '#fbbf24' }}>
                {res.tauxReussite === null ? '—' : res.tauxReussite + ' %'}
              </b></span>
            <span title={fraisActifs
              ? 'Gain/perte moyen par prise, frais déduits.'
              : 'Gain/perte moyen par prise AVANT frais : aucun frais n’est configuré.'}>
              <span style={{ color:'var(--muted)' }}>{fraisActifs ? 'Espérance nette ' : 'Espérance BRUTE '}</span>
              <b style={{ color: res.esperance >= 0 ? '#34d399' : '#f87171' }}>
                {res.esperance >= 0 ? '+' : ''}{r2(res.esperance)} R
              </b>
            </span>
            <span><span style={{ color:'var(--muted)' }}>{fraisActifs ? 'Total ' : 'Total brut '}</span>
              <b style={{ color: res.rTotal >= 0 ? '#34d399' : '#f87171' }}>
                {res.rTotal >= 0 ? '+' : ''}{r2(res.rTotal)} R
              </b></span>
            <span style={{ color: 'var(--dim)' }}>{res.enCours} encore en cours (exclues)</span>
          </div>

          {/* Frais : sans eux, un R positif est BRUT. On l'écrit, au lieu de le
              laisser passer pour un résultat net. `coutCritique` est le coût par
              prise qui annulerait l'avantage — c'est le seul chiffre qui permette
              de juger si les frais du courtier laissent quelque chose. */}
          <div style={{ marginTop: 9, fontSize: 12, lineHeight: 1.5,
            color: fraisActifs ? 'var(--muted)' : '#fbbf24' }}>
            <i className={`fas ${fraisActifs ? 'fa-receipt' : 'fa-triangle-exclamation'}`}
              style={{ marginRight: 6 }}></i>
            {fraisActifs
              ? <>Frais appliqués : <b>{r2(res.fraisMoyenR)} R</b> par prise. Les chiffres ci-dessus sont nets.</>
              : <>Aucun frais n’est configuré : les chiffres ci-dessus sont <b>BRUTS</b>.
                  Cet avantage survit tant que le coût réel reste sous{' '}
                  <b>{r2(res.coutCritique)} R</b> par prise — au-delà, il disparaît.</>}
          </div>

          {/* Sur un indice synthétique, un résultat positif ne prouve rien.
              Deriv le dit lui-même : ces séries sortent d'un générateur
              aléatoire cryptographique. Afficher « +67 R » sans ce cadre
              reviendrait à vendre du bruit comme une compétence. */}
          {res.instrument && res.instrument.synthetique && (
            <div style={{ marginTop:8, fontSize:11.5, padding:'8px 10px', borderRadius:7,
              background:'rgba(239,68,68,.08)', border:'1px solid rgba(239,68,68,.35)', color:'#fca5a5' }}>
              <i className="fas fa-dice" style={{ marginRight:7 }}></i>
              <b>Instrument synthétique.</b> {res.instrument.avertissement}
            </div>
          )}

          {/* La convention de gestion partielle, dite à voix haute.
              Elle est DÉSACTIVÉE par défaut : mesuré sur 2 ans de données
              réelles, elle fabrique 71 % du résultat BTC et 139 % de celui de
              l'or — sans elle, l'or devient perdant. L'écart est chiffré ici
              pour que l'hypothèse reste visible, jamais implicite. */}
          {Number.isFinite(res.beTheorique) && res.beTheorique !== 0 && (
            <div style={{ marginTop:8, fontSize:11.5, padding:'7px 10px', borderRadius:7,
              background:'rgba(148,163,184,.06)', border:'1px solid rgba(148,163,184,.2)',
              color:'var(--dim)' }}>
              <i className="fas fa-scale-unbalanced" style={{ marginRight:7 }}></i>
              {res.gestionPartielle ? (
                <>
                  <b>Gestion partielle activée.</b> Un BE (objectif 1 touché puis retour à l'entrée)
                  est crédité de la moitié du premier objectif : <b>+{r2(res.beSomme)} R</b> sur
                  {' '}{res.be || 0} trade(s). Sans cette hypothèse : <b>{r2(res.rTotalSansGestion)} R</b>.
                </>
              ) : (
                <>
                  <b>Gestion partielle désactivée</b> — un BE vaut 0 R. Si on créditait la moitié du
                  premier objectif, le total passerait à <b>{r2(res.rTotal + res.beTheorique)} R</b>
                  {' '}(soit +{r2(res.beTheorique)} R d'hypothèse). Ce n'est pas une mesure : aucune
                  sortie partielle n'est simulée dans les frais.
                </>
              )}
            </div>
          )}

          {res.courbeR && res.courbeR.length > 1 && (() => {
            const max = Math.max(...res.courbeR.map(Math.abs), 1);
            const pts = res.courbeR;
            const pasE = Math.max(1, Math.floor(pts.length / 60));
            return (
              <div style={{ marginTop:12 }}>
                <div style={{ fontSize:12, color:'var(--muted)', marginBottom:5 }}>Capital cumulé en R</div>
                <div style={{ display:'flex', alignItems:'flex-end', gap:1, height:44,
                  padding:'0 2px', background:'rgba(148,163,184,.05)', borderRadius:6 }}>
                  {pts.filter((_, i) => i % pasE === 0 || i === pts.length - 1).map((v, i) => (
                    <span key={i} title={`${v} R`} style={{
                      flex:'1 1 auto', minWidth:1,
                      height: `${Math.max(2, (Math.abs(v) / max) * 100)}%`,
                      background: v >= 0 ? 'rgba(52,211,153,.75)' : 'rgba(248,113,113,.75)',
                      alignSelf: v >= 0 ? 'flex-end' : 'flex-start'
                    }}></span>
                  ))}
                </div>
                <div style={{ display:'flex', justifyContent:'space-between', fontSize:10.5, color:'var(--dim)', marginTop:3 }}>
                  <span>début</span><span>{r2(res.courbeR[res.courbeR.length - 1])} R</span><span>fin</span>
                </div>
              </div>
            );
          })()}

          {bloc('Par source', res.parSource)}
          {bloc('Par stratégie / concept', res.parStrategie)}
          <div style={{ marginTop:10, fontSize:11, color:'var(--dim)', lineHeight:1.6 }}>
            Une prise = un signal retenu au moment de son émission. Les signaux encore ouverts à la
            fin de l'historique sont exclus du taux. Le taux ne compte que les objectifs atteints
            face aux stops : les BE et les expirations sont affichés à part.
          </div>
        </>
      )}
    </div>
  );
}

// ── Actualités et calendrier économique ────────────────────────────────
// Le contexte extérieur du marché : ce qui se dit (dépêches) et ce qui tombe
// (annonces). Une annonce d'inflation décroche un stop en une bougie, et le
// graphique ne l'avait pas dit.
function NewsPage() {
  const [data, setData] = useState(null);
  const [marche, setMarche] = useState('tout');
  const [impact, setImpact] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // Impact directionnel par dépêche (ACHAT / VENTE / NEUTRE), indexé par titre
  // normalisé. Vient du cache serveur : aucune dépêche n'est réanalysée.
  const [impacts, setImpacts] = useState({});
  const [busyImpact, setBusyImpact] = useState(false);

  const chargerImpactCache = async () => {
    try {
      const d = await (await api('/news/impact')).json();
      if (d.success && d.parTitre) setImpacts(d.parTitre);
    } catch (e) { /* sans cache, les badges restent absents — rien d'inventé */ }
  };
  useEffect(() => { chargerImpactCache(); }, []);

  const normTitre = t => String(t || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const impactDe = a => impacts[normTitre(a.titre)] || null;

  const interpreterImpact = async () => {
    const liste = ((data && data.articles) || []).slice(0, 12)
      .map(a => ({ titre: a.titre, resume: a.resume, source: a.source, sourceId: a.sourceId, actifs: a.actifs }));
    if (!liste.length) return;
    setBusyImpact(true); setErr('');
    try {
      const d = await (await api('/news/impact', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ articles: liste })
      })).json();
      if (!d.success) throw new Error(d.error || 'interprétation impossible');
      if (d.parTitre) setImpacts(d.parTitre);
    } catch (e) { setErr(e.message); }
    finally { setBusyImpact(false); }
  };

  const charger = async (force = false) => {
    setBusy(true); setErr('');
    try {
      const q = `?marche=${marche}&impact=${impact}${force ? '&force=1' : ''}`;
      const d = await (await api('/news/panorama' + q)).json();
      if (!d.success) throw new Error(d.error || 'flux indisponible');
      setData(d);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };
  useEffect(() => { charger(); }, [marche, impact]);

  const ilYA = ts => {
    if (!Number.isFinite(ts)) return '';
    const m = Math.round((Date.now() - ts) / 60000);
    if (m < 1) return "à l'instant";
    if (m < 60) return `il y a ${m} min`;
    const h = Math.round(m / 60);
    if (h < 24) return `il y a ${h} h`;
    return `il y a ${Math.round(h / 24)} j`;
  };
  const heure = ts => Number.isFinite(ts)
    ? new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    : '—';
  const jourLisible = j => {
    const d = new Date(j + 'T12:00:00');
    const auj = new Date().toISOString().slice(0, 10);
    if (j === auj) return "Aujourd'hui";
    const demain = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    if (j === demain) return 'Demain';
    return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' });
  };
  const teinteImpact = n => n === 3 ? '#f87171' : n === 2 ? '#fbbf24' : '#94a3b8';

  const articles = (data && data.articles) || [];
  const jours = (data && data.calendrier) || [];
  const prochaines = (data && data.prochaines24h) || [];
  const elevees = prochaines.filter(e => e.impactNiveau >= 3);

  return (
    <div style={{ display:'grid', gap:16 }}>
      <div className="panel" style={{ padding:'14px 18px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
          <i className="fas fa-newspaper" style={{ color:'#60a5fa' }}></i>
          <b style={{ fontSize:13.5, color:'#fff' }}>Actualités et calendrier économique</b>
          <span className="badge" style={{ fontSize:10, background:'rgba(52,211,153,.14)', color:'#34d399' }}
            title="Flux RSS publics et calendrier ForexFactory : aucune clé, aucun abonnement.">
            sources gratuites
          </span>
          {data && data.etat && data.etat.fluxAt && (
            <span style={{ fontSize:11, color:'var(--dim)' }}>dépêches {ilYA(data.etat.fluxAt)}</span>
          )}
          {data && data.etat && data.etat.degrade && (
            <span className="badge" style={{ fontSize:10, background:'rgba(245,158,11,.14)', color:'#fbbf24' }}>
              flux partiel — dernier état conservé
            </span>
          )}
          <span style={{ flex:'1 1 auto' }}></span>
          <button className="btn ghost sm" onClick={interpreterImpact}
            disabled={busyImpact || !articles.length}
            title="Chaque dépêche reçoit un sens exploitable (ACHAT / VENTE / NEUTRE) et sa raison. Calculé une seule fois puis mémorisé.">
            {busyImpact ? <Spinner /> : <i className="fas fa-wand-magic-sparkles"></i>}
            {busyImpact ? 'Interprétation…' : 'Interpréter l\'impact'}
          </button>
          <button className="btn ghost sm" onClick={() => charger(true)} disabled={busy}>
            {busy ? <Spinner /> : <i className="fas fa-rotate"></i>} Actualiser
          </button>
        </div>

        {/* Ce qui peut décrocher un stop dans les 24 h : la seule ligne qui doit
            être vue avant d'ouvrir un trade. */}
        {prochaines.length > 0 && (
          <div style={{ marginTop:11, padding:'9px 12px', borderRadius:9,
            background: elevees.length ? 'rgba(248,113,113,.08)' : 'rgba(148,163,184,.06)',
            border: `1px solid ${elevees.length ? 'rgba(248,113,113,.35)' : 'rgba(148,163,184,.16)'}` }}>
            <div style={{ fontSize:12.5, color: elevees.length ? '#fca5a5' : 'var(--muted)' }}>
              <i className="fas fa-triangle-exclamation" style={{ marginRight:7 }}></i>
              <b>Dans les 24 h :</b> {prochaines.length} annonce(s)
              {elevees.length > 0 && <> dont <b style={{ color:'#f87171' }}>{elevees.length} à impact élevé</b></>}
            </div>
            <div style={{ display:'flex', gap:12, flexWrap:'wrap', marginTop:5, fontSize:11.5 }}>
              {prochaines.slice(0, 5).map((e, i) => (
                <span key={i} style={{ color:'var(--muted)' }}>
                  <span style={{ color: teinteImpact(e.impactNiveau) }}>●</span>{' '}
                  {heure(e.date)} · {e.devise || e.pays || '—'} · {e.titre.slice(0, 44)}
                </span>
              ))}
            </div>
          </div>
        )}

        <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginTop:11 }}>
          {[['tout','Tout'],['crypto','Crypto'],['forex','Forex'],['macro','Macro']].map(([id, label]) => (
            <button key={id} className="btn ghost sm" onClick={() => setMarche(id)}
              style={{ borderColor: marche === id ? 'rgba(96,165,250,.55)' : undefined,
                color: marche === id ? '#93c5fd' : undefined }}>
              {label}
            </button>
          ))}
          <span style={{ width:1, background:'rgba(148,163,184,.2)', margin:'0 4px' }}></span>
          {[[0,'Tout impact'],[2,'Moyen et +'],[3,'Élevé']].map(([n, label]) => (
            <button key={n} className="btn ghost sm" onClick={() => setImpact(n)}
              style={{ borderColor: impact === n ? 'rgba(245,158,11,.55)' : undefined,
                color: impact === n ? '#fbbf24' : undefined }}>
              {label}
            </button>
          ))}
        </div>

        {err && <div style={{ marginTop:10, fontSize:12.5, color:'#fca5a5' }}>{err}</div>}
      </div>

      <div style={{ display:'grid', gap:16, gridTemplateColumns:'repeat(auto-fit,minmax(340px,1fr))' }}>
        {/* Dépêches */}
        <div className="panel" style={{ padding:'14px 18px' }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
            <i className="fas fa-rss" style={{ color:'#f59e0b' }}></i>
            <b style={{ fontSize:13, color:'#fff' }}>Dépêches ({articles.length})</b>
          </div>
          {articles.length === 0 && (
            <div style={{ fontSize:12.5, color:'var(--muted)' }}>
              Aucune dépêche pour ce filtre. Les flux publics répondent parfois lentement : réessaie dans un instant.
            </div>
          )}
          <div style={{ display:'grid', gap:7, maxHeight:620, overflowY:'auto' }}>
            {articles.map((a, i) => (
              <a key={i} href={a.lien} target="_blank" rel="noopener noreferrer"
                style={{ display:'block', padding:'8px 10px', borderRadius:8, textDecoration:'none',
                  background:'rgba(148,163,184,.04)', border:'1px solid rgba(148,163,184,.12)' }}>
                <div style={{ display:'flex', alignItems:'center', gap:7, flexWrap:'wrap', marginBottom:3 }}>
                  <span className="badge" style={{ fontSize:9, background:'rgba(148,163,184,.14)', color:'var(--muted)' }}>
                    {a.source}
                  </span>
                  <span style={{ fontSize:10.5, color:'var(--dim)' }}>{ilYA(a.date)}</span>
                  {a.impact && (
                    <span className="badge" style={{ fontSize:9, background:'rgba(245,158,11,.14)', color:'#fbbf24' }}
                      title="Le texte contient un mot-clé à fort retentissement (CPI, FOMC, hack, ETF…)">
                      à impact
                    </span>
                  )}
                  {(a.actifs || []).map(x => (
                    <span key={x} className="tag" style={{ fontSize:9 }}>{x}</span>
                  ))}
                  {(() => {
                    const im = impactDe(a);
                    if (!im) return null;
                    const col = im.sens === 'ACHAT' ? '#34d399' : im.sens === 'VENTE' ? '#f87171' : '#94a3b8';
                    const bg = im.sens === 'ACHAT' ? 'rgba(34,211,138,.16)' : im.sens === 'VENTE' ? 'rgba(242,84,91,.16)' : 'rgba(148,163,184,.14)';
                    const ico = im.sens === 'ACHAT' ? 'fa-arrow-trend-up' : im.sens === 'VENTE' ? 'fa-arrow-trend-down' : 'fa-minus';
                    return (
                      <span className="badge" style={{ fontSize:9.5, background:bg, color:col }}
                        title={`${im.raison || 'impact estimé'}${im.force != null ? ` · force ${im.force}/1` : ''}`}>
                        <i className={`fas ${ico}`} style={{ fontSize:8 }}></i>{im.sens}
                      </span>
                    );
                  })()}
                </div>
                <div style={{ fontSize:12.5, color:'#e2e8f0', lineHeight:1.45 }}>{a.titre}</div>
              </a>
            ))}
          </div>
        </div>

        {/* Calendrier */}
        <div className="panel" style={{ padding:'14px 18px' }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
            <i className="fas fa-calendar-day" style={{ color:'#a78bfa' }}></i>
            <b style={{ fontSize:13, color:'#fff' }}>Calendrier économique</b>
            <span style={{ fontSize:10.5, color:'var(--dim)' }}>heures locales</span>
          </div>
          {jours.length === 0 && (
            <div style={{ fontSize:12.5, color:'var(--muted)' }}>
              Calendrier indisponible pour l'instant : la source publique limite les
              requêtes (HTTP 429). L'app réessaiera automatiquement, sans te bloquer.
              {(data && data.etat && data.etat.erreurs && data.etat.erreurs.length > 0) && (
                <div style={{ marginTop:6, fontSize:11.5, color:'var(--dim)' }}>
                  détail : {data.etat.erreurs.join(' · ')}
                </div>
              )}
            </div>
          )}
          <div style={{ display:'grid', gap:12, maxHeight:620, overflowY:'auto' }}>
            {jours.map(j => (
              <div key={j.jour}>
                <div style={{ fontSize:11.5, color:'var(--muted)', textTransform:'capitalize', marginBottom:5 }}>
                  {jourLisible(j.jour)}
                </div>
                <div style={{ display:'grid', gap:4 }}>
                  {j.evenements.map((e, i) => (
                    <div key={i} style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap',
                      fontSize:11.5, padding:'4px 7px', borderRadius:6,
                      background: e.impactNiveau >= 3 ? 'rgba(248,113,113,.06)' : 'transparent' }}>
                      <span style={{ color:'var(--dim)', minWidth:42 }}>{heure(e.date)}</span>
                      <span style={{ color: teinteImpact(e.impactNiveau), minWidth:8 }}>●</span>
                      <span style={{ color:'var(--muted)', minWidth:34 }}>{e.devise || e.pays || '—'}</span>
                      <span style={{ flex:'1 1 140px', color:'#e2e8f0' }}>{e.titre}</span>
                      {e.reel && <span style={{ color:'#34d399' }}>réel {e.reel}</span>}
                      {!e.reel && e.prevision && <span style={{ color:'var(--dim)' }}>prév. {e.prevision}</span>}
                      {e.precedent && <span style={{ color:'var(--dim)' }}>préc. {e.precedent}</span>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Journal({ prefill, onPrefillUsed, strategies = [] }) {
  const [trades, setTrades] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ pair:'', direction:'BUY', entry:'', sl:'', tp:'', size:'', notes:'' });
  const [closing, setClosing] = useState({});
  const [picked, setPicked] = useState([]);            // stratégies liées au trade
  const [originId, setOriginId] = useState(null);      // analyse d'origine
  const [filter, setFilter] = useState({ q:'', result:'all' });
  // Contexte de marché attaché au trade : d'où vient le prix, sur quelle unité
  // de temps, et quel signal était en cours. Sans ça, les statistiques ne
  // peuvent pas dire sur QUEL marché on gagne.
  const [market, setMarket] = useState({ timeframe:'', provider:'', providerLabel:'', signalStatus:'', signalStrength:null });

  // Une seule façon de dessiner une ligne de statistique : barre de réussite,
  // compte et PnL. Évite que chaque tableau réinvente la sienne.
  const StatRow = ({ s }) => (
    <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
      <span style={{ flex:'1 1 220px', fontSize:13, color:'#fff' }}>{s.label}</span>
      <span style={{ width:160, height:8, background:'rgba(148,163,184,.18)', borderRadius:99, overflow:'hidden' }}>
        <span style={{ display:'block', height:'100%', width:`${s.winRate || 0}%`,
          background: (s.winRate || 0) >= 50 ? '#10b981' : '#f59e0b' }}></span>
      </span>
      <span style={{ fontSize:12.5, color:'var(--muted)', minWidth:150, textAlign:'right' }}>
        {s.wins}/{s.trades} · {s.winRate === null ? '—' : s.winRate + ' %'}
        {s.pnl ? <> · PnL {n6(s.pnl)}</> : null}
      </span>
    </div>
  );

  // Report d'un plan vers le journal (bouton « Enregistrer ce trade » / « ce signal »)
  useEffect(() => {
    if (!prefill) return;
    setForm(f => ({
      ...f,
      pair: prefill.pair || f.pair,
      direction: prefill.direction || f.direction,
      entry: prefill.entry !== undefined && prefill.entry !== null ? String(prefill.entry) : f.entry,
      sl: prefill.sl !== undefined && prefill.sl !== null ? String(prefill.sl) : f.sl,
      tp: prefill.tp !== undefined && prefill.tp !== null ? String(prefill.tp) : f.tp,
      notes: prefill.notes || f.notes
    }));
    setMarket({
      timeframe: prefill.timeframe || '',
      provider: prefill.provider || '',
      providerLabel: prefill.providerLabel || '',
      signalStatus: prefill.signalStatus || '',
      signalStrength: prefill.signalStrength !== undefined ? prefill.signalStrength : null
    });
    setPicked(prefill.strategyIds || []);
    setOriginId(prefill.originAnalysisId || null);
    setFilter({ q:'', result:'all' });
    setErr('');
    if (onPrefillUsed) onPrefillUsed();
  }, [prefill]);

  const load = async () => {
    try {
      const r = await api('/trades');
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Chargement impossible');
      setTrades(d.trades || []); setStats(d.stats || null); setErr('');
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const create = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const r = await api('/trades', {
        method:'POST', headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ ...form, strategyIds: picked, originAnalysisId: originId,
          timeframe: market.timeframe, provider: market.provider,
          providerLabel: market.providerLabel, signalStatus: market.signalStatus,
          signalStrength: market.signalStrength })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Création refusée');
      setForm({ pair:'', direction:'BUY', entry:'', sl:'', tp:'', size:'', notes:'' });
      setPicked([]); setOriginId(null);
      setMarket({ timeframe:'', provider:'', providerLabel:'', signalStatus:'', signalStrength:null });
      await load();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const doClose = async (id) => {
    const c = closing[id] || {};
    if (c.exit === undefined || c.exit === '') { setErr('Renseigne le prix de sortie pour clôturer'); return; }
    setBusy(true); setErr('');
    try {
      const payload = { action:'close', exit:c.exit };
      if (c.pnl !== undefined && c.pnl !== '') payload.pnl = c.pnl;
      const r = await api(`/trades/${id}`, {
        method:'PATCH', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(payload)
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Clôture refusée');
      setClosing(s => { const n = { ...s }; delete n[id]; return n; });
      await load();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const del = async (id) => { await api(`/trades/${id}`, { method:'DELETE' }); load(); };

  const n2 = v => (v === null || v === undefined ? '—' : Number(v).toFixed(2));
  const n6 = v => (v === null || v === undefined ? '—' : Number(v).toFixed(v % 1 === 0 ? 0 : 4));

  // Filtre local : recherche par paire/notes + résultat
  const matches = t => {
    const q = filter.q.trim().toLowerCase();
    if (q && !`${t.pair} ${t.notes || ''}`.toLowerCase().includes(q)) return false;
    if (filter.result === 'all') return true;
    if (filter.result === 'open') return t.status === 'open';
    return t.status === 'closed' && t.result === filter.result;
  };
  const open = trades.filter(t => t.status === 'open' && matches(t));
  const closed = trades.filter(t => t.status === 'closed' && matches(t));
  const filtered = filter.q.trim() !== '' || filter.result !== 'all';

  const stratTitle = id => (strategies.find(s => s.id === id) || {}).title || id;

  if (loading) return <div className="panel" style={{ padding:22 }}><Skeleton h={120} /></div>;

  return (
    <>
      {/* Le devenir des signaux du moteur, en tête du journal : c'est la seule
          partie qui ne dépend pas d'une saisie manuelle. */}
      <StatutDirectPanel />
      <JournalSignauxPanel />
      <BacktestPanel />

      <div className="stat-grid" style={{ marginBottom:18 }}>
        <StatTile icon="fa-receipt" label="Trades enregistrés" value={stats?.total || 0} color="#60a5fa" delay={0} />
        <StatTile icon="fa-bullseye" label="Taux de réussite" value={stats?.winRate ?? 0} decimals={1} suffix=" %" color="#34d399" delay={70} />
        <StatTile icon="fa-scale-balanced" label="PnL cumulé" value={stats?.pnlTotal ?? 0} decimals={2} color="#f59e0b" delay={140} />
        <StatTile icon="fa-wave-square" label="RR moyen" value={stats?.rrAvg ?? 0} decimals={2} color="var(--accent2)" delay={210} />
      </div>

      {stats && (stats.wins > 0 || stats.losses > 0) && (
        <div className="panel" style={{ padding:'14px 18px', marginBottom:16, display:'flex',
          flexWrap:'wrap', gap:18, alignItems:'center', fontSize:13 }}>
          <span style={{ color:'#34d399' }}><i className="fas fa-check" style={{marginRight:6}}></i>{stats.wins} gain(s)</span>
          <span style={{ color:'#ef4444' }}><i className="fas fa-xmark" style={{marginRight:6}}></i>{stats.losses} perte(s)</span>
          <span style={{ color:'var(--muted)' }}><i className="fas fa-equals" style={{marginRight:6}}></i>{stats.breakeven} neutre(s)</span>
          <span style={{ color:'var(--muted)' }}><i className="fas fa-layer-group" style={{marginRight:6}}></i>{stats.open} en cours</span>
          {stats.streak && (
            <span style={{ color: stats.streak.type === 'win' ? '#34d399' : '#ef4444' }}>
              <i className="fas fa-fire" style={{marginRight:6}}></i>série : {stats.streak.count} {stats.streak.type === 'win' ? 'gain(s)' : 'perte(s)'}
            </span>
          )}
        </div>
      )}

      <div className="panel" style={{ padding:'12px 14px', marginBottom:16, display:'flex',
        gap:10, alignItems:'center', flexWrap:'wrap' }}>
        <i className="fas fa-filter" style={{ color:'var(--muted)' }}></i>
        <input className="fld" style={{ flex:'1 1 190px', minWidth:150 }}
          placeholder="Filtrer par paire ou note…"
          value={filter.q} onChange={e=>setFilter({ ...filter, q:e.target.value })} />
        <select className="fld" aria-label="Filtrer les trades par résultat" style={{ width:150 }} value={filter.result}
          onChange={e=>setFilter({ ...filter, result:e.target.value })}>
          <option value="all">Tous</option>
          <option value="open">En cours</option>
          <option value="win">Gains</option>
          <option value="loss">Pertes</option>
          <option value="breakeven">Neutres</option>
        </select>
        {filtered && <span style={{ fontSize:12.5, color:'var(--muted)' }}>
          {open.length + closed.length} / {trades.length}
        </span>}
        <span style={{ flex:'1 1 auto' }}></span>
        <a className="btn ghost sm" href="/api/trades/export?format=csv" download
          title="Télécharger le journal complet en CSV (Excel)">
          <i className="fas fa-file-csv"></i>CSV
        </a>
        <a className="btn ghost sm" href="/api/trades/export?format=json" download
          title="Télécharger le journal complet en JSON">
          <i className="fas fa-file-code"></i>JSON
        </a>
      </div>

      {err && (
        <div className="panel" style={{ padding:'12px 16px', marginBottom:16,
          borderColor:'rgba(239,68,68,.45)', color:'#fca5a5', fontSize:13 }}>
          <i className="fas fa-triangle-exclamation" style={{ marginRight:8 }}></i>{err}
        </div>
      )}

      <div className="panel" style={{ padding:20, marginBottom:16 }}>
        <h3 style={{ margin:'0 0 4px', fontSize:15 }}>Nouveau trade</h3>
        <p style={{ margin:'0 0 14px', color:'var(--muted)', fontSize:12.5 }}>
          Enregistre ce que tu prends réellement. Le résultat est déduit du prix de sortie.
        </p>
        <form onSubmit={create} style={{ display:'grid', gap:12,
          gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))' }}>
          <label style={{ display:'grid', gap:5, fontSize:12, color:'var(--muted)' }}>Paire
            <input className="fld" value={form.pair} placeholder="XAUUSD"
              onChange={e=>setForm({...form, pair:e.target.value.toUpperCase()})} /></label>
          <label style={{ display:'grid', gap:5, fontSize:12, color:'var(--muted)' }}>Sens
            <select className="fld" aria-label="Direction du trade" value={form.direction} onChange={e=>setForm({...form, direction:e.target.value})}>
              <option value="BUY">BUY</option><option value="SELL">SELL</option>
            </select></label>
          <label style={{ display:'grid', gap:5, fontSize:12, color:'var(--muted)' }}>Entrée
            <input className="fld" inputMode="decimal" value={form.entry} placeholder="4700"
              onChange={e=>setForm({...form, entry:e.target.value})} /></label>
          <label style={{ display:'grid', gap:5, fontSize:12, color:'var(--muted)' }}>Stop loss
            <input className="fld" inputMode="decimal" value={form.sl} placeholder="4690"
              onChange={e=>setForm({...form, sl:e.target.value})} /></label>
          <label style={{ display:'grid', gap:5, fontSize:12, color:'var(--muted)' }}>Take profit
            <input className="fld" inputMode="decimal" value={form.tp} placeholder="4720"
              onChange={e=>setForm({...form, tp:e.target.value})} /></label>
          <label style={{ display:'grid', gap:5, fontSize:12, color:'var(--muted)' }}>Taille
            <input className="fld" inputMode="decimal" value={form.size} placeholder="0.5"
              onChange={e=>setForm({...form, size:e.target.value})} /></label>
          <div style={{ display:'flex', alignItems:'flex-end' }}>
            <button className="btn" type="submit" disabled={busy} style={{ width:'100%' }}>
              {busy ? <Spinner/> : <><i className="fas fa-plus"></i>Enregistrer</>}
            </button>
          </div>
        </form>
        <label style={{ display:'grid', gap:5, fontSize:12, color:'var(--muted)', marginTop:12 }}>Notes
          <textarea className="fld" rows="2" value={form.notes} placeholder="Contexte, raison du trade…"
            onChange={e=>setForm({...form, notes:e.target.value})} /></label>

        {strategies.length > 0 && (
          <div style={{ marginTop:12 }}>
            <label style={{ fontSize:12, color:'var(--muted)' }}>
              Stratégies appliquées
              <span style={{ color:'var(--dim)' }}> — alimente « Réussite par stratégie »</span>
            </label>
            <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginTop:7,
              maxHeight:118, overflowY:'auto' }}>
              {strategies.map(s => {
                const on = picked.includes(s.id);
                return (
                  <button key={s.id} type="button" className="tag"
                    onClick={()=>setPicked(p => on ? p.filter(x => x !== s.id) : [...p, s.id])}
                    style={on
                      ? { background:'rgba(37,99,235,.24)', borderColor:'rgba(37,99,235,.65)', color:'#fff' }
                      : { cursor:'pointer' }}
                    title={s.title + (s.type ? ` (${s.type})` : '')}>
                    {on && <i className="fas fa-check" style={{ marginRight:5 }}></i>}
                    {String(s.title || '').slice(0, 38)}
                  </button>
                );
              })}
            </div>
            {originId && (
              <p style={{ margin:'8px 0 0', fontSize:12, color:'var(--muted)' }}>
                <i className="fas fa-link" style={{ marginRight:6 }}></i>
                Lié à l'analyse d'origine
              </p>
            )}
          </div>
        )}
        {(() => {
          const e0 = parseFloat(String(form.entry).replace(',','.'));
          const s0 = parseFloat(String(form.sl).replace(',','.'));
          const t0 = parseFloat(String(form.tp).replace(',','.'));
          if (!isFinite(e0) || !isFinite(s0)) return null;
          const risk = Math.abs(e0 - s0);
          const rr = isFinite(t0) ? (Math.abs(t0 - e0) / risk) : null;
          return <p style={{ margin:'12px 0 0', fontSize:12.5, color:'var(--muted)' }}>
            Risque par unité : <b style={{color:'#fff'}}>{risk.toFixed(4)}</b>
            {rr !== null && <> · Ratio prévu : <b style={{color:'#fff'}}>{rr.toFixed(2)}R</b></>}
          </p>;
        })()}
      </div>

      {open.length > 0 && (
        <div className="panel" style={{ padding:20, marginBottom:16 }}>
          <h3 style={{ margin:'0 0 14px', fontSize:15 }}>
            Positions en cours <span className="badge" style={{ marginLeft:8 }}>{open.length}</span>
          </h3>
          <div style={{ display:'grid', gap:10 }}>
            {open.map(t => (
              <div key={t.id} className="card" style={{ padding:'12px 14px' }}>
                <div style={{ display:'flex', flexWrap:'wrap', gap:10, alignItems:'center',
                  justifyContent:'space-between' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
                    <b style={{ color:'#fff' }}>{t.pair}</b>
                    {(t.timeframe || t.provider) && (
                      <span className="badge" style={{ background:'rgba(96,165,250,.1)', color:'#93c5fd' }}
                        title={`Marché d'origine : ${t.pair}${t.timeframe ? ' en ' + t.timeframe : ''}${t.providerLabel ? ' · ' + t.providerLabel : ''}`}>
                        <i className="fas fa-crosshairs"></i>
                        {[t.timeframe, t.provider].filter(Boolean).join(' · ')}
                      </span>
                    )}
                    <span className="badge" style={{ background: t.direction==='BUY' ? 'rgba(16,185,129,.13)' : 'rgba(239,68,68,.13)',
                      color: t.direction==='BUY' ? '#34d399' : '#f87171' }}>{t.direction}</span>
                    <span style={{ fontSize:12.5, color:'var(--muted)' }}>
                      entrée <b style={{color:'#fff'}}>{n6(t.entry)}</b>
                      {t.sl !== null && <> · SL <b style={{color:'#fff'}}>{n6(t.sl)}</b></>}
                      {t.tp !== null && <> · TP <b style={{color:'#fff'}}>{n6(t.tp)}</b></>}
                      {t.plannedRR !== null && <> · {t.plannedRR}R prévu</>}
                    </span>
                  </div>
                  <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
                    <input className="fld" style={{ width:96 }} inputMode="decimal" placeholder="Sortie"
                      value={(closing[t.id]||{}).exit || ''}
                      onChange={e=>setClosing(s=>({ ...s, [t.id]:{ ...(s[t.id]||{}), exit:e.target.value } }))} />
                    <input className="fld" style={{ width:96 }} inputMode="decimal" placeholder="PnL (opt.)"
                      value={(closing[t.id]||{}).pnl || ''}
                      onChange={e=>setClosing(s=>({ ...s, [t.id]:{ ...(s[t.id]||{}), pnl:e.target.value } }))} />
                    <button className="btn sm" onClick={()=>doClose(t.id)} disabled={busy}>
                      <i className="fas fa-flag-checkered"></i>Clôturer
                    </button>
                    <button className="btn ghost sm" onClick={()=>del(t.id)} title="Supprimer">
                      <i className="fas fa-trash"></i>
                    </button>
                  </div>
                </div>
                {t.strategyIds && t.strategyIds.length > 0 && (
                  <p style={{ margin:'8px 0 0', fontSize:12, color:'var(--muted)' }}>
                    <i className="fas fa-book" style={{ marginRight:6 }}></i>
                    {t.strategyIds.map(stratTitle).join(', ')}
                  </p>
                )}
                {t.notes && <p style={{ margin:'8px 0 0', fontSize:12.5, color:'var(--muted)' }}>{t.notes}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="panel" style={{ padding:20, marginBottom:16 }}>
        <h3 style={{ margin:'0 0 14px', fontSize:15 }}>Trades clôturés <span className="badge" style={{ marginLeft:8 }}>{closed.length}</span></h3>
        {closed.length === 0 ? (
          <p style={{ color:'var(--muted)', fontSize:13, margin:0 }}>
            Aucun trade clôturé. Enregistre un trade puis clôture-le avec son prix de sortie :
            le taux de réussite se construit ici.
          </p>
        ) : (
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13, minWidth:640 }}>
              <thead>
                <tr style={{ color:'var(--muted)', fontSize:11.5, textTransform:'uppercase', letterSpacing:'.05em' }}>
                  <th style={{ textAlign:'left', padding:'8px 10px' }}>Paire</th>
                  <th style={{ textAlign:'left', padding:'8px 10px' }}>Sens</th>
                  <th style={{ textAlign:'right', padding:'8px 10px' }}>Entrée</th>
                  <th style={{ textAlign:'right', padding:'8px 10px' }}>Sortie</th>
                  <th style={{ textAlign:'right', padding:'8px 10px' }}>R</th>
                  <th style={{ textAlign:'right', padding:'8px 10px' }}>PnL</th>
                  <th style={{ textAlign:'left', padding:'8px 10px' }}>Résultat</th>
                  <th style={{ padding:'8px 10px' }}></th>
                </tr>
              </thead>
              <tbody>
                {closed.map(t => (
                  <tr key={t.id} style={{ borderTop:'1px solid var(--border)' }}>
                    <td style={{ padding:'9px 10px' }}>
                      <div style={{ color:'#fff', fontWeight:600 }}>{t.pair}</div>
                      {t.strategyIds && t.strategyIds.length > 0 && (
                        <div style={{ fontSize:11, color:'var(--muted)', marginTop:2 }}>
                          <i className="fas fa-book" style={{ marginRight:4 }}></i>
                          {t.strategyIds.map(stratTitle).join(', ').slice(0, 44)}
                        </div>
                      )}
                    </td>
                    <td style={{ padding:'9px 10px', color:'var(--muted)' }}>{t.direction}</td>
                    <td style={{ padding:'9px 10px', textAlign:'right' }}>{n6(t.entry)}</td>
                    <td style={{ padding:'9px 10px', textAlign:'right' }}>{n6(t.exit)}</td>
                    <td style={{ padding:'9px 10px', textAlign:'right',
                      color: t.rr > 0 ? '#34d399' : t.rr < 0 ? '#f87171' : 'var(--muted)' }}>{n2(t.rr)}</td>
                    <td style={{ padding:'9px 10px', textAlign:'right',
                      color: t.pnl > 0 ? '#34d399' : t.pnl < 0 ? '#f87171' : 'var(--muted)' }}>{n6(t.pnl)}</td>
                    <td style={{ padding:'9px 10px' }}><ResultBadge result={t.result} status={t.status} /></td>
                    <td style={{ padding:'9px 10px', textAlign:'right' }}>
                      <button className="btn ghost sm" onClick={()=>del(t.id)} title="Supprimer">
                        <i className="fas fa-trash"></i>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {stats && stats.byStrategy && stats.byStrategy.length > 0 && (
        <div className="panel" style={{ padding:20 }}>
          <h3 style={{ margin:'0 0 14px', fontSize:15 }}>Réussite par stratégie</h3>
          <div style={{ display:'grid', gap:10 }}>
            {stats.byStrategy.map(s => <StatRow key={s.key} s={s} />)}
          </div>
        </div>
      )}

      {stats && stats.byMarket && stats.byMarket.length > 0 && (
        <div className="panel" style={{ padding:20 }}>
          <h3 style={{ margin:'0 0 6px', fontSize:15 }}>Réussite par marché</h3>
          <p style={{ margin:'0 0 14px', fontSize:12, color:'var(--dim)' }}>
            Instrument et unité de temps : sur QUOI la performance est réellement réalisée.
            Un trade sans marché renseigné apparaît sous « — ».
          </p>
          <div style={{ display:'grid', gap:10 }}>
            {stats.byMarket.map(s => <StatRow key={s.key} s={s} />)}
          </div>
          {stats.bySource && stats.bySource.length > 0 && (
            <>
              <h3 style={{ margin:'20px 0 10px', fontSize:15 }}>Par source de données</h3>
              <div style={{ display:'grid', gap:10 }}>
                {stats.bySource.map(s => <StatRow key={s.key} s={s} />)}
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}

/**
 * Graphique TradingView OFFICIEL, par iframe.
 *
 * Pourquoi : afficher des cotations est leur métier, pas le mien. Leur graphique
 * rend n'importe quel symbole — DERIV:XAUUSD compris — exactement comme sur leur
 * site : zoom, outils de dessin, indicateurs, fuseaux, comparaison.
 *
 * L'iframe est préférée au widget JavaScript : rien à charger ni à maintenir de
 * notre côté, le navigateur de l'utilisateur va chercher le graphique directement,
 * et c'est la méthode que TradingView recommande pour une intégration simple.
 *
 * Les deux vues sont complémentaires : celle-ci pour LIRE le marché,
 * la vue « app » pour voir NOS niveaux calculés et le signal.
 */
function TradingViewChart({ symbole, tf, height }) {
  if (!symbole) {
    return (
      <div className="panel" style={{ padding:24, textAlign:'center', color:'var(--muted)', fontSize:13 }}>
        <i className="fas fa-circle-info" style={{ marginRight:7 }}></i>
        Ce marché n'a pas d'équivalent TradingView.
      </div>
    );
  }
  const intervalle = ({ '1m':'1', '5m':'5', '15m':'15', '30m':'30', '1h':'60', '4h':'240', '1d':'D' })[tf] || '5';
  const src = 'https://s.tradingview.com/widgetembed/'
    + `?symbol=${encodeURIComponent(symbole)}`
    + `&interval=${intervalle}`
    + '&theme=dark&style=1&locale=fr&timezone=Etc%2FUTC'
    + '&withdateranges=1&hide_side_toolbar=0&allow_symbol_change=0&save_image=1'
    + '&studies=Volume%40tv-basicstudies';

  return (
    <iframe
      src={src}
      title={`Graphique TradingView ${symbole}`}
      style={{ width:'100%', height, border:0, borderRadius:10, background:'#080c14' }}
      allowFullScreen
    />
  );
}

/**
 * Garde-fou : si un composant lève une erreur d'affichage, on montre un message
 * et un bouton de rechargement au lieu d'un écran vide — l'utilisateur ne doit
 * jamais se retrouver devant une page morte sans explication.
 */
class Garde extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(e) { return { err: e }; }
  componentDidCatch(e) { try { console.error('Erreur d\'affichage :', e && e.message); } catch (_) {} }
  render() {
    if (this.state.err) {
      return (
        <div className="panel" style={{ padding:24, margin:'24px auto', maxWidth:560, textAlign:'center' }}>
          <div style={{ fontSize:26, color:'#fbbf24', marginBottom:10 }}>
            <i className="fas fa-triangle-exclamation"></i>
          </div>
          <h3 style={{ margin:'0 0 8px' }}>Un affichage a échoué</h3>
          <p style={{ color:'var(--muted)', fontSize:13, margin:'0 0 16px' }}>
            {String(this.state.err && this.state.err.message || 'erreur inconnue')}
          </p>
          <button className="btn" onClick={() => { this.setState({ err:null }); window.location.reload(); }}>
            <i className="fas fa-rotate"></i>Recharger l'interface
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ══════════════ ALERTES ══════════════ */

// ── Scan complet : tous les marchés, silencieux ─────────────────────────────
// La surveillance n'alerte que sur sa liste courte. Ce panneau-ci regarde tout,
// ne prévient personne, et sert à décider quoi mettre sous surveillance.
function PanneauScan() {
  const [etat, setEtat] = useState({ dernier: null, erreurs: [] });
  const [tf, setTf] = useState('15m');
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState('');
  const [choix, setChoix] = useState('');
  const [strategies, setStrategies] = useState([]);
  // Combien de stratégies le dernier scan a réellement évaluées. Le champ est un
  // TABLEAU : vide = moteur générique, simple repérage.
  const nbStrategies = (etat && etat.dernier && Array.isArray(etat.dernier.strategies))
    ? etat.dernier.strategies.length : 0;

  const lire = async () => {
    try { const r = await api('/scan'); const d = await r.json(); setEtat(d); }
    catch (e) { setInfo(e.message); }
  };
  const lancer = async () => {
    setBusy(true); setInfo('');
    try {
      const r = await api('/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tf, strategie: choix || null }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'scan refusé');
      setEtat({ actif: true, dernier: d, erreurs: d.erreurs || [] });
      setInfo(`${d.signaux} signal/signaux sur ${d.marches} marché(s) en ${(d.dureeMs / 1000).toFixed(1)} s`
        + (d.strategie ? ` — stratégie « ${d.strategie} »` : ' — moteur générique'));
    } catch (e) { setInfo(e.message); } finally { setBusy(false); }
  };
  // Un signal repéré ici peut passer sous surveillance en un clic : c'est le
  // seul pont entre le scan silencieux et la liste courte qui notifie.
  const ajouterAuSuivi = async (x) => {
    try {
      const d0 = await (await api('/alerts')).json();
      const cfg = d0.config || {};
      const marches = cfg.marches || [];
      if (marches.some(y => y.symbol === x.symbole && y.tf === x.tf)) {
        setInfo(`${x.symbole} ${x.tf} est déjà sous surveillance.`);
        return;
      }
      const r = await api('/alerts', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...cfg, marches: [...marches, { symbol: x.symbole, tf: x.tf, provider: x.provider }] }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'ajout refusé');
      setInfo(`${x.symbole} ${x.tf} ajouté à la surveillance.`);
    } catch (e) { setInfo(e.message); }
  };

  useEffect(() => {
    lire();
    // Stratégies réellement exécutables, pour scanner AVEC leurs règles.
    fetch('/api/strategies/profiles', { credentials: 'same-origin' })
      .then(r => r.json())
      .then(d => setStrategies((d.profils || []).filter(x => x && x.executable !== false)))
      .catch(() => setStrategies([]));
  }, []);

  const dernier = etat.dernier;
  const lignes = (dernier && dernier.resultats) || [];
  return (
    <div className="panel" style={{ padding: 20 }}>
      <h2 style={{ fontSize: 17, fontWeight: 800, margin: '0 0 6px' }}>
        <i className="fas fa-radar" style={{ color: '#38bdf8', marginRight: 9 }}></i>Scan du marché
      </h2>
      <p style={{ margin: '0 0 14px', fontSize: 12.5, color: 'var(--muted)' }}>
        Tous les marchés disponibles, <b>sans aucune notification</b>. C'est le repérage ;
        la surveillance reste seule à prévenir.
        {' '}<b>Ce panneau n'évalue pas tes stratégies</b> : sans stratégie choisie, il
        utilise le moteur générique (toutes les règles réunies), qui ne valide aucune
        fiche en particulier et ne parcourt qu'UNE unité de temps à la fois.
      </p>
      <div style={{ display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <select className="fld" aria-label="Unité du scan" style={{ margin: 0, width: 'auto' }}
          value={tf} onChange={e => setTf(e.target.value)}>
          {['5m', '15m', '1h', '4h'].map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className="fld" aria-label="Stratégie appliquée au scan" style={{ margin: 0, width: 'auto', maxWidth: 260 }}
          value={choix} onChange={e => setChoix(e.target.value)}>
          <option value="">Moteur générique</option>
          {strategies.map(x => <option key={x.id} value={x.id}>{x.titre || x.id}</option>)}
        </select>
        <button className="btn sm" onClick={lancer} disabled={busy}>
          <i className="fas fa-play"></i>{busy ? 'Scan en cours…' : 'Lancer le scan'}
        </button>
        {dernier && (
          <span style={{ fontSize: 12, color: 'var(--dim)' }}>
            {new Date(dernier.at).toLocaleString('fr-FR')} · {(dernier.tfs || [dernier.tf]).join(' + ')} · {dernier.marches} marché(s)
            · {dernier.signaux} signal/signaux · {nbStrategies === 0 ? 'aucune stratégie (générique)' : nbStrategies + ' stratégie(s)'}
          </span>
        )}
      </div>
      {/* État PERMANENT du dernier scan : le mode employé reste visible même
          après la disparition du message de confirmation. Un scan générique ne
          doit jamais pouvoir être lu comme une validation de stratégie. */}
      {dernier && (
        <div style={{ marginBottom: 10, padding: '8px 11px', borderRadius: 8, fontSize: 12,
          background: nbStrategies ? 'rgba(52,211,153,.08)' : 'rgba(245,158,11,.09)',
          border: `1px solid ${nbStrategies ? 'rgba(52,211,153,.3)' : 'rgba(245,158,11,.3)'}`,
          color: nbStrategies ? '#6ee7b7' : '#fbbf24' }}>
          <i className={`fas ${nbStrategies ? 'fa-book' : 'fa-triangle-exclamation'}`}
            style={{ marginRight: 7 }}></i>
          {nbStrategies
            ? <>Scan avec <b>{nbStrategies} stratégie{nbStrategies > 1 ? 's' : ''}</b> —
                leurs règles et leurs seuils. Chaque ligne est un signal DE la stratégie nommée.</>
            : <><b>Moteur générique</b> — aucune stratégie n'a été évaluée. Ce résultat est un
                repérage, pas une validation. Unités : {(dernier.tfs || [dernier.tf]).join(', ')}.</>}
            {nbStrategies > 0 && (
              <span style={{ color: 'var(--dim)' }}>
                {' '}Évaluées : <b>{dernier.strategies.join(', ')}</b>.
              </span>
            )}
        </div>
      )}
      {info && <div style={{ fontSize: 12.5, color: '#93c5fd', marginBottom: 10 }}>{info}</div>}
      {!lignes.length && (
        <div style={{ fontSize: 12.5, color: 'var(--dim)' }}>
          Aucun signal directionnel au dernier passage. Lance un scan pour rafraîchir.
        </div>
      )}
      {lignes.length > 0 && (
        <div style={{ display: 'grid', gap: 6 }}>
          {lignes.slice(0, 40).map((x, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10,
              alignItems: 'center', fontSize: 12.5, paddingBottom: 6,
              borderBottom: '1px solid rgba(27,36,51,.5)' }}>
              <span style={{ color: '#fff' }}>
                <b style={{ color: x.direction === 'BUY' ? '#34d399' : '#f87171' }}>{x.direction}</b>
                {' '}{x.symbole} <span style={{ color: 'var(--dim)' }}>· {x.tf}</span>
              </span>
              <span style={{ color: 'var(--muted)' }}>
                force {Number(x.force || 0).toFixed(2)} · {x.status || '—'} · {x.confirmations || 0} règle(s)
                {' '}
                {x.strategie
                  ? <span className="badge" style={{ fontSize: 9.5, background: 'rgba(52,211,153,.14)', color: '#6ee7b7' }}>
                      <i className="fas fa-book" style={{ fontSize: 8 }}></i>{x.strategie}
                    </span>
                  : <span className="badge" style={{ fontSize: 9.5, background: 'rgba(245,158,11,.14)', color: '#fbbf24' }}
                      title="Repéré par le moteur générique : aucune fiche de stratégie n'a été appliquée.">
                      générique
                    </span>}
              </span>
              <button className="btn ghost sm" onClick={() => ajouterAuSuivi(x)}
                title="Ajouter à la liste de surveillance">
                <i className="fas fa-bell"></i>Surveiller
              </button>
            </div>
          ))}
        </div>
      )}
      {(etat.erreurs || []).length > 0 && (
        <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--dim)' }}>
          Ignorés : {etat.erreurs.slice(0, 6).join(' · ')}
        </div>
      )}
    </div>
  );
}

function Alertes() {
  const [cfg, setCfg] = useState(null);
  // Stratégies de la base : la surveillance peut les appliquer, au lieu de
  // tourner en mode auto (toutes les règles) et d'ignorer la sélection.
  const [profils, setProfils] = useState([]);
  const [stratOuvert, setStratOuvert] = useState(false);
  // Les marchés proposés viennent de la même source que l'onglet Direct.
  const [meta, setMeta] = useState({ symbols: [], timeframes: [] });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [nouveau, setNouveau] = useState({ symbol: 'frxXAUUSD', tf: '15m', provider: 'deriv' });
  const [compte, setCompte] = useState(null);
  // Telegram : conversations trouvées automatiquement à partir du jeton du bot.
  const [chatsTg, setChatsTg] = useState([]);
  const [aideTg, setAideTg] = useState('');
  const [tgBusy, setTgBusy] = useState(false);
  // Push navigateur : actif | inactif | refuse | non-supporte | non-configure | inconnu
  const [pushEtat, setPushEtat] = useState('inconnu');
  const [pushInfo, setPushInfo] = useState('');
  const [pushBusy, setPushBusy] = useState(false);

  /**
   * Cherche la conversation Telegram à partir du jeton du bot.
   * L'utilisateur n'a pas à connaître son « chat id » : il écrit à son bot, et
   * l'app le retrouve. Sinon, il faudrait aller le pêcher dans une URL d'API.
   */
  const trouverTelegram = async () => {
    setTgBusy(true); setErr(''); setMsg(''); setAideTg(''); setChatsTg([]);
    try {
      const r = await api('/alerts/telegram/trouver', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: (cfg && cfg.telegramToken) || '' })
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      if (d.trouve) {
        setChatsTg(d.chats || []);
        setMsg(`Conversation${(d.chats || []).length > 1 ? 's' : ''} trouvée${(d.chats || []).length > 1 ? 's' : ''} : ` +
          (d.chats || []).map(c => `${c.nom} (${c.id})`).join(' · '));
      } else {
        setAideTg(d.aide || 'Aucune conversation trouvée.');
      }
    } catch (e) { setErr(e.message); }
    finally { setTgBusy(false); }
  };

  /** Envoie un vrai message Telegram : si ça arrive sur le téléphone, c'est branché. */
  const testerTelegram = async () => {
    setTgBusy(true); setErr(''); setMsg('');
    try {
      const r = await api('/alerts/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canal: 'telegram' })
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setMsg(d.message || 'Message envoyé : regarde ton Telegram.');
    } catch (e) { setErr(e.message); }
    finally { setTgBusy(false); }
  };

  const load = async () => {
    try {
      const r = await api('/alerts');
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Lecture impossible');
      setCfg(d.config || null);
    } catch (e) { setErr(e.message); }
  };
  useEffect(() => { load(); }, []);

  useEffect(() => {
    (async () => {
      try {
        const r = await api('/market/symbols');
        const d = await r.json();
        if (d.success) setMeta({ symbols: d.symbols || [], timeframes: d.timeframes || [] });
      } catch (e) {}
    })();
  }, []);

  // Profils de stratégies : mêmes que l'onglet Direct (une seule source).
  useEffect(() => {
    (async () => {
      try {
        const r = await api('/strategies/profiles');
        const d = await r.json();
        if (d.success) setProfils(d.profils || []);
      } catch (e) {}
    })();
  }, []);

  const sauver = async (patch) => {
    setBusy(true); setErr(''); setMsg('');
    try {
      const r = await api('/alerts', { method:'PUT', headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ ...cfg, ...patch }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Enregistrement refusé');
      setCfg(d.config);
      setMsg('Réglages enregistrés.');
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const tester = async () => {
    setBusy(true); setErr(''); setMsg('');
    try {
      const r = await api('/alerts/test', { method:'POST' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Envoi impossible');
      setMsg(`Email de test envoyé à ${d.to}.`);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const controler = async () => {
    setBusy(true); setErr(''); setMsg('');
    try {
      const r = await api('/alerts/verifier', { method:'POST' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Contrôle impossible');
      setCompte(d);
      setMsg(d.envoyes ? `${d.envoyes} alerte(s) envoyée(s).` : 'Aucun signal confirmé pour l\'instant.');
      await load();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  /**
   * Notifications push : l'abonnement vit dans le navigateur (PushManager),
   * sa copie côté serveur sert à l'envoi. Sans worker actif ni clé VAPID,
   * chaque étape dit pourquoi au lieu de se taire.
   */
  const cleVersU8 = (base64) => {
    const pad = '='.repeat((4 - (base64.length % 4)) % 4);
    const bin = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  };

  const etatPush = async () => {
    setPushInfo('');
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      setPushEtat('non-supporte'); return;
    }
    try {
      const cfgPush = await (await api('/push/config')).json();
      if (!cfgPush.pret || !cfgPush.clePublique) { setPushEtat('non-configure'); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setPushEtat(sub ? 'actif' : (Notification.permission === 'denied' ? 'refuse' : 'inactif'));
    } catch (e) { setPushEtat('inconnu'); setPushInfo(e.message); }
  };

  const activerPush = async () => {
    setPushBusy(true); setPushInfo('');
    try {
      const cfgPush = await (await api('/push/config')).json();
      if (!cfgPush.pret || !cfgPush.clePublique) throw new Error('Push non configuré côté serveur (clés VAPID manquantes).');
      if (Notification.permission === 'denied') throw new Error('Notifications refusées : autorise-les dans les réglages du site.');
      if (Notification.permission !== 'granted') {
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') throw new Error('Autorisation refusée.');
      }
      const reg = await navigator.serviceWorker.register('/sw.js');
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: cleVersU8(cfgPush.clePublique)
      });
      const r = await api('/push/subscribe', { method:'POST', headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ subscription: sub.toJSON() }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Enregistrement refusé');
      setPushEtat('actif');
      setMsg('Notifications push activées sur cet appareil.');
    } catch (e) { setPushInfo(e.message); await etatPush(); }
    finally { setPushBusy(false); }
  };

  const desactiverPush = async () => {
    setPushBusy(true); setPushInfo('');
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      const endpoint = sub ? sub.endpoint : null;
      if (sub) await sub.unsubscribe();
      await api('/push/subscribe', { method:'DELETE', headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ endpoint }) });
      setPushEtat('inactif');
    } catch (e) { setPushInfo(e.message); }
    finally { setPushBusy(false); }
  };

  useEffect(() => { etatPush(); }, []);

  const ajouterMarche = () => {
    if (!nouveau.symbol) return;
    const m = cfg.marches || [];
    if (m.some(x => x.symbol === nouveau.symbol && x.tf === nouveau.tf && x.provider === nouveau.provider)) return;
    sauver({ marches: [...m, { ...nouveau }] });
  };
  const retirerMarche = (i) => sauver({ marches: (cfg.marches || []).filter((_, k) => k !== i) });

  if (!cfg) return <div className="panel" style={{ padding:28, textAlign:'center', color:'var(--muted)' }}>
    {err ? err : 'Chargement des réglages…'}</div>;

  const libelle = (sym, prov) => {
    const s = (meta.symbols || []).find(x => x.symbol === sym && x.provider === prov);
    return s ? (s.tv || s.label) : `${prov}:${sym}`;
  };

  return (
    <div style={{ display:'grid', gap:16 }}>
      {/* Quelles stratégies la SURVEILLANCE applique. Sans ce panneau, le moteur
          de fond recevait la config mais rien à l'écran ne pouvait la remplir :
          la surveillance restait en mode auto et ignorait les stratégies. */}
      <Reveal>
        <div className="panel" style={{ padding:20 }}>
          <h2 style={{ fontSize:17, fontWeight:800, margin:'0 0 6px' }}>
            <i className="fas fa-list-check" style={{ color:'#60a5fa', marginRight:9 }}></i>Stratégies appliquées à la surveillance
          </h2>
          <p style={{ margin:'0 0 14px', fontSize:12.5, color:'var(--muted)' }}>
            Choisis les stratégies que la surveillance doit évaluer. Chacune rend son
            propre signal, avec ses règles et ses unités de temps. Aucune sélectionnée =
            mode auto (toutes les règles confondues).
          </p>

          <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap', marginBottom:10 }}>
            <button className="btn ghost sm" onClick={() => setStratOuvert(o => !o)}>
              <i className="fas fa-chevron-down"></i>
              {(cfg.strategies || []).length
                ? `${(cfg.strategies || []).length} stratégie(s) surveillée(s)`
                : 'Choisir les stratégies'}
            </button>
            {(cfg.strategies || []).length > 0 && (
              <button className="btn ghost sm" disabled={busy}
                onClick={() => sauver({ strategies: [] })}>
                <i className="fas fa-rotate-left"></i> Revenir au mode auto
              </button>
            )}
            <span style={{ fontSize:11.5, color:'var(--dim)' }}>
              {profils.length} disponible(s) dans la base
            </span>
          </div>

          {(cfg.strategies || []).length > 0 && (
            <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:10 }}>
              {(cfg.strategies || []).map(id => {
                const p = profils.find(x => x.id === id);
                return (
                  <span key={id} className="tag" title={p ? (p.regles || []).join('+') : id}
                    style={{ borderColor:'rgba(96,165,250,.4)', color:'#93c5fd' }}>
                    {(p && p.titre ? p.titre : id).slice(0, 46)}
                  </span>
                );
              })}
            </div>
          )}

          {stratOuvert && (
            <div style={{ maxHeight:300, overflowY:'auto', padding:'10px 12px',
              borderRadius:10, background:'rgba(148,163,184,.04)',
              border:'1px solid rgba(148,163,184,.16)' }}>
              {profils.length === 0 && (
                <div style={{ fontSize:12.5, color:'var(--muted)' }}>
                  Aucune stratégie dans la base. Ajoute-en dans l'onglet « Ajouter ».
                </div>
              )}
              {profils.map(p => {
                const coche = (cfg.strategies || []).includes(p.id);
                return (
                  <label key={p.id} style={{ display:'flex', gap:9, alignItems:'center',
                    padding:'5px 2px', fontSize:12.5, cursor:'pointer' }}>
                    <input type="checkbox" checked={coche} readOnly onClick={() => {
                      const actuelles = cfg.strategies || [];
                      const suivantes = coche
                        ? actuelles.filter(x => x !== p.id)
                        : [...actuelles, p.id];
                      sauver({ strategies: suivantes });
                    }} />
                    <span style={{ flex:1 }}>{p.titre}</span>
                    <span className="tag" style={{ fontSize:10 }}>{(p.regles || []).join('+')}</span>
                    {(p.timeframes || []).length > 0 && (
                      <span style={{ fontSize:10, color:'var(--dim)' }}>{p.timeframes.join('/')}</span>
                    )}
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </Reveal>

      <Reveal>
        <div className="panel" style={{ padding:20 }}>
          <h2 style={{ fontSize:17, fontWeight:800, margin:'0 0 6px' }}>
            <i className="fas fa-bell" style={{ color:'#fbbf24', marginRight:9 }}></i>Alertes par email
          </h2>
          <p style={{ margin:'0 0 16px', fontSize:12.5, color:'var(--muted)' }}>
            Un signal confirmé n'existe que si l'onglet est ouvert. Ici, l'app surveille
            les marchés choisis et t'envoie un email au premier signal confirmé — une seule
            fois par signal.
          </p>

          {msg && <div style={{ marginBottom:12, padding:'9px 12px', borderRadius:8, fontSize:12.5,
            background:'rgba(16,185,129,.1)', color:'#6ee7b7' }}>{msg}</div>}
          {err && <div style={{ marginBottom:12, padding:'9px 12px', borderRadius:8, fontSize:12.5,
            background:'rgba(239,68,68,.1)', color:'#fca5a5' }}>{err}</div>}

          <div style={{ display:'grid', gap:12, gridTemplateColumns:'repeat(auto-fit,minmax(240px,1fr))' }}>
            <label style={{ display:'grid', gap:5 }}>
              <span style={{ fontSize:12, color:'var(--muted)' }}>Surveillance</span>
              <select className="fld" aria-label="État de l'alerte" style={{ margin:0 }} value={cfg.actif ? 'on' : 'off'}
                onChange={e => sauver({ actif: e.target.value === 'on' })}>
                <option value="off">désactivée</option>
                <option value="on">active</option>
              </select>
            </label>
            <label style={{ display:'grid', gap:5 }}>
              <span style={{ fontSize:12, color:'var(--muted)' }}>Adresse de réception</span>
              <input className="fld" style={{ margin:0 }} value={cfg.email || ''}
                placeholder="ton@email.com"
                onChange={e => setCfg({ ...cfg, email: e.target.value })}
                onBlur={() => sauver({ email: cfg.email })} />
            </label>
            <label style={{ display:'grid', gap:5 }}>
              <span style={{ fontSize:12, color:'var(--muted)' }}>
                Force minimale : {Math.round((cfg.forceMin || 0) * 100)} %
              </span>
              <input type="range" min="0" max="100" step="5" value={Math.round((cfg.forceMin || 0) * 100)}
                onChange={e => setCfg({ ...cfg, forceMin: Number(e.target.value) / 100 })}
                onMouseUp={() => sauver({ forceMin: cfg.forceMin })} />
            </label>
            <label style={{ display:'grid', gap:5 }}>
              <span style={{ fontSize:12, color:'var(--muted)' }}>Intervalle de contrôle (s)</span>
              <input className="fld" style={{ margin:0 }} type="number" min="15" max="3600"
                value={cfg.intervalleSec || 60}
                onChange={e => setCfg({ ...cfg, intervalleSec: Number(e.target.value) })}
                onBlur={() => sauver({ intervalleSec: cfg.intervalleSec })} />
            </label>
            <label style={{ display:'grid', gap:5 }}>
              <span style={{ fontSize:12, color:'var(--muted)' }}>
                Silence entre deux rappels (min)
              </span>
              <input className="fld" style={{ margin:0 }} type="number" min="0" max="1440"
                value={cfg.cooldownMin === undefined ? 30 : cfg.cooldownMin}
                onChange={e => setCfg({ ...cfg, cooldownMin: Number(e.target.value) })}
                onBlur={() => sauver({ cooldownMin: cfg.cooldownMin })} />
              <span style={{ fontSize:11, color:'var(--dim)' }}>
                0 = aucun rappel. Un même signal ne repart pas avant ce délai.
              </span>
            </label>
          </div>

          <div style={{ display:'flex', gap:10, marginTop:16, flexWrap:'wrap' }}>
            <button className="btn" onClick={tester} disabled={busy}>
              <i className="fas fa-paper-plane"></i>Envoyer un email de test
            </button>
            <button className="btn ghost" onClick={controler} disabled={busy}>
              <i className="fas fa-magnifying-glass-chart"></i>Vérifier maintenant
            </button>
          </div>

          {compte && compte.marches && (
            <div style={{ marginTop:14, fontSize:12.5, display:'grid', gap:5 }}>
              <div style={{ color:'var(--muted)' }}>Dernier contrôle :</div>
              {compte.marches.map((m, i) => (
                <div key={i} style={{ display:'flex', justifyContent:'space-between', gap:10 }}>
                  <span style={{ color:'var(--muted)' }}>{libelle(m.symbol, m.provider)} {m.tf}</span>
                  <span style={{ color: /ALERTE/.test(m.verdict) ? '#6ee7b7' : 'var(--dim)' }}>{m.verdict}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Reveal>

      {/* Telegram : le signal confirmé part sur le téléphone, sans ouvrir sa boîte
          mail. Le « chat id » est trouvé automatiquement — c'est la seule chose
          que les utilisateurs ne savent jamais où chercher. */}
      <Reveal>
        <div className="panel" style={{ padding:20 }}>
          <h2 style={{ fontSize:17, fontWeight:800, margin:'0 0 6px' }}>
            <i className="fab fa-telegram" style={{ color:'#29b6f6', marginRight:9 }}></i>Alertes Telegram
          </h2>
          <p style={{ margin:'0 0 16px', fontSize:12.5, color:'var(--muted)' }}>
            Le signal confirmé arrive sur ton téléphone, tout de suite. Les deux canaux
            (email et Telegram) fonctionnent ensemble : ce n'est pas l'un ou l'autre.
          </p>

          <ol style={{ margin:'0 0 16px', paddingLeft:20, fontSize:12.5, color:'var(--muted)', display:'grid', gap:5 }}>
            <li>Ouvre Telegram et cherche <b style={{ color:'#e2e8f0' }}>@BotFather</b></li>
            <li>Envoie-lui <b style={{ color:'#e2e8f0' }}>/newbot</b> et suis ses deux questions (nom, puis identifiant finissant par « bot »)</li>
            <li>Il te donne un <b style={{ color:'#e2e8f0' }}>jeton</b> (une longue suite de chiffres et de lettres) : colle-le ci-dessous</li>
            <li>Cherche ton bot par son nom et envoie-lui <b style={{ color:'#e2e8f0' }}>salut</b>, puis clique sur « Trouver ma conversation »</li>
          </ol>

          <div style={{ display:'grid', gap:12, gridTemplateColumns:'repeat(auto-fit,minmax(260px,1fr))' }}>
            <label style={{ display:'grid', gap:5 }}>
              <span style={{ fontSize:12, color:'var(--muted)' }}>Jeton du bot (donné par BotFather)</span>
              <input className="fld" style={{ margin:0 }} value={(cfg && cfg.telegramToken) || ''}
                placeholder="123456789:AAE…"
                onChange={e => setCfg({ ...cfg, telegramToken: e.target.value })}
                onBlur={() => sauver({ telegramToken: (cfg && cfg.telegramToken) || '' })} />
            </label>
            <label style={{ display:'grid', gap:5 }}>
              <span style={{ fontSize:12, color:'var(--muted)' }}>Conversation (remplie automatiquement)</span>
              <input className="fld" style={{ margin:0 }} value={(cfg && cfg.telegramChat) || ''}
                placeholder="trouvé par le bouton ci-dessous"
                onChange={e => setCfg({ ...cfg, telegramChat: e.target.value })}
                onBlur={() => sauver({ telegramChat: (cfg && cfg.telegramChat) || '' })} />
            </label>
          </div>

          {chatsTg.length > 1 && (
            <div style={{ marginTop:12, display:'grid', gap:6 }}>
              <span style={{ fontSize:12, color:'var(--muted)' }}>Plusieurs conversations : choisis la bonne</span>
              <div style={{ display:'flex', gap:7, flexWrap:'wrap' }}>
                {chatsTg.map((c, i) => (
                  <button key={i} className="btn ghost sm"
                    onClick={() => sauver({ telegramChat: String(c.id) })}>
                    <i className="fas fa-comment"></i>{c.nom} · {c.id}
                  </button>
                ))}
              </div>
            </div>
          )}

          {aideTg && (
            <div style={{ marginTop:12, padding:'9px 12px', borderRadius:8, fontSize:12.5,
              background:'rgba(251,191,36,.1)', color:'#fcd34d' }}>
              <i className="fas fa-circle-info" style={{ marginRight:7 }}></i>{aideTg}
            </div>
          )}

          <div style={{ display:'flex', gap:9, flexWrap:'wrap', marginTop:16 }}>
            <button className="btn ghost" onClick={trouverTelegram} disabled={tgBusy || !cfg || !cfg.telegramToken}>
              <i className="fas fa-magnifying-glass"></i>Trouver ma conversation
            </button>
            <button className="btn ok" onClick={testerTelegram}
              disabled={tgBusy || !cfg || !cfg.telegramToken || !cfg.telegramChat}>
              <i className="fab fa-telegram"></i>Envoyer un message d'essai
            </button>
            <span style={{ alignSelf:'center', fontSize:12, color: (cfg && cfg.telegramToken && cfg.telegramChat) ? '#6ee7b7' : 'var(--dim)' }}>
              {(cfg && cfg.telegramToken && cfg.telegramChat) ? 'Telegram est configuré' : 'à configurer'}
            </span>
          </div>
        </div>
      </Reveal>

      {/* Push navigateur : le signal arrive même onglet fermé (navigateur
          ouvert). Cumule avec email et Telegram, sans les remplacer. */}
      <Reveal>
        <div className="panel" style={{ padding:20 }}>
          <h2 style={{ fontSize:17, fontWeight:800, margin:'0 0 6px' }}>
            <i className="fas fa-bell" style={{ color:'#60a5fa', marginRight:9 }}></i>Notifications push
          </h2>
          <p style={{ margin:'0 0 16px', fontSize:12.5, color:'var(--muted)' }}>
            Le signal confirmé s'affiche sur ton appareil, même si l'onglet est fermé
            (le navigateur doit rester ouvert).
          </p>
          <div style={{ display:'flex', gap:9, flexWrap:'wrap', alignItems:'center' }}>
            {pushEtat !== 'actif' ? (
              <button className="btn" onClick={activerPush} disabled={pushBusy}>
                <i className="fas fa-bell"></i>Activer les notifications
              </button>
            ) : (
              <button className="btn ghost" onClick={desactiverPush} disabled={pushBusy}>
                <i className="fas fa-bell-slash"></i>Désactiver sur cet appareil
              </button>
            )}
            <button className="btn ghost sm" onClick={etatPush} disabled={pushBusy}>Actualiser l'état</button>
            <span style={{ alignSelf:'center', fontSize:12, color: pushEtat === 'actif' ? '#6ee7b7' : 'var(--dim)' }}>
              {pushEtat === 'actif' ? 'push actif sur cet appareil'
                : pushEtat === 'inactif' ? 'push inactif'
                : pushEtat === 'refuse' ? 'notifications refusées par le navigateur'
                : pushEtat === 'non-supporte' ? 'navigateur incompatible'
                : pushEtat === 'non-configure' ? 'clés VAPID manquantes côté serveur'
                : 'état inconnu'}
            </span>
          </div>
          {pushInfo && (
            <div style={{ marginTop:12, padding:'9px 12px', borderRadius:8, fontSize:12.5,
              background:'rgba(251,191,36,.1)', color:'#fcd34d' }}>{pushInfo}</div>
          )}
        </div>
      </Reveal>

      <div className="panel" style={{ padding:20 }}>
        <h3 style={{ margin:'0 0 12px', fontSize:15 }}>
          { (cfg.marches || []).length } marché(s) surveillé(s)
        </h3>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:14 }}>
          <select className="fld" aria-label="Fournisseur du nouveau symbole" style={{ margin:0, width:'auto' }} value={nouveau.provider}
            onChange={e => setNouveau({ ...nouveau, symbol:'', provider: e.target.value })}>
            <option value="deriv">Deriv</option>
            <option value="binance">Binance</option>
          </select>
          <select className="fld" aria-label="Symbole surveillé" style={{ margin:0, width:'auto' }} value={nouveau.symbol}
            onChange={e => setNouveau({ ...nouveau, symbol: e.target.value })}>
            <option value="">— marché —</option>
            {(meta.symbols || []).filter(s => s.provider === nouveau.provider)
              .map(s => <option key={s.symbol} value={s.symbol}>{s.tv || s.label}</option>)}
          </select>
          <select className="fld" aria-label="Unité de temps surveillée" style={{ margin:0, width:'auto' }} value={nouveau.tf}
            onChange={e => setNouveau({ ...nouveau, tf: e.target.value })}>
            {(meta.timeframes || []).map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <button className="btn ghost sm" onClick={ajouterMarche} disabled={busy || !nouveau.symbol}>
            <i className="fas fa-plus"></i>Ajouter
          </button>
        </div>
        <div style={{ display:'grid', gap:7 }}>
          {(cfg.marches || []).map((m, i) => (
            <div key={i} style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
              gap:10, paddingBottom:7, borderBottom:'1px solid rgba(27,36,51,.5)' }}>
              <span style={{ fontSize:13, color:'#fff' }}>
                {libelle(m.symbol, m.provider)} <span style={{ color:'var(--dim)' }}>· {m.tf}</span>
                <span style={{ color:'var(--dim)', fontSize:11.5 }}>
                  {' · '}{(cfg.strategies || []).length || 'toutes'} stratégie(s)
                  {(cfg.strategies || []).length === 1 ? '' : ''}
                </span>
                {(() => {
                  // Dernière alerte pour ce marché : dit si le cooldown court encore.
                  const d = (cfg.derniers || []).find(a => a.symbol === m.symbol && a.tf === m.tf);
                  if (!d) return null;
                  const reste = Math.max(0, Math.round(
                    ((Number(cfg.cooldownMin === undefined ? 30 : cfg.cooldownMin) * 60_000)
                      - (Date.now() - new Date(d.at).getTime())) / 60_000));
                  return <span style={{ color: reste > 0 ? '#fbbf24' : 'var(--dim)', fontSize:11.5 }}>
                    {' · '}{reste > 0 ? `silence ${reste} min` : 'prêt'}
                  </span>;
                })()}
              </span>
              <button onClick={() => retirerMarche(i)} disabled={busy}
                style={{ background:'none', border:'none', color:'#f87171', cursor:'pointer', fontSize:12.5 }}>
                <i className="fas fa-trash"></i>
              </button>
            </div>
          ))}
          {!(cfg.marches || []).length && <span style={{ color:'var(--dim)', fontSize:12.5 }}>Aucun marché surveillé.</span>}
        </div>
      </div>

      <PanneauScan />

      <div className="panel" style={{ padding:20 }}>
        <h3 style={{ margin:'0 0 12px', fontSize:15 }}>Alertes envoyées</h3>
        {!(cfg.derniers || []).length && <span style={{ color:'var(--dim)', fontSize:12.5 }}>Aucune alerte envoyée pour l'instant.</span>}
        <div style={{ display:'grid', gap:8 }}>
          {(cfg.derniers || []).map((a, i) => (
            <div key={i} style={{ display:'flex', justifyContent:'space-between', gap:12, flexWrap:'wrap',
              fontSize:12.5, paddingBottom:7, borderBottom:'1px solid rgba(27,36,51,.5)' }}>
              <span>
                <b style={{ color: a.direction === 'BUY' ? '#34d399' : '#f87171' }}>{a.direction}</b>
                {' '}{libelle(a.symbol, a.provider)} · {a.tf}
              </span>
              <span style={{ color:'var(--muted)' }}>
                force {a.forceNiveau || '—'} ({Number(a.strength || 0).toFixed(2)}/1) · {new Date(a.at).toLocaleString('fr-FR')}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ══════════════ TERMES ══════════════ */

/**
 * Le vocabulaire du moteur, chaque terme relié à l'endroit de l'interface où
 * il est calculé. Sans ça, les sigles restent opaques : on voit « BOS » ou
 * « FVG » sans savoir ce que l'application a réellement mesuré.
 */
const LEXIQUE = [
  { f:'Structure', sigle:'BOS', nom:'Break of Structure', fr:'rupture de structure',
    def:"Clôture au-delà du dernier sommet (ou creux) DANS le sens de la tendance : le mouvement se poursuit.",
    ou:"Règle R2 · panneaux « Structure calculée » et « éléments identifiés »" },
  { f:'Structure', sigle:'CHoCH', nom:'Change of Character', fr:'changement de caractère',
    def:"Première cassure CONTRE la tendance en place : le marché change de camp, retournement possible.",
    ou:"Règle R2 (nommée « changement de caractère » dans le verdict)" },
  { f:'Structure', sigle:'MSS', nom:'Market Structure Shift', fr:'décalage de structure',
    def:"Cassure qui invalide la structure précédente — un CHoCH suivi d'une prise de liquidité.",
    ou:"Déduit du verdict quand un CHoCH apparaît après un balayage" },
  { f:'Structure', sigle:'HH / HL', nom:'Higher High / Higher Low', fr:'sommet / creux ascendants',
    def:"Séquence qui définit une tendance haussière : chaque sommet et chaque creux monte.",
    ou:"Ligne « Récent » du panneau « Structure calculée »" },
  { f:'Structure', sigle:'LH / LL', nom:'Lower High / Lower Low', fr:'sommet / creux descendants',
    def:"Séquence qui définit une tendance baissière : chaque sommet et chaque creux descend.",
    ou:"Ligne « Récent » du panneau « Structure calculée »" },
  { f:'Structure', sigle:'Swing', nom:'Swing high / low', fr:'sommet ou creux local',
    def:"Point plus haut (ou plus bas) que les bougies voisines. Base de toute la lecture de structure.",
    ou:"Fenêtre réglable par stratégie (« Fenêtre des swings »)" },
  { f:'Zones', sigle:'OB', nom:'Order Block', fr:'bloc d’ordres',
    def:"Dernière bougie de sens opposé avant une impulsion : la zone où de gros ordres ont été passés.",
    ou:"Règle R3 · section « order blocks » de l'inventaire" },
  { f:'Zones', sigle:'FVG', nom:'Fair Value Gap', fr:'déséquilibre de prix',
    def:"Écart entre trois bougies, laissé quand le prix bouge trop vite : le marché revient souvent le combler.",
    ou:"Règle R3 · section « imbalances » de l'inventaire" },
  { f:'Zones', sigle:'Breaker', nom:'Breaker block', fr:'bloc cassé',
    def:"Order block cassé par la clôture : la zone change de camp (support devenu résistance).",
    ou:"Section « breakers » du panneau Fibonacci et de l'inventaire" },
  { f:'Zones', sigle:'EQH / EQL', nom:'Equal Highs / Equal Lows', fr:'sommets / creux égaux',
    def:"Deux sommets (ou creux) au même niveau : les stops s'y accumulent, le prix vient les chercher.",
    ou:"Section « liquidité » de l'inventaire · règle R1" },
  { f:'Zones', sigle:'Liquidity', nom:'Liquidity pool', fr:'amas de liquidité',
    def:"Niveau où se trouvent les ordres stop (au-dessus des sommets, sous les creux). Le prix y est attiré.",
    ou:"Section « liquidité » de l'inventaire" },
  { f:'Prix', sigle:'Premium', nom:'Premium', fr:'zone haute du range',
    def:"Prix au-dessus de l'équilibre (50 %) du range : on privilégie la VENTE.",
    ou:"Règle R4 · panneau « Structure calculée »" },
  { f:'Prix', sigle:'Discount', nom:'Discount', fr:'zone basse du range',
    def:"Prix sous l'équilibre (50 %) du range : on privilégie l'ACHAT.",
    ou:"Règle R4 · panneau « Structure calculée »" },
  { f:'Prix', sigle:'OTE', nom:'Optimal Trade Entry', fr:'zone d’entrée optimale',
    def:"Retracement entre 0,618 et 0,786 du dernier mouvement : la zone d'entrée privilégiée.",
    ou:"Panneau « Fibonacci & périodes de référence »" },
  { f:'Prix', sigle:'PDH / PDL', nom:'Previous Day High / Low', fr:'plus haut / bas de la veille',
    def:"Repères de la séance précédente : souvent pris puis rejoués comme supports ou résistances.",
    ou:"Panneau « Fibonacci & périodes de référence »" },
  { f:'Prix', sigle:'PWH / PWL', nom:'Previous Week High / Low', fr:'plus haut / bas de la semaine passée',
    def:"Mêmes repères, à l'échelle hebdomadaire : le contexte large.",
    ou:"Panneau « Fibonacci & périodes de référence »" },
  { f:'Flux', sigle:'Sweep', nom:'Liquidity sweep', fr:'balayage de liquidité',
    def:"Mèche au-delà d'un niveau puis clôture de l'autre côté : les stops sont pris, pas la tendance poursuivie.",
    ou:"Règle R1 · section « balayages » de l'inventaire" },
  { f:'Flux', sigle:'Displacement', nom:'Displacement', fr:'déplacement',
    def:"Bougie au corps large (au moins 1,5 × ATR) : signature d'une entrée institutionnelle.",
    ou:"Ligne « Déplacements » du panneau « Structure calculée »" },
  { f:'Flux', sigle:'Kill zone', nom:'Kill zone', fr:'plage horaire active',
    def:"Créneaux où la liquidité est prise : Londres 7 h–10 h UTC, New York 12 h–15 h UTC.",
    ou:"Panneau « Structure calculée » (session en cours)" },
  { f:'Risque', sigle:'ATR', nom:'Average True Range', fr:'amplitude moyenne',
    def:"Amplitude moyenne sur 14 bougies. Sert à dimensionner l'invalidation et les objectifs.",
    ou:"Sous le graphique · base du stop réglable par stratégie" },
  { f:'Risque', sigle:'R', nom:'Multiple de risque', fr:'risque initial',
    def:"1 R = la distance entre l'entrée et l'invalidation. Un gain de 2 R vaut deux fois le risque pris.",
    ou:"Colonne RR du journal" },
  { f:'Risque', sigle:'RR', nom:'Risk / Reward', fr:'risque / gain',
    def:"Rapport entre la distance à l'objectif et la distance à l'invalidation, prévu puis réalisé.",
    ou:"Champ « R prévu » de chaque trade du journal" },
  { f:'Moteur', sigle:'Confluence', nom:'Multi-timeframe alignment', fr:'alignement multi-unités',
    def:"Les unités de temps doivent aller dans le même sens, sinon le signal reste « à surveiller ».",
    ou:"Panneau « Alignement des unités de temps »" },
  { f:'Moteur', sigle:'R1..R4', nom:'Les quatre familles de règles', fr:'règles du moteur',
    def:"R1 balayage · R2 rupture de structure · R3 zone réactive · R4 position dans le range. Une confirmation en exige deux.",
    ou:"Sélecteur de stratégie et verdict en direct" }
];

function Termes() {
  const [filtre, setFiltre] = useState('');
  const [famille, setFamille] = useState('Toutes');
  // Termes ajoutés par l'utilisateur : ils complètent le vocabulaire du moteur.
  const [persos, setPersos] = useState([]);
  const [concepts, setConcepts] = useState([]);   // base de concepts du moteur (32)
  const [edition, setEdition] = useState(null);
  const [ouvert, setOuvert] = useState(false);
  const [form, setForm] = useState({ sigle:'', nom:'', fr:'', famille:'Autre', def:'', ou:'' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // Deux sources : le lexique personnel (modifiable) et la base de concepts du
  // moteur — celle-la meme qui est injectee dans l'analyse IA avant qu'elle conclue.
  const charger = async () => {
    try {
      const d = await (await api('/termes')).json();
      if (d.success) setPersos(d.termes || []);
    } catch (e) { /* le lexique du moteur reste disponible */ }
    try {
      const d = await (await api('/concepts')).json();
      if (d.success) setConcepts(d.concepts || []);
    } catch (e) { /* les termes du moteur restent affiches */ }
  };
  useEffect(() => { charger(); }, []);

  const VIDE = { sigle:'', nom:'', fr:'', famille:'Autre', def:'', ou:'' };
  // Familles de la base de concepts, alignees sur celles du lexique.
  const CAT_FAMILLE = { structure:'Structure', zones:'Zones', liquidite:'Liquidité',
    prix:'Prix', temps:'Temps', momentum:'Momentum', base:'Base', gestion:'Risque' };
  // Un sigle deja couvert par le lexique n'est pas repete : on ajoute seulement
  // ce que la base de concepts apporte en plus.
  const siglesCouverts = new Set(LEXIQUE.map(t => String(t.sigle).toLowerCase()));
  const duMoteur = concepts.filter(c => {
    const s = String(c.terme || '').split('—')[0].trim().toLowerCase();
    return s && !siglesCouverts.has(s);
  }).map(c => ({
    f: CAT_FAMILLE[c.categorie] || 'Autre',
    sigle: String(c.terme || '').split('—')[0].trim(),
    nom: String(c.terme || '').split('—')[1] ? String(c.terme).split('—')[1].trim() : String(c.terme || ''),
    fr: '',
    def: c.definition,
    ou: (c.identification || [])[0] || 'injecté dans l\'analyse IA',
    piege: (c.pieges || [])[0] || '',
    moteur: true,
    id: 'mc_' + c.id
  }));
  const tous = [
    ...LEXIQUE,
    ...duMoteur,
    ...persos.map(t => ({ f: t.famille, sigle: t.sigle, nom: t.nom, fr: t.fr, def: t.def,
      ou: t.ou || 'terme ajouté par vous', id: t.id, perso: true }))
  ];
  const familles = ['Toutes', ...new Set(tous.map(t => t.f))];
  const liste = tous.filter(t =>
    (famille === 'Toutes' || t.f === famille) &&
    (!filtre.trim() || `${t.sigle} ${t.nom} ${t.fr} ${t.def}`.toLowerCase().includes(filtre.toLowerCase())));

  const enregistrer = async () => {
    if (!form.sigle.trim() || !form.nom.trim()) { setErr('Le sigle et le nom complet sont requis'); return; }
    setBusy(true); setErr('');
    try {
      const r = await api(edition && edition.id ? '/termes/' + edition.id : '/termes', {
        method: edition && edition.id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Enregistrement refusé');
      setEdition(null); setForm(VIDE); setOuvert(false);
      await charger();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const supprimer = async (id) => {
    try { await api('/termes/' + id, { method:'DELETE' }); await charger(); } catch (e) {}
  };

  const ouvrirEdition = (t) => {
    setEdition(t); setOuvert(true); setErr('');
    setForm({ sigle: t.sigle, nom: t.nom, fr: t.fr || '', famille: t.f || 'Autre',
      def: t.def || '', ou: t.ou || '' });
  };

  return (
    <div>
      <Reveal>
        <h2 style={{ margin:'0 0 6px', fontSize:22 }}>
          <i className="fas fa-graduation-cap" style={{ color:'#60a5fa', marginRight:10 }}></i>Termes
        </h2>
        <p style={{ color:'var(--muted)', fontSize:13.5, margin:'0 0 16px', maxWidth:760 }}>
          Chaque terme indique ce que le moteur calcule réellement et où le voir.
          Les {LEXIQUE.length} termes du moteur sont évalués sur chaque graphique avant l'analyse ;
          ajoutez les vôtres pour compléter ce vocabulaire.
        </p>
      </Reveal>

      <Reveal delay={60}>
        <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'center', marginBottom:14 }}>
          <input className="fld" placeholder="Rechercher un terme…" value={filtre}
            onChange={e => setFiltre(e.target.value)} style={{ maxWidth:260 }} />
          {familles.map(f => (
            <button key={f} onClick={() => setFamille(f)}
              className={famille === f ? 'btn sm' : 'btn ghost sm'}>{f}</button>
          ))}
          <button className="btn sm" style={{ marginLeft:'auto' }}
            onClick={() => { setEdition(null); setForm(VIDE); setErr(''); setOuvert(o => !o); }}>
            <i className={`fas ${ouvert ? 'fa-xmark' : 'fa-plus'}`}></i>
            {ouvert ? 'Fermer' : 'Ajouter un terme'}
          </button>
        </div>
      </Reveal>

      {ouvert && (
        <Reveal>
          <div className="panel" style={{ padding:'14px 16px', marginBottom:16,
            display:'grid', gap:9, borderColor:'rgba(96,165,250,.35)' }}>
            <b style={{ fontSize:13 }}>
              {edition ? `Modifier « ${edition.sigle} »` : 'Nouveau terme'}
            </b>
            <div style={{ display:'grid', gap:9, gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))' }}>
              <label style={{ fontSize:12 }}>
                <div style={{ color:'var(--muted)', marginBottom:3 }}>Sigle *</div>
                <input className="fld" value={form.sigle} maxLength={24}
                  onChange={e => setForm(f => ({ ...f, sigle:e.target.value }))} placeholder="ex. IFVG" />
              </label>
              <label style={{ fontSize:12 }}>
                <div style={{ color:'var(--muted)', marginBottom:3 }}>Nom complet *</div>
                <input className="fld" value={form.nom} maxLength={80}
                  onChange={e => setForm(f => ({ ...f, nom:e.target.value }))}
                  placeholder="ex. Inverse Fair Value Gap" />
              </label>
              <label style={{ fontSize:12 }}>
                <div style={{ color:'var(--muted)', marginBottom:3 }}>Nom français</div>
                <input className="fld" value={form.fr} maxLength={60}
                  onChange={e => setForm(f => ({ ...f, fr:e.target.value }))}
                  placeholder="ex. déséquilibre inversé" />
              </label>
              <label style={{ fontSize:12 }}>
                <div style={{ color:'var(--muted)', marginBottom:3 }}>Famille</div>
                <select className="fld" aria-label="Famille de connaissance" value={form.famille}
                  onChange={e => setForm(f => ({ ...f, famille:e.target.value }))}>
                  {['Structure','Zones','Prix','Flux','Risque','Moteur','Autre'].map(x =>
                    <option key={x} value={x}>{x}</option>)}
                </select>
              </label>
            </div>
            <label style={{ fontSize:12 }}>
              <div style={{ color:'var(--muted)', marginBottom:3 }}>Définition</div>
              <textarea className="fld" rows={3} value={form.def} maxLength={600}
                onChange={e => setForm(f => ({ ...f, def:e.target.value }))}
                placeholder="Ce que ce terme signifie, et comment le reconnaître sur un graphique." />
            </label>
            <label style={{ fontSize:12 }}>
              <div style={{ color:'var(--muted)', marginBottom:3 }}>Où le voir dans l'application</div>
              <input className="fld" value={form.ou} maxLength={200}
                onChange={e => setForm(f => ({ ...f, ou:e.target.value }))}
                placeholder="ex. zone repérée à la main sur le graphique" />
            </label>
            {err && <div style={{ fontSize:12, color:'#f87171' }}><i className="fas fa-circle-exclamation" style={{ marginRight:6 }}></i>{err}</div>}
            <div style={{ display:'flex', gap:8 }}>
              <button className="btn sm" onClick={enregistrer} disabled={busy}>
                {busy ? '…' : <><i className="fas fa-check"></i> {edition ? 'Enregistrer' : 'Ajouter'}</>}
              </button>
              <button className="btn ghost sm" onClick={() => { setOuvert(false); setEdition(null); setForm(VIDE); setErr(''); }}>
                Annuler
              </button>
            </div>
          </div>
        </Reveal>
      )}

      <div style={{ display:'grid', gap:10, gridTemplateColumns:'repeat(auto-fit,minmax(330px,1fr))' }}>
        {liste.map(t => (
          <Reveal key={(t.id || t.sigle)} delay={40}>
            <div className="panel" style={{ padding:'14px 16px', height:'100%' }}>
              <div style={{ display:'flex', alignItems:'baseline', gap:8, flexWrap:'wrap' }}>
                <b style={{ fontSize:15, color:'#93c5fd' }}>{t.sigle}</b>
                <span style={{ fontSize:12.5, color:'#e2e8f0' }}>{t.nom}</span>
                <span className="tag" style={{ fontSize:10.5 }}>{t.f}</span>
                {t.perso && (
                  <span style={{ marginLeft:'auto', display:'flex', gap:8 }}>
                    <button onClick={() => ouvrirEdition(t)} title="Modifier"
                      style={{ background:'none', border:'none', color:'#60a5fa', cursor:'pointer', fontSize:12 }}>
                      <i className="fas fa-pen"></i>
                    </button>
                    <button onClick={() => supprimer(t.id)} title="Supprimer"
                      style={{ background:'none', border:'none', color:'#f87171', cursor:'pointer', fontSize:12 }}>
                      <i className="fas fa-trash"></i>
                    </button>
                  </span>
                )}
              </div>
              <div style={{ fontSize:12, color:'var(--dim)', margin:'3px 0 7px' }}>{t.fr}</div>
              <p style={{ margin:'0 0 8px', fontSize:13, color:'var(--muted)', lineHeight:1.6 }}>{t.def}</p>
              <div style={{ fontSize:11.5, color: t.perso ? '#93c5fd' : '#34d399' }}>
                <i className={`fas ${t.perso ? 'fa-user' : 'fa-location-dot'}`} style={{ marginRight:5 }}></i>{t.ou}
              </div>
            </div>
          </Reveal>
        ))}
      </div>
      {!liste.length && (
        <p style={{ color:'var(--dim)', fontSize:13 }}>Aucun terme ne correspond à « {filtre} ».</p>
      )}
    </div>
  );
}

/* ══════════════ DASHBOARD ══════════════ */

/* Outils : donne une page aux modules backend orphelins (calendrier,
   volume, corrélations, COT, taux, patterns, ML, order flow, anomalies,
   comptes, exports, backtest). Chaque panneau charge à la demande. */
const OUTILS_GET = [
  { id:'dashboard',        label:'Tableau de bord',  icon:'fa-gauge-high',            url:'/dashboard' },
  { id:'volume-profile',   label:'Volume Profile',   icon:'fa-chart-column',          url:'/volume-profile',   params:['symbol','tf'] },
  { id:'currency-strength',label:'Force devises',    icon:'fa-money-bill-trend-up',  url:'/currency-strength' },
  { id:'london-breakout',  label:'London Breakout',  icon:'fa-arrow-right-from-bracket', url:'/london-breakout', params:['symbol','tf'] },
  { id:'divergences',      label:'Divergences',      icon:'fa-code-branch',           url:'/divergences',      params:['symbol','tf'] },
  { id:'dynamic-risk',     label:'Risque dynamique', icon:'fa-sliders',               url:'/dynamic-risk',     params:['symbol','tf'] },
  { id:'cot',              label:'COT Report',       icon:'fa-building-columns',      url:'/cot',              params:['symbol'] },
  { id:'interest-rates',   label:'Taux d’intérêt',   icon:'fa-percent',               url:'/interest-rates' },
  { id:'patterns',         label:'Patterns',         icon:'fa-shapes',                url:'/patterns',         params:['symbol','tf'] },
  { id:'signal-scoring',   label:'Score ML',         icon:'fa-brain',                 url:'/signal-scoring' },
  { id:'order-flow',       label:'Order Flow',       icon:'fa-arrow-right-arrow-left',url:'/order-flow',       params:['symbol','tf'] },
  { id:'anomalies',        label:'Anomalies',        icon:'fa-triangle-exclamation', url:'/anomalies',        params:['symbol','tf'] },
  // Analyse complète : rejoue le moteur sur tout l'historique et rend un tableau
  // par famille de concepts ou par stratégie — avec DSR, PBO et hors échantillon.
  { id:'analyse-concepts',   label:'Tous les concepts',    icon:'fa-layer-group', url:'/analyse', params:['symbol','tf'], group:'concept' },
  { id:'analyse-strategies', label:'Toutes les stratégies', icon:'fa-sitemap',     url:'/analyse', params:['symbol','tf'], group:'strategie' }
];

/* ══════════════ SYSTÈME : MODÈLE + RISQUE ══════════════
   Deux choses que l'écran ne montrait nulle part, et sans lesquelles le produit
   reste une liste de signaux : ce que le MODÈLE attend de chaque trade (et s'il
   tient parole), et ce que le COMPTE risque vraiment (taille, exposition,
   plafonds). Un système de trading qui cache ses deux chiffres n'en est pas un. */
function Systeme() {
  const [modele, setModele] = useState(null);
  const [risque, setRisque] = useState(null);
  const [erreur, setErreur] = useState('');
  const [chargement, setChargement] = useState(true);

  const charger = async () => {
    setChargement(true); setErreur('');
    try {
      const [m, r] = await Promise.all([api('/modele'), api('/risque')]);
      const dm = await m.json().catch(() => ({}));
      const dr = await r.json().catch(() => ({}));
      if (dm?.success === false) throw new Error(dm.error || 'modèle indisponible');
      setModele(dm?.success ? dm : null);
      setRisque(dr?.success ? dr : null);
      if (!dm?.success && !dr?.success) throw new Error(dm?.error || dr?.error || 'réponse vide');
    } catch (e) { setErreur(e.message); }
    finally { setChargement(false); }
  };
  useEffect(() => { charger(); }, []);

  const bloc = (titre, icone, children) => (
    <div className="panel" style={{ padding:'14px 16px', marginBottom:14 }}>
      <div style={{ display:'flex', alignItems:'center', gap:9, marginBottom:10 }}>
        <i className={`fas ${icone}`} style={{ color:'#60a5fa' }}></i>
        <b style={{ fontSize:13, color:'#fff' }}>{titre}</b>
      </div>
      {children}
    </div>
  );
  const ligne = (label, valeur, teinte) => (
    <div style={{ display:'flex', justifyContent:'space-between', gap:12, padding:'4px 0', fontSize:12.5 }}>
      <span style={{ color:'var(--muted)' }}>{label}</span>
      <span style={{ color: teinte || 'var(--txt)', fontWeight:600 }}>{valeur}</span>
    </div>
  );

  if (chargement) return <div style={{ padding:20, color:'var(--muted)' }}>Chargement de l'état du système…</div>;
  if (erreur) return (
    <div className="panel" style={{ padding:16 }}>
      <div style={{ color:'#f87171', fontSize:13, marginBottom:8 }}>
        <i className="fas fa-triangle-exclamation" style={{ marginRight:8 }}></i>{erreur}
      </div>
      <button className="btn-ghost" onClick={charger} style={{ fontSize:12 }}>Réessayer</button>
    </div>
  );

  const m = modele?.modele || {};
  const cal = modele?.calibration;
  const et = risque?.etat || {};
  const pl = et.plafonds || {};
  const sim = risque?.simulation || {};

  return (
    <div>
      <div className="panel" style={{ padding:'12px 16px', marginBottom:14, display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
        <i className="fas fa-shield-halved" style={{ color:'#c4b5fd' }}></i>
        <b style={{ fontSize:13, color:'#fff' }}>Système</b>
        <span className="badge" style={{ fontSize:10, background:'rgba(167,139,250,.13)', color:'#c4b5fd' }}>
          modèle v{m.version || '?'}
        </span>
        {m.marches && <span className="badge" style={{ fontSize:10, background:'rgba(96,165,250,.13)', color:'#93c5fd' }}>
          {m.marches.join(' · ')}
        </span>}
        <span style={{ flex:'1 1 auto' }}></span>
        <button className="btn-ghost" onClick={charger} style={{ fontSize:11.5 }}>
          <i className="fas fa-rotate" style={{ marginRight:6 }}></i>rafraîchir
        </button>
      </div>

      {modele && bloc('Modèle — R attendu', 'fa-brain', (
        <div>
          <div style={{ display:'flex', gap:24, flexWrap:'wrap', marginBottom:10 }}>
            <div style={{ minWidth:190 }}>
              {ligne('Arbres', m.arbres ?? '—')}
              {ligne('Features mesurées', m.features ?? '—')}
              {ligne('Seuil appliqué', `${modele.seuilApplique} R`)}
              {ligne('Seuil du décile', `${modele.seuilTop10} R`)}
            </div>
            <div style={{ flex:'1 1 260px', fontSize:11.5, color:'var(--dim)', lineHeight:1.5 }}>
              Le modèle note chaque signal en R attendu, à partir de 6 mois d'historique.
              Il ne remplace pas les règles : il refuse ce dont l'espérance est négative
              et laisse le reste au jugement. Un seuil à 0 ne refuse que le négatif ;
              le décile est la sélection la plus stricte validée.
            </div>
          </div>

          {!cal && (
            <div style={{ fontSize:12, color:'var(--muted)', padding:'8px 10px', borderRadius:8, background:'rgba(148,163,184,.05)' }}>
              <i className="fas fa-hourglass-half" style={{ marginRight:7 }}></i>
              Pas encore assez de trades notés pour mesurer la calibration
              (20 minimum). C'est normal au démarrage : la promesse du modèle se
              vérifie sur les trades tranchés, pas sur son passé d'entraînement.
            </div>
          )}

          {cal && (
            <div>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8, flexWrap:'wrap' }}>
                <span className="badge" style={{ fontSize:10,
                  background: cal.monotone ? 'rgba(34,211,138,.14)' : 'rgba(242,84,91,.14)',
                  color: cal.monotone ? '#34d399' : '#f87171' }}>
                  {cal.monotone ? 'le modèle trie' : 'le modèle ne trie plus'}
                </span>
                <span style={{ fontSize:11.5, color:'var(--muted)' }}>
                  {cal.trades} trade(s) noté(s) · biais moyen {cal.biaisMoyen} R
                </span>
              </div>
              <div style={{ overflowX:'auto' }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11.5 }}>
                  <thead>
                    <tr style={{ color:'var(--dim)', textAlign:'left' }}>
                      <th style={{ padding:'4px 8px', fontWeight:500 }}>tranche</th>
                      <th style={{ padding:'4px 8px', fontWeight:500 }}>n</th>
                      <th style={{ padding:'4px 8px', fontWeight:500 }}>R annoncé</th>
                      <th style={{ padding:'4px 8px', fontWeight:500 }}>R réel</th>
                      <th style={{ padding:'4px 8px', fontWeight:500 }}>biais</th>
                      <th style={{ padding:'4px 8px', fontWeight:500 }}>réussite</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cal.tranches.map(t => (
                      <tr key={t.rang} style={{ borderTop:'1px solid rgba(148,163,184,.12)' }}>
                        <td style={{ padding:'4px 8px', color:'var(--muted)' }}>{t.rang}</td>
                        <td style={{ padding:'4px 8px' }}>{t.n}</td>
                        <td style={{ padding:'4px 8px', color:'#93c5fd' }}>{t.rAttenduMoyen}</td>
                        <td style={{ padding:'4px 8px', color: t.rReelMoyen >= 0 ? '#34d399' : '#f87171' }}>{t.rReelMoyen}</td>
                        <td style={{ padding:'4px 8px', color:'var(--dim)' }}>{t.biais}</td>
                        <td style={{ padding:'4px 8px', color:'var(--dim)' }}>{t.tauxReussite ?? '—'} %</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ fontSize:11, color:'var(--dim)', marginTop:6 }}>
                {cal.lecture}
              </div>
            </div>
          )}
        </div>
      ))}

      {risque && bloc('Risque — compte simulé', 'fa-scale-balanced', (
        <div>
          {et.positionsOuvertes > (pl.maxSimultanes || 0) && (
            <div style={{ fontSize:12, color:'#fbbf24', padding:'8px 10px', borderRadius:8,
              background:'rgba(245,158,11,.08)', border:'1px solid rgba(245,158,11,.25)', marginBottom:10 }}>
              <i className="fas fa-lock" style={{ marginRight:7 }}></i>
              Livre au-delà du plafond : {et.positionsOuvertes} positions ouvertes pour
              {' '}{pl.maxSimultanes} autorisées. <b>Toute nouvelle prise est bloquée</b>
              {' '}jusqu'à ce que des positions se clôturent (60 bougies maximum).
              C'est le garde-fou qui fonctionne, pas une panne.
            </div>
          )}
          <div style={{ display:'flex', gap:26, flexWrap:'wrap' }}>
            <div style={{ minWidth:220 }}>
              <div style={{ fontSize:11, color:'var(--dim)', marginBottom:2 }}>
                Performance simulée — plafonds appliqués
              </div>
              {ligne('Capital', `${sim.capital} (${sim.gainPct >= 0 ? '+' : ''}${sim.gainPct} %)`,
                sim.gainPct >= 0 ? '#34d399' : '#f87171')}
              {ligne('Drawdown max', `${sim.drawdownPct} %`, '#fbbf24')}
              {ligne('Trades pris', `${sim.prises} / ${sim.tradesJournal}`)}
              {ligne('Refusés par les plafonds', sim.refusees, '#fbbf24')}
            </div>
            <div style={{ minWidth:200 }}>
              <div style={{ fontSize:11, color:'var(--dim)', marginBottom:2 }}>
                Livre courant — maintenant
              </div>
              {ligne('Positions ouvertes', `${et.positionsOuvertes ?? 0} / ${pl.maxSimultanes ?? '—'}`)}
              {ligne('Risque engagé', `${et.risqueEngage} (${et.risqueEngagePct} %)`)}
              {ligne('Exposition', `${et.expositionTotale} · levier ${et.levier}×`)}
              {ligne('Perte du jour', `${et.perteJourPct} %`,
                et.perteJourPct >= (pl.maxPerteJourPct || 0) ? '#f87171' : 'var(--txt)')}
            </div>
            <div style={{ flex:'1 1 240px', fontSize:11.5, color:'var(--dim)', lineHeight:1.5 }}>
              La taille se déduit du risque, pas l'inverse : un stop large donne une
              petite position. Les plafonds (perte du jour, positions simultanées,
              risque par marché, levier) bloquent AVANT la prise, avec le chiffre
              qui explique le refus. Aucun ordre n'est passé : c'est la simulation
              de ce que le journal aurait donné.
              {sim.naif && (
                <div style={{ marginTop:8, color:'#fbbf24' }}>
                  <i className="fas fa-circle-info" style={{ marginRight:6 }}></i>
                  Sans plafonds, le même journal afficherait {sim.naif.gainPct >= 0 ? '+' : ''}{sim.naif.gainPct} % —
                  ce chiffre n'est pas atteignable : il compte des trades que le compte n'aurait pas pris.
                </div>
              )}
            </div>
          </div>

          {et.risqueParMarche && Object.keys(et.risqueParMarche).length > 0 && (
            <div style={{ marginTop:10, fontSize:11.5 }}>
              <div style={{ color:'var(--dim)', marginBottom:4 }}>Risque engagé par marché</div>
              {Object.entries(et.risqueParMarche).map(([sym, val]) => (
                <div key={sym} style={{ display:'flex', justifyContent:'space-between', padding:'3px 0', borderTop:'1px solid rgba(148,163,184,.1)' }}>
                  <span style={{ color:'var(--muted)' }}>{sym}</span>
                  <span>{val}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Outils() {
  const [outil, setOutil] = useState(OUTILS_GET[0].id);
  const [symbol, setSymbol] = useState('BTCUSDT');
  // Filtre de sources de l'analyse : « toutes », « motifs » ou « motifs-structure ».
  const [sourcesOutil, setSourcesOutil] = useState('toutes');
  // Filtre de tendance : mesuré ×3,8 sur NQ (+6,49 % → +24,59 % du risque).
  const [filtreTendance, setFiltreTendance] = useState('aucun');
  const [tf, setTf] = useState('1h');
  const [data, setData] = useState(null);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState('');
  const [comptes, setComptes] = useState([]);
  const [nomCompte, setNomCompte] = useState('');
  const [capitalCompte, setCapitalCompte] = useState('10000');
  // Réglages mesurés : chaque préréglage annonce son rendement et son drawdown.
  const [presets, setPresets] = useState([]);
  const [presetChoisi, setPresetChoisi] = useState(null);
  const [messagePreset, setMessagePreset] = useState('');

  useEffect(() => {
    let vivant = true;
    (async () => {
      try {
        const r = await api('/risque/presets');
        const d = await r.json().catch(() => ({}));
        if (vivant && d && d.presets) setPresets(d.presets);
      } catch {}
    })();
    return () => { vivant = false; };
  }, []);

  const appliquerPreset = async (nom) => {
    try {
      setMessagePreset('Application…');
      const r = await api('/risque/preset', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nom })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.success) throw new Error(d.error || ('HTTP ' + r.status));
      setPresetChoisi(d);
      setMessagePreset(`Appliqué : ${d.titre} — ${d.configuration.risquePct} % par trade · `
        + `${d.configuration.maxSimultanes} positions`);
    } catch (e) { setMessagePreset('Échec : ' + e.message); }
  };

  const chargerComptes = async () => {
    try {
      const r = await api('/accounts');
      const d = await r.json();
      if (d?.success) setComptes(d.comptes || d.accounts || []);
    } catch {}
  };
  useEffect(() => { chargerComptes(); }, []);

  const appeler = async (url, options) => {
    setChargement(true); setErreur(''); setData(null);
    try {
      const r = await api(url, options);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || ('HTTP ' + r.status));
      setData(d);
    } catch (e) { setErreur(e.message); }
    finally { setChargement(false); }
  };

  const charger = async () => {
    const o = OUTILS_GET.find(x => x.id === outil);
    if (!o) return;
    const q = new URLSearchParams();
    if ((o.params || []).includes('symbol')) q.set('symbol', symbol);
    if ((o.params || []).includes('tf')) q.set('tf', tf);
    // L'analyse coûte cher (tout l'historique) : on borne et on le dit.
    if (o.group) {
      q.set('group', o.group); q.set('bougies', '2500'); q.set('pas', '4');
      if (sourcesOutil !== 'toutes') {
        q.set('sources', sourcesOutil === 'motifs' ? 'motif,structure' : 'motif');
      }
      if (filtreTendance === 'tendance') q.set('regime', '1');
    }
    appeler(o.url + (q.toString() ? '?' + q.toString() : ''));
  };

  const lancerBacktest = () => appeler('/backtest', {
    method:'POST', headers:{ 'Content-Type':'application/json' },
    body: JSON.stringify({ symbol, tf, riskPct: 1, initialCapital: 10000 })
  });

  const creerCompte = async () => {
    if (!nomCompte.trim()) return;
    try {
      const r = await api('/accounts', { method:'POST', headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ nom: nomCompte.trim(), capital: Number(capitalCompte) || 10000 }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || ('HTTP ' + r.status));
      setNomCompte(''); chargerComptes();
    } catch (e) { setErreur(e.message); }
  };

  const supprimerCompte = async (id) => {
    try {
      await api(`/accounts/${encodeURIComponent(id)}`, { method:'DELETE' });
      chargerComptes();
    } catch (e) { setErreur(e.message); }
  };

  return (
    <div style={{ display:'grid', gap:14 }}>
      <div className="panel" style={{ padding:18 }}>
        <h3 style={{ margin:'0 0 10px' }}><i className="fas fa-toolbox"></i> Modules d'analyse</h3>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'end' }}>
          <div>
            <label className="lbl">Module</label>
            <select className="fld" aria-label="Outil à exécuter" value={outil} onChange={e=>{setOutil(e.target.value);setData(null);setErreur('');}}>
              {OUTILS_GET.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className="lbl">Symbole</label>
            <input className="fld" aria-label="Symbole analysé" value={symbol}
              onChange={e=>setSymbol(e.target.value.toUpperCase())} style={{ width:130 }} />
          </div>
          <div>
            <label className="lbl">Unité</label>
            <select className="fld" aria-label="Unité de temps de l'outil" value={tf} onChange={e=>setTf(e.target.value)}>
              {['1m','5m','15m','1h','4h','1d'].map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          {/* Les signaux de stratégie perdent de l'argent en quotidien
              (−0,19 R par trade mesuré sur NQ). Le filtre doit être à un clic,
              pas caché dans une requête. */}
          <div>
            <label className="lbl">Sources</label>
            <select className="fld" aria-label="Sources de signaux analysées" value={sourcesOutil}
              onChange={e=>setSourcesOutil(e.target.value)}>
              <option value="toutes">Toutes</option>
              <option value="motifs">Sans les stratégies</option>
              <option value="motifs-structure">Motifs + structure</option>
            </select>
          </div>
          {/* Le filtre de tendance : ×3,8 sur NQ, et il sauve l'or (+0,4 % → +23,5 %). */}
          <div>
            <label className="lbl">Tendance</label>
            <select className="fld" aria-label="Filtre de tendance" value={filtreTendance}
              onChange={e=>setFiltreTendance(e.target.value)}>
              <option value="aucun">Aucun filtre</option>
              <option value="tendance">Suivre la tendance</option>
            </select>
          </div>
          <button className="btn" onClick={charger} disabled={chargement}>
            {chargement ? 'Chargement…' : 'Charger'}
          </button>
          <button className="btn ghost" onClick={lancerBacktest} disabled={chargement}>Backtest</button>
        </div>
        {erreur && <div style={{ color:'var(--bad)', marginTop:10, fontSize:13 }}>{erreur}</div>}

        {/* Analyse par familles : un tableau, pas un tas de JSON. */}
        {data && Array.isArray(data.lignes) && (
          <div style={{ marginTop:14 }}>
            <div style={{ display:'flex', gap:14, flexWrap:'wrap', alignItems:'baseline', fontSize:12.5, color:'var(--muted)' }}>
              <span><b style={{ color:'var(--txt)' }}>{data.symbol}</b> {data.tf}</span>
              <span>{data.bougies} bougies · {data.trades} trades</span>
              <span>{data.lignes.length} famille(s)</span>
              <span>espérance <b style={{ color: data.esperance >= 0 ? 'var(--ok)' : 'var(--bad)' }}>
                {data.esperance >= 0 ? '+' : ''}{data.esperance} R</b></span>
              <span>total <b>{data.totalR} R</b></span>
              <span>PBO <b style={{ color: data.pbo > 0.5 ? 'var(--bad)' : 'var(--ok)' }}>
                {data.pbo === null ? 'n/a' : (data.pbo * 100).toFixed(1) + ' %'}</b></span>
              <span>essais {data.essais}</span>
              {/* L'analyse tourne désormais avec spread + glissement d'un spread.
                  Sans cette ligne, l'espérance affichée serait celle d'un monde
                  où l'on est toujours rempli au prix exact. */}
              {data.frais && data.frais.prudent && (
                <span style={{ color:'#fbbf24' }}>
                  frais inclus : spread {data.frais.spread} + glissement {data.frais.glissement}
                </span>
              )}
              {/* La ventilation par source, en clair : sur NQ 10 ans, motif
                  +0,08 R, structure +0,11 R, strategie −0,19 R. */}
              {data.parSource && Object.entries(data.parSource).map(([src, v]) => (
                <span key={src} style={{ color: (v.r / v.total) >= 0 ? 'var(--ok)' : 'var(--bad)' }}>
                  {src} {(v.r / v.total).toFixed(3)} R sur {v.total}
                </span>
              ))}
              <span style={{ color:'var(--dim)' }}>{data.source}</span>
            </div>

            {data.synthetique && (
              <div style={{ marginTop:8, fontSize:11.5, padding:'7px 10px', borderRadius:7,
                background:'rgba(239,68,68,.08)', border:'1px solid rgba(239,68,68,.35)', color:'#fca5a5' }}>
                <b>Instrument synthétique.</b> {data.avertissement}
              </div>
            )}

            <div tabIndex={0} role="region" aria-label="Analyse par famille"
              style={{ marginTop:10, maxHeight:420, overflow:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                <thead>
                  <tr style={{ color:'var(--muted)', textAlign:'right' }}>
                    <th style={{ textAlign:'left', padding:'6px 8px' }}>Famille</th>
                    <th>trades</th><th>total R</th><th>espérance</th>
                    <th>1re moitié</th><th>2e moitié</th><th>Sharpe</th><th>PSR</th><th>survit</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lignes.map(l => (
                    <tr key={l.nom} style={{ borderTop:'1px solid var(--border)' }}>
                      <td style={{ textAlign:'left', padding:'6px 8px' }}>{l.nom}</td>
                      <td style={{ textAlign:'right' }}>{l.n}</td>
                      <td style={{ textAlign:'right' }}>{l.totalR}</td>
                      <td style={{ textAlign:'right', color: l.esperance >= 0 ? 'var(--ok)' : 'var(--bad)' }}>
                        {l.esperance >= 0 ? '+' : ''}{l.esperance}
                      </td>
                      <td style={{ textAlign:'right', color: (l.is ?? 0) >= 0 ? 'var(--muted)' : 'var(--bad)' }}>{l.is ?? '—'}</td>
                      <td style={{ textAlign:'right', color: (l.oos ?? 0) >= 0 ? 'var(--muted)' : 'var(--bad)' }}>{l.oos ?? '—'}</td>
                      <td style={{ textAlign:'right' }}>{l.sharpe}</td>
                      <td style={{ textAlign:'right' }}>{l.psr ?? '—'}</td>
                      <td style={{ textAlign:'center' }}>
                        {l.survit
                          ? <span className="badge" style={{ background:'rgba(16,185,129,.15)', color:'var(--ok)' }}>oui</span>
                          : <span style={{ color:'var(--dim)' }}>non</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display:'flex', gap:8, marginTop:10, flexWrap:'wrap' }}>
              <a className="btn ghost sm"
                href={`/api/export/analyse.csv?symbol=${encodeURIComponent(data.symbol)}&tf=${data.tf}&group=${data.group}&bougies=2500&pas=4`}>
                <i className="fas fa-file-csv"></i> CSV de cette analyse
              </a>
              <span style={{ fontSize:11.5, color:'var(--dim)', alignSelf:'center' }}>
                « survit » = PSR au-dessus du seuil de sélection, donc l'avantage ne s'explique
                pas par le nombre d'essais. « 1re / 2e moitié » = régularité dans le temps.
              </span>
            </div>
          </div>
        )}

        {/* Score ML : le seul chiffre publiable est HORS échantillon. Un modèle
            entraîné sur 1 trade n'est pas un modèle, et une accuracy mesurée sur
            ses propres données ne mesure que sa mémoire. */}
        {data && data.statut && (
          <div className="panel" style={{ marginTop:12, padding:16 }}>
            <h3 style={{ margin:'0 0 8px', fontSize:14 }}>
              <i className="fas fa-brain" style={{ marginRight:8, color:'#a78bfa' }}></i>
              Scoring ML — {data.statut === 'entraîné' ? 'modèle entraîné' : 'aucun modèle entraîné'}
            </h3>
            <div style={{ display:'grid', gap:6, fontSize:12.5 }}>
              <div style={{ color:'var(--muted)' }}>
                Trades clôturés : <b style={{ color:'#fff' }}>{data.tradesClotures}</b>
                {' '}· minimum requis : <b style={{ color:'#fff' }}>{data.minimumRequis}</b>
                {' '}(5 trades par paramètre × 6)
              </div>
              {data.avertissement && (
                <div style={{ color:'#fbbf24', padding:'7px 10px', borderRadius:7,
                  background:'rgba(245,158,11,.09)', border:'1px solid rgba(245,158,11,.3)' }}>
                  <i className="fas fa-triangle-exclamation" style={{ marginRight:7 }}></i>
                  {data.avertissement}
                </div>
              )}
              <div style={{ color:'var(--muted)' }}>
                Mesure hors échantillon :{' '}
                {data.horsEchantillon && data.horsEchantillon.valide
                  ? <b style={{ color:'#6ee7b7' }}>
                      {Math.round(data.horsEchantillon.metrics.accuracy * 100)} % d'exactitude
                      sur {data.horsEchantillon.test} trades jamais vus
                      {' '}(F1 {data.horsEchantillon.metrics.f1})
                    </b>
                  : <span style={{ color:'var(--dim)' }}>
                      non calculable — {data.horsEchantillon ? data.horsEchantillon.raison : 'données insuffisantes'}
                    </span>}
              </div>
              {data.appliqueAuxDecisions === false && (
                <div style={{ color:'var(--dim)', fontSize:11.5 }}>
                  Ce score ne pondère encore aucune décision : il est mesuré, pas appliqué.
                </div>
              )}
            </div>
          </div>
        )}

        {/* Les autres modules rendent encore du JSON : c'est leur nature. */}
        {data && !Array.isArray(data.lignes) && (
          <pre style={{ marginTop:12, maxHeight:420, overflow:'auto' }}>{JSON.stringify(data, null, 2)}</pre>
        )}
      </div>

      {/* Réglages MESURÉS : chaque préréglage porte son rendement, son drawdown
          et son ratio. Ce ne sont pas des opinions, ce sont des simulations
          reproductibles (voir tools/reglage-risque.js). */}
      <div className="panel" style={{ padding:18 }}>
        <h3 style={{ margin:'0 0 4px' }}><i className="fas fa-sliders"></i> Réglages mesurés</h3>
        <div style={{ color:'var(--dim)', fontSize:12, marginBottom:12 }}>
          8 indices + or, argent, cuivre, coton, café · quotidien · frais et glissement inclus
        </div>
        {presets.length === 0 && <div style={{ color:'var(--muted)', fontSize:13 }}>Chargement…</div>}
        <div style={{ display:'grid', gap:10, gridTemplateColumns:'repeat(auto-fit, minmax(250px, 1fr))' }}>
          {presets.map(p => (
            <div key={p.nom} style={{ border:'1px solid var(--border)', borderRadius:10, padding:12 }}>
              <div style={{ fontWeight:600, fontSize:13, marginBottom:4 }}>{p.titre}</div>
              <div style={{ color:'var(--dim)', fontSize:12, marginBottom:8 }}>{p.mesure}</div>
              <div style={{ display:'flex', gap:6, flexWrap:'wrap', alignItems:'center', marginBottom:8 }}>
                <span className="tag">{p.risquePct} % / trade</span>
                <span className="tag">{p.maxSimultanes} positions</span>
                {p.regime && <span className="tag">filtre de tendance</span>}
                {p.sources && <span className="tag">{p.sources.join(' + ')}</span>}
              </div>
              <button className="btn" onClick={()=>appliquerPreset(p.nom)}>
                Appliquer
              </button>
            </div>
          ))}
        </div>
        {messagePreset && (
          <div style={{ marginTop:10, fontSize:12, color: messagePreset.startsWith('Échec') ? 'var(--bad)' : 'var(--ok)' }}>
            {messagePreset}
          </div>
        )}
        {presetChoisi && (
          <div style={{ marginTop:6, fontSize:12, color:'var(--dim)' }}>
            Sources à passer au backtest : <b>{presetChoisi.sources ? presetChoisi.sources.join(', ') : 'toutes'}</b>
            {' · '}filtre de tendance : <b>{presetChoisi.regime ? 'actif' : 'inactif'}</b>
          </div>
        )}
      </div>

      <div className="panel" style={{ padding:18 }}>
        <h3 style={{ margin:'0 0 10px' }}><i className="fas fa-wallet"></i> Comptes</h3>
        {comptes.length === 0 && <div style={{ color:'var(--muted)', fontSize:13 }}>Aucun compte.</div>}
        {comptes.map(c => (
          <div key={c.id} style={{ display:'flex', gap:8, alignItems:'center', padding:'6px 0', borderBottom:'1px solid var(--border)' }}>
            <strong>{c.nom}</strong>
            <span style={{ color:'var(--muted)', fontSize:13 }}>{c.capital} {c.devise || 'USD'}</span>
            <button className="btn ghost sm" onClick={()=>supprimerCompte(c.id)}>Supprimer</button>
          </div>
        ))}
        <div style={{ display:'flex', gap:8, marginTop:10, flexWrap:'wrap', alignItems:'end' }}>
          <div>
            <label className="lbl">Nom</label>
            <input className="fld" value={nomCompte} onChange={e=>setNomCompte(e.target.value)} placeholder="Compte démo" />
          </div>
          <div>
            <label className="lbl">Capital</label>
            <input className="fld" value={capitalCompte} onChange={e=>setCapitalCompte(e.target.value)} style={{ width:120 }} />
          </div>
          <button className="btn ghost" onClick={creerCompte}>Créer</button>
        </div>
      </div>

      <div className="panel" style={{ padding:18 }}>
        <h3 style={{ margin:'0 0 10px' }}><i className="fas fa-download"></i> Exports</h3>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          <a className="btn ghost sm" href="/api/export/pdf">
            <i className="fas fa-file-lines"></i> Rapport HTML
          </a>
          <a className="btn ghost sm" href="/api/export/csv">
            <i className="fas fa-file-csv"></i> Journal CSV (mes trades)
          </a>
          {/* Le journal du MOTEUR : concept, conditions, R annoncé, R net, taille,
              risque. C'est celui qui permet de vérifier le système dans un tableur. */}
          <a className="btn ghost sm" href="/api/export/csv?source=signaux">
            <i className="fas fa-microchip"></i> Signaux CSV (moteur)
          </a>
        </div>
        <p style={{ margin:'10px 0 0', fontSize:11.5, color:'var(--dim)' }}>
          « Mes trades » = ce que vous avez saisi. « Signaux » = ce que le moteur a
          détecté, avec une ligne par signal et une colonne par mesure (24 colonnes).
        </p>
      </div>
    </div>
  );
}

function Dashboard({ user, onLogout }) {
  const [tab, setTab] = useState('live');
  // Sur mobile, la barre du bas ne garde que l'essentiel ; le reste s'ouvre ici.
  const [plusOuvert, setPlusOuvert] = useState(false);
  const [result, setResult] = useState(null);
  const [strategies, setStrategies] = useState([]);
  const [history, setHistory] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);


  const load = useCallback(async () => {
    try {
      const [k,h,st] = await Promise.all([
        api('/knowledge').then(r=>r.ok?r.json():null),
        api('/history').then(r=>r.ok?r.json():null),
        api('/stats').then(r=>r.ok?r.json():null)
      ]);
      if (k?.success) setStrategies(k.strategies);
      if (h?.success) setHistory(h.history);
      if (st?.success) setStats(st);
    } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Raccourcis clavier (theme.js) : nav (1-5), rafraîchir (R), fermer (Échap).
  // Seuls les onglets existants sont acceptés.
  useEffect(() => {
    const onNav = (e) => {
      if (NAV.some(n => n.id === e.detail)) { setTab(e.detail); setPlusOuvert(false); }
    };
    const onRefresh = () => load();
    const onEscape = () => setPlusOuvert(false);
    window.addEventListener('5trade-nav', onNav);
    window.addEventListener('5trade-refresh', onRefresh);
    window.addEventListener('5trade-escape', onEscape);
    return () => {
      window.removeEventListener('5trade-nav', onNav);
      window.removeEventListener('5trade-refresh', onRefresh);
      window.removeEventListener('5trade-escape', onEscape);
    };
  }, [load]);

  const del = async (id) => {
    await api(`/knowledge/${id}`, { method:'DELETE' });
    load();
  };

  // Report d'un plan d'analyse vers le journal : on bascule d'onglet et on
  // transmet le contexte. `_t` force un nouvel objet pour que l'effet du
  // Journal se redéclenche même si on clique deux fois sur le même plan.
  const [prefill, setPrefill] = useState(null);
  const sendToJournal = (data) => {
    setPrefill({ ...data, _t: Date.now() });
    setTab('journal');
  };

  // Onglets toujours visibles sur mobile, et ceux ranges dans « Plus ».
  const NAV_PRINCIPAL = ['live', 'analyze', 'strategies', 'journal'];
  const NAV_SECONDAIRE = ['add', 'history', 'news', 'termes', 'alerts', 'outils', 'systeme'];

  const NAV = [
    { id:'live',       label:'Direct',    icon:'fa-satellite-dish' },
    { id:'analyze',    label:'Analyse',   icon:'fa-crosshairs' },
    { id:'add',        label:'Ajouter',   icon:'fa-circle-plus' },
    { id:'strategies', label:'Stratégies',icon:'fa-book' },
    { id:'journal',    label:'Journal',   icon:'fa-receipt' },
    // Les news sont une entrée de premier niveau : un système de trading qui
    // ignore le calendrier économique trade dans le vide.
    { id:'news',       label:'News',      icon:'fa-newspaper' },
    { id:'history',    label:'Historique',icon:'fa-clock-rotate-left' },
    { id:'termes',     label:'Termes',    icon:'fa-graduation-cap' },
    { id:'alerts',     label:'Alertes',    icon:'fa-bell' },
    { id:'outils',     label:'Outils',     icon:'fa-toolbox' },
    // Le modèle et le risque sont deux entrées de premier niveau du produit :
    // ce sont les seules qui disent si un signal vaut quelque chose et de quelle
    // taille le prendre.
    { id:'systeme',    label:'Système',    icon:'fa-shield-halved' }
  ];

    return (
    <div style={{ minHeight:'100vh' }} className="pad-mobile">

      <header style={{ position:'sticky', top:0, zIndex:40, borderBottom:'1px solid var(--border)',
              background:'rgba(9,13,20,.82)', backdropFilter:'blur(16px)' }}>
              <div className="hdr" style={{ maxWidth:1240, margin:'0 auto', padding:'12px 20px', display:'flex',
                justifyContent:'space-between', alignItems:'center', gap:14, flexWrap:'wrap' }}>
                <div style={{ display:'flex', alignItems:'center', gap:14 }}>
                  {/* Logo 5trade : le mot en toutes lettres, rien à côté */}
                  <a className="logo-5trade" href="/" title="5trade — Accueil">
                    <span>5trade</span>
                  </a>
                  <span className="badge" style={{ background:'rgba(16,185,129,.12)', color:'#34d399' }}>
                    <span className="dot-live"></span>en ligne
                  </span>
                  <span className="badge" style={{ background:'rgba(148,163,184,.1)', color:'var(--dim)' }}
                    title="Version de l'interface. Si elle ne correspond pas à la dernière livrée, rechargez avec Ctrl+Maj+R.">
                    {UI_VERSION}
                  </span>
                  {stats && (
                    <span className="badge" style={{ background:'rgba(148,163,184,.1)', color:'var(--muted)' }}>
                      <i className="fas fa-database"></i>{stats.total} stratégies
                    </span>
                  )}
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                  <span style={{ fontSize:12.5, color:'var(--muted)' }}>
                    <i className="fas fa-user-astronaut" style={{ marginRight:6 }}></i>
                    {user.username}
                    {user.handle && <span style={{ color:'var(--dim)' }}> · {user.handle}</span>}
                  </span>
                  <button className="btn ghost sm" onClick={onLogout}>
                    <i className="fas fa-right-from-bracket"></i>Déconnexion
                  </button>
                </div>
              </div>
            </header>

      <main className="wrap">
              <div className="nav" style={{ marginBottom:20 }}>
                {NAV.map(n => (
                  <button key={n.id}
                    className={`nav-item ${tab===n.id?'on':''}`} onClick={()=>setTab(n.id)}>
                    <i className={`fas ${n.icon}`}></i>{n.label}
                  </button>
                ))}
              </div>

        {loading ? (
          <div style={{ display:'grid', gap:14 }}>
            <div className="stat-grid">
              {[0,1,2].map(i => <div key={i} className="panel" style={{padding:18}}>
                <Skeleton h={11} w="52%" /><Skeleton h={28} w="40%" style={{marginTop:10}} /></div>)}
            </div>
            <div className="panel" style={{ padding:22 }}>
              <Skeleton h={16} w="34%" />
              <Skeleton h={44} style={{ marginTop:16 }} />
              <Skeleton h={120} style={{ marginTop:12 }} />
            </div>
          </div>
        ) : (<>
          {tab === 'analyze' && (<>
            <div className="stat-grid" style={{ marginBottom:18 }}>
              <StatTile icon="fa-database" label="Stratégies" value={stats?.total || 0} color="#60a5fa" delay={0} />
              <StatTile icon="fa-globe" label="Scrapées du web" value={(stats?.bySource?.search||0)+(stats?.bySource?.scrape||0)}
                color="var(--accent2)" delay={70} />
              <StatTile icon="fa-clock-rotate-left" label="Analyses" value={history.length} color="#34d399" delay={140} />
            </div>
            <Analyzer onDone={setResult} />
            {result && <Result result={result} onToJournal={sendToJournal} />}
          </>)}

          <Garde>
            {tab === 'live' && <LiveMarket onToJournal={sendToJournal} />}
            {tab === 'add' && <AddKnowledge refresh={load} />}
            {tab === 'strategies' && <Strategies strategies={strategies} onDelete={del} onSaved={load} />}
            {tab === 'journal' && <Journal prefill={prefill} onPrefillUsed={()=>setPrefill(null)} strategies={strategies} />}
            {tab === 'history' && <History history={history} />}
            {tab === 'termes' && <Termes />}
            {tab === 'news' && <NewsPage />}
            {tab === 'alerts' && <Alertes />}
            {tab === 'outils' && <Outils />}
            {tab === 'systeme' && <Systeme />}
          </Garde>
        </>)}
      </main>

      {/* Barre mobile : cinq cibles au maximum, la norme pour un pouce.
          Les onglets secondaires vivent dans « Plus » au lieu de s'entasser. */}
      <nav className="mobile-nav">
        {NAV.filter(n => NAV_PRINCIPAL.includes(n.id)).map(n => (
          <button key={n.id} className={`mnav-btn ${tab===n.id?'on':''}`}
            onClick={()=>{setTab(n.id);setPlusOuvert(false);}}>
            <i className={`fas ${n.icon}`} style={{ fontSize:16 }}></i>{n.label}
          </button>
        ))}
        <button className={`mnav-btn ${plusOuvert || NAV_SECONDAIRE.includes(tab) ? 'on' : ''}`}
          onClick={()=>setPlusOuvert(o=>!o)}>
          <i className={`fas ${plusOuvert ? 'fa-xmark' : 'fa-ellipsis'}`} style={{ fontSize:16 }}></i>
          {plusOuvert ? 'Fermer' : 'Plus'}
        </button>
      </nav>
      {plusOuvert && (
        <div className="mobile-plus">
          {NAV.filter(n => NAV_SECONDAIRE.includes(n.id)).map(n => (
            <button key={n.id} className={tab===n.id?'on':''}
              onClick={()=>{setTab(n.id);setPlusOuvert(false);}}>
              <i className={`fas ${n.icon}`}></i>{n.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ══════════════ APP ══════════════ */

function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    api('/me')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.user) setUser(d.user); })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);

  const logout = async () => {
    try { await api('/logout', { method:'POST' }); } catch {}
    setUser(null);
  };

  if (checking) {
    return (
      <>
        
        <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:20 }}>
            <Loader3D size={56} />
            <span style={{ color:'var(--muted)', fontSize:13 }}>
              Chargement de 5trade…
            </span>
          </div>
        </div>
      </>
    );
  }
  return (
    <>
      
      {user ? <Dashboard user={user} onLogout={logout} /> : <Auth onLogin={setUser} />}
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
