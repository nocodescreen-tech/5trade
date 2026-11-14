const {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback
} = React;
const RB = window.ReactBits || {};
const {
  SplashCursor,
  SpotlightCard,
  LatticeLoader,
  Counter
} = RB;
const API_BASE = window.location.port === '5173' || window.location.protocol === 'file:' ? 'http://localhost:3001/api' : '/api';

// Version de l'interface (affichée en en-tête) : permet de voir d'un coup d'œil
// si la page ouverte est bien la dernière, ou une version restée en cache.
const UI_VERSION = 'r2026-11-14a';
const api = (path, opts = {}) => fetch(`${API_BASE}${path}`, {
  credentials: 'include',
  ...opts
});
const REDUCED = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ══════════════ Primitives animées ══════════════ */

function Reveal({
  children,
  delay = 0,
  className = '',
  style = {}
}) {
  const ref = useRef(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (REDUCED()) {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        setSeen(true);
        io.disconnect();
      }
    }, {
      threshold: 0.12,
      rootMargin: '0px 0px -40px'
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return /*#__PURE__*/React.createElement("div", {
    ref: ref,
    className: `reveal ${seen ? 'in' : ''} ${className}`,
    style: {
      transitionDelay: `${delay}ms`,
      ...style
    }
  }, children);
}
function Tilt({
  children,
  max = 9,
  scale = 1.015,
  className = '',
  style = {}
}) {
  const ref = useRef(null);
  const onMove = e => {
    const el = ref.current;
    if (!el || REDUCED()) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `perspective(900px) rotateY(${px * max * 2}deg) rotateX(${-py * max * 2}deg) scale(${scale})`;
  };
  const reset = () => {
    if (ref.current) ref.current.style.transform = '';
  };
  return /*#__PURE__*/React.createElement("div", {
    ref: ref,
    className: `tilt ${className}`,
    style: style,
    onMouseMove: onMove,
    onMouseLeave: reset
  }, children);
}
function Skeleton({
  h = 14,
  w = '100%',
  r = 8,
  style = {}
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "skel",
    style: {
      height: h,
      width: w,
      borderRadius: r,
      ...style
    }
  });
}
function Spinner({
  size = 16,
  color = '#fff'
}) {
  return /*#__PURE__*/React.createElement("span", {
    className: "spin",
    style: {
      width: size,
      height: size,
      borderTopColor: color
    }
  });
}

/* Curseur animé : halo + anneau + point, ripples au clic */
function CursorFX() {
  useEffect(() => {
    if (REDUCED()) return;
    if (window.matchMedia('(hover: none), (pointer: coarse)').matches) return;
    const glow = document.getElementById('fx-glow');
    const ring = document.getElementById('fx-ring');
    const dot = document.getElementById('fx-dot');
    if (!glow || !ring || !dot) return;
    let mx = window.innerWidth / 2,
      my = window.innerHeight / 2;
    let gx = mx,
      gy = my,
      rx = mx,
      ry = my,
      raf = 0;
    const onMove = e => {
      mx = e.clientX;
      my = e.clientY;
      dot.style.transform = `translate(${mx}px,${my}px) translate(-50%,-50%)`;
    };
    const onOver = e => {
      const t = e.target.closest('button, a, input, select, textarea, .drop, .tilt');
      ring.style.width = t ? '52px' : '36px';
      ring.style.height = t ? '52px' : '36px';
    };
    const onDown = e => {
      ring.classList.add('click');
      const sp = document.createElement('span');
      sp.className = 'fx-ripple';
      sp.style.left = e.clientX + 'px';
      sp.style.top = e.clientY + 'px';
      document.body.appendChild(sp);
      setTimeout(() => sp.remove(), 760);
    };
    const onUp = () => ring.classList.remove('click');
    const loop = () => {
      gx += (mx - gx) * 0.10;
      gy += (my - gy) * 0.10;
      rx += (mx - rx) * 0.22;
      ry += (my - ry) * 0.22;
      glow.style.transform = `translate(${gx}px,${gy}px) translate(-50%,-50%)`;
      ring.style.transform = `translate(${rx}px,${ry}px) translate(-50%,-50%)`;
      raf = requestAnimationFrame(loop);
    };
    glow.style.opacity = '1';
    window.addEventListener('mousemove', onMove, {
      passive: true
    });
    window.addEventListener('mouseover', onOver, {
      passive: true
    });
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
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    id: "fx-glow"
  }), /*#__PURE__*/React.createElement("div", {
    id: "fx-ring"
  }), /*#__PURE__*/React.createElement("div", {
    id: "fx-dot"
  }));
}

/* Loader 3D — cube en rotation */
function Loader3D({
  size = 42,
  label = ''
}) {
  const half = size / 2;
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "cube-wrap",
    style: {
      width: size,
      height: size
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "cube",
    style: {
      '--d': `${half}px`
    }
  }, [0, 1, 2, 3, 4, 5].map(i => /*#__PURE__*/React.createElement("b", {
    key: i
  })))), label && /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--muted)',
      fontSize: 13
    }
  }, label));
}

/* Validation 3D — coche animée */
function Check3D({
  label = 'Vérifié'
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 14,
      padding: '10px 0'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "check3d"
  }, /*#__PURE__*/React.createElement("span", {
    className: "check-ring"
  }), /*#__PURE__*/React.createElement("i", {
    className: "fas fa-check"
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      color: '#6ee7b7',
      fontSize: 13.5,
      fontWeight: 600
    }
  }, label));
}
function ActionBadge({
  action
}) {
  const map = {
    BUY: {
      bg: 'rgba(16,185,129,.16)',
      fg: '#34d399',
      br: 'rgba(16,185,129,.4)',
      ic: 'fa-arrow-trend-up'
    },
    SELL: {
      bg: 'rgba(239,68,68,.16)',
      fg: '#f87171',
      br: 'rgba(239,68,68,.4)',
      ic: 'fa-arrow-trend-down'
    },
    HOLD: {
      bg: 'rgba(245,158,11,.16)',
      fg: '#fbbf24',
      br: 'rgba(245,158,11,.4)',
      ic: 'fa-pause'
    },
    WAIT: {
      bg: 'rgba(148,163,184,.16)',
      fg: '#cbd5e1',
      br: 'rgba(148,163,184,.35)',
      ic: 'fa-hourglass-half'
    }
  };
  const s = map[action] || map.HOLD;
  return /*#__PURE__*/React.createElement("span", {
    className: "badge",
    style: {
      background: s.bg,
      color: s.fg,
      border: `1px solid ${s.br}`
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: `fas ${s.ic}`
  }), action);
}
function StatTile({
  icon,
  label,
  value,
  decimals = 0,
  suffix = '',
  color = '#60a5fa',
  delay = 0
}) {
  return /*#__PURE__*/React.createElement(Reveal, {
    delay: delay
  }, /*#__PURE__*/React.createElement(Tilt, {
    max: 7
  }, /*#__PURE__*/React.createElement(SpotlightCard, {
    className: "panel",
    spotlightColor: "rgba(37,99,235,.22)"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '16px 18px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 9,
      color: 'var(--muted)',
      fontSize: 11.5,
      fontWeight: 700,
      letterSpacing: '.05em',
      textTransform: 'uppercase'
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: `fas ${icon}`,
    style: {
      color
    }
  }), label), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 6,
      color: '#fff',
      fontWeight: 800,
      fontSize: 30,
      letterSpacing: '-1px'
    }
  }, Counter ? /*#__PURE__*/React.createElement(Counter, {
    value: value,
    decimals: decimals,
    suffix: suffix,
    fontSize: 30
  }) : `${value}${suffix}`)))));
}

/* ══════════════ MASCOTTE ANIMÉE ══════════════ */

function AuthMascot({
  mode = 'login',
  focus = null
}) {
  const covering = focus === 'password';
  const lookingUp = focus === 'username' || focus === 'email' || covering;
  const look = focus === 'username' ? -3 : focus === 'email' ? 0 : covering ? 0 : 3;
  return /*#__PURE__*/React.createElement("div", {
    className: "mascot-bob",
    style: {
      display: 'flex',
      justifyContent: 'center',
      marginBottom: -4
    }
  }, /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 200 214",
    width: "152",
    height: "163",
    className: `mascot ${mode}`,
    role: "img",
    "aria-label": "Assistant 5trade"
  }, /*#__PURE__*/React.createElement("defs", null, /*#__PURE__*/React.createElement("linearGradient", {
    id: "mBody",
    x1: "0",
    y1: "0",
    x2: "1",
    y2: "1"
  }, /*#__PURE__*/React.createElement("stop", {
    offset: "0",
    stopColor: "#55677f"
  }), /*#__PURE__*/React.createElement("stop", {
    offset: "1",
    stopColor: "#2c3648"
  })), /*#__PURE__*/React.createElement("linearGradient", {
    id: "mHead",
    x1: "0",
    y1: "0",
    x2: "0",
    y2: "1"
  }, /*#__PURE__*/React.createElement("stop", {
    offset: "0",
    stopColor: "#1b2434"
  }), /*#__PURE__*/React.createElement("stop", {
    offset: "1",
    stopColor: "#121826"
  })), /*#__PURE__*/React.createElement("radialGradient", {
    id: "mGlow",
    cx: "50%",
    cy: "50%"
  }, /*#__PURE__*/React.createElement("stop", {
    offset: "0",
    stopColor: "rgba(37,99,235,.15)"
  }), /*#__PURE__*/React.createElement("stop", {
    offset: "1",
    stopColor: "rgba(37,99,235,0)"
  }))), /*#__PURE__*/React.createElement("ellipse", {
    cx: "100",
    cy: "206",
    rx: "56",
    ry: "10",
    fill: "rgba(37,99,235,.07)"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "100",
    cy: "96",
    r: "86",
    fill: "url(#mGlow)"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M62 205 C62 152 78 130 100 130 C122 130 138 152 138 205 Z",
    fill: "url(#mBody)"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M100 130 L100 205",
    stroke: "rgba(255,255,255,.13)",
    strokeWidth: "1.4"
  }), /*#__PURE__*/React.createElement("g", {
    style: {
      opacity: covering ? 0 : 1,
      transition: 'opacity .35s ease'
    }
  }, /*#__PURE__*/React.createElement("path", {
    d: "M64 144 C47 154 41 170 46 185",
    stroke: "#3d4c66",
    strokeWidth: "12",
    fill: "none",
    strokeLinecap: "round"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M136 144 C153 154 159 170 154 185",
    stroke: "#3d4c66",
    strokeWidth: "12",
    fill: "none",
    strokeLinecap: "round"
  })), /*#__PURE__*/React.createElement("circle", {
    cx: "100",
    cy: "84",
    r: "45",
    fill: "url(#mHead)",
    stroke: "rgba(148,163,184,.3)",
    strokeWidth: "1.6"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M55 76 C57 46 78 31 100 31 C122 31 143 46 145 76 C131 63 118 59 100 59 C82 59 69 63 55 76 Z",
    fill: "url(#mBody)"
  }), /*#__PURE__*/React.createElement("g", {
    className: "blink",
    style: {
      transformOrigin: '100px 82px',
      transformBox: 'view-box'
    }
  }, /*#__PURE__*/React.createElement("ellipse", {
    cx: "86",
    cy: "82",
    rx: "10.5",
    ry: "11.5",
    fill: "#080c14",
    stroke: "rgba(148,163,184,.4)",
    strokeWidth: "1.2"
  }), /*#__PURE__*/React.createElement("ellipse", {
    cx: "114",
    cy: "82",
    rx: "10.5",
    ry: "11.5",
    fill: "#080c14",
    stroke: "rgba(148,163,184,.4)",
    strokeWidth: "1.2"
  })), /*#__PURE__*/React.createElement("g", {
    style: {
      transform: `translate(${look}px,${lookingUp ? -1.5 : 1.5}px)`,
      transition: 'transform .5s cubic-bezier(.3,1,.3,1)'
    }
  }, /*#__PURE__*/React.createElement("circle", {
    cx: "86",
    cy: "82",
    r: "4.6",
    fill: "#7fa8d8"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "114",
    cy: "82",
    r: "4.6",
    fill: "#7fa8d8"
  })), /*#__PURE__*/React.createElement("g", {
    style: {
      opacity: covering ? 1 : 0,
      transform: `scale(${covering ? 1 : 0.55})`,
      transformOrigin: '100px 84px',
      transformBox: 'view-box',
      transition: 'opacity .26s, transform .34s cubic-bezier(.2,.9,.2,1)'
    }
  }, /*#__PURE__*/React.createElement("circle", {
    cx: "85",
    cy: "80",
    r: "15",
    fill: "#3d4c66"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "115",
    cy: "80",
    r: "15",
    fill: "#3d4c66"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "85",
    cy: "80",
    r: "15",
    fill: "none",
    stroke: "rgba(255,255,255,.2)",
    strokeWidth: "1.2"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "115",
    cy: "80",
    r: "15",
    fill: "none",
    stroke: "rgba(255,255,255,.2)",
    strokeWidth: "1.2"
  })), /*#__PURE__*/React.createElement("path", {
    d: covering ? 'M92 106 Q100 100 108 106' : mode === 'signup' ? 'M88 101 Q100 113 112 101' : 'M90 104 Q100 109 110 104',
    stroke: "#8dc0ff",
    strokeWidth: "3",
    fill: "none",
    strokeLinecap: "round",
    style: {
      transition: 'transform .3s'
    }
  })));
}

/* ══════════════ AUTH ══════════════ */

function Auth({
  onLogin
}) {
  const [mode, setMode] = useState('login');
  const [step, setStep] = useState('creds');
  const [form, setForm] = useState({
    username: '',
    email: '',
    password: ''
  });
  const [digits, setDigits] = useState(['', '', '', '', '', '']);
  const [ctx, setCtx] = useState({
    username: '',
    purpose: '',
    email: ''
  });
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
      if (d.exists) setMode('login');else {
        setMode('signup');
        setForm(f => ({
          ...f,
          email: d.ownerEmail || ''
        }));
      }
    }).catch(() => {});
  }, []);
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);
  const submitCreds = async e => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    setInfo('');
    try {
      const r = await api(`/${mode}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(form)
      });
      const d = await r.json();
      if (d.success && d.otpRequired) {
        setCtx({
          username: form.username,
          purpose: d.purpose,
          email: d.email
        });
        setDigits(['', '', '', '', '', '']);
        setStep('otp');
        setCooldown(60);
        setInfo(`Code envoyé à ${d.email}`);
        setTimeout(() => boxes.current[0] && boxes.current[0].focus(), 120);
      } else if (d.success && d.user) onLogin(d.user);else setErr(d.error || 'Erreur');
    } catch {
      setErr('Serveur injoignable');
    } finally {
      setBusy(false);
    }
  };
  const setDigit = (i, v) => {
    const c = v.replace(/\D/g, '');
    if (!c) {
      const n = [...digits];
      n[i] = '';
      setDigits(n);
      return;
    }
    if (c.length > 1) {
      // coller le code complet
      const n = [...digits];
      c.slice(0, 6).split('').forEach((ch, k) => {
        if (i + k < 6) n[i + k] = ch;
      });
      setDigits(n);
      const last = Math.min(i + c.length, 5);
      boxes.current[last] && boxes.current[last].focus();
      return;
    }
    const n = [...digits];
    n[i] = c;
    setDigits(n);
    if (i < 5) boxes.current[i + 1] && boxes.current[i + 1].focus();
  };
  const onKey = (i, e) => {
    if (e.key === 'Backspace' && !digits[i] && i > 0) boxes.current[i - 1] && boxes.current[i - 1].focus();
    if (e.key === 'ArrowLeft' && i > 0) boxes.current[i - 1].focus();
    if (e.key === 'ArrowRight' && i < 5) boxes.current[i + 1].focus();
  };
  const code = digits.join('');
  const submitOtp = async e => {
    if (e) e.preventDefault();
    if (code.length !== 6 || busy) return;
    setBusy(true);
    setErr('');
    try {
      const r = await api('/verify-otp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          username: ctx.username,
          code,
          purpose: ctx.purpose
        })
      });
      const d = await r.json();
      if (d.success) {
        setOk(true);
        setTimeout(() => onLogin(d.user), 1150);
      } else {
        setErr(d.error || 'Code invalide');
        setDigits(['', '', '', '', '', '']);
        boxes.current[0] && boxes.current[0].focus();
      }
    } catch {
      setErr('Serveur injoignable');
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (code.length === 6) submitOtp();
  }, [code]);
  const resend = async () => {
    if (cooldown > 0) return;
    setErr('');
    try {
      const r = await api('/resend-otp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          username: ctx.username,
          purpose: ctx.purpose
        })
      });
      const d = await r.json();
      if (d.success) {
        setInfo(`Nouveau code envoyé à ${d.email}`);
        setCooldown(60);
      } else setErr(d.error || 'Erreur');
    } catch {
      setErr('Serveur injoignable');
    }
  };
  const pwd = form.password || '';
  const strength = (pwd.length >= 8 ? 1 : 0) + (/[A-Z]/.test(pwd) ? 1 : 0) + (/[a-z]/.test(pwd) ? 1 : 0) + (/[0-9]/.test(pwd) ? 1 : 0) + (/[^A-Za-z0-9]/.test(pwd) ? 1 : 0);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 20
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: '100%',
      maxWidth: 440
    }
  }, /*#__PURE__*/React.createElement(Reveal, null, /*#__PURE__*/React.createElement(Tilt, {
    max: 6,
    scale: 1
  }, /*#__PURE__*/React.createElement(SpotlightCard, {
    className: "panel glow-ring",
    spotlightColor: "rgba(37,99,235,.25)"
  }, /*#__PURE__*/React.createElement("div", {
    className: "auth-card",
    style: {
      position: 'relative',
      overflow: 'hidden'
    }
  }, ok && /*#__PURE__*/React.createElement("div", {
    className: "modal-veil",
    style: {
      position: 'absolute',
      inset: 0,
      zIndex: 9,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(7,10,17,.9)',
      backdropFilter: 'blur(8px)',
      borderRadius: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "modal-card"
  }, /*#__PURE__*/React.createElement(Check3D, {
    label: "Identit\xE9 v\xE9rifi\xE9e"
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'center',
      marginBottom: 18
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "auth-title",
    style: {
      fontSize: 26,
      fontWeight: 800,
      letterSpacing: '-.6px',
      color: 'var(--txt)',
      lineHeight: 1.15
    }
  }, "5trade"), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 6,
      fontSize: 12.5,
      color: 'var(--muted)',
      lineHeight: 1.45
    }
  }, "Plateforme d'analyse de trading assist\xE9e par IA")), step === 'creds' && /*#__PURE__*/React.createElement("div", {
    className: "mascot-wrap"
  }, /*#__PURE__*/React.createElement(AuthMascot, {
    mode: mode,
    focus: focus
  })), step === 'creds' && /*#__PURE__*/React.createElement("div", {
    className: "authpane",
    key: mode
  }, /*#__PURE__*/React.createElement("div", {
    className: "seg",
    role: "tablist",
    "aria-label": "Connexion ou inscription",
    style: {
      marginBottom: 16
    }
  }, ['login', 'signup'].map(m => /*#__PURE__*/React.createElement("button", {
    key: m,
    className: `seg-item ${mode === m ? 'on' : ''}`,
    type: "button",
    role: "tab",
    "aria-selected": mode === m,
    onClick: () => {
      setMode(m);
      setErr('');
      setInfo('');
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: `fas ${m === 'login' ? 'fa-right-to-bracket' : 'fa-user-plus'}`,
    "aria-hidden": "true"
  }), m === 'login' ? 'Connexion' : 'Inscription'))), /*#__PURE__*/React.createElement("form", {
    onSubmit: submitCreds
  }, /*#__PURE__*/React.createElement("label", {
    className: "lbl"
  }, "Nom d'utilisateur"), /*#__PURE__*/React.createElement("input", {
    className: "fld",
    value: form.username,
    autoFocus: true,
    required: true,
    onFocus: () => setFocus('username'),
    onBlur: () => setFocus(null),
    onChange: e => setForm({
      ...form,
      username: e.target.value
    })
  }), mode === 'signup' && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("label", {
    className: "lbl"
  }, "Email de v\xE9rification"), /*#__PURE__*/React.createElement("input", {
    className: "fld",
    type: "email",
    value: form.email,
    onFocus: () => setFocus('email'),
    onBlur: () => setFocus(null),
    onChange: e => setForm({
      ...form,
      email: e.target.value
    })
  })), /*#__PURE__*/React.createElement("label", {
    className: "lbl"
  }, "Mot de passe"), /*#__PURE__*/React.createElement("input", {
    className: "fld",
    type: "password",
    value: form.password,
    required: true,
    onFocus: () => setFocus('password'),
    onBlur: () => setFocus(null),
    onChange: e => setForm({
      ...form,
      password: e.target.value
    })
  }), mode === 'signup' && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 5,
      marginTop: 9
    }
  }, [0, 1, 2, 3, 4].map(i => /*#__PURE__*/React.createElement("span", {
    key: i,
    style: {
      flex: 1,
      height: 4,
      borderRadius: 9,
      background: i < strength ? strength <= 2 ? '#ef4444' : strength <= 3 ? '#f59e0b' : '#10b981' : 'rgba(27,36,51,.9)',
      transition: 'background .3s'
    }
  }))), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 11,
      color: 'var(--dim)',
      marginTop: 7,
      lineHeight: 1.5
    }
  }, "8 caract\xE8res minimum, avec majuscule, minuscule et chiffre. Un code de v\xE9rification sera envoy\xE9 par email.")), err && /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'rgba(239,68,68,.12)',
      border: '1px solid rgba(239,68,68,.35)',
      color: '#fca5a5',
      padding: 11,
      borderRadius: 11,
      marginTop: 12,
      fontSize: 13
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-circle-exclamation",
    style: {
      marginRight: 7
    }
  }), err), info && /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'rgba(16,185,129,.1)',
      border: '1px solid rgba(16,185,129,.3)',
      color: '#6ee7b7',
      padding: 11,
      borderRadius: 11,
      marginTop: 12,
      fontSize: 13
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-circle-check",
    style: {
      marginRight: 7
    }
  }), info), /*#__PURE__*/React.createElement("button", {
    className: "btn",
    type: "submit",
    disabled: busy,
    style: {
      width: '100%',
      marginTop: 16
    }
  }, busy ? /*#__PURE__*/React.createElement(Spinner, null) : /*#__PURE__*/React.createElement("i", {
    className: `fas ${mode === 'login' ? 'fa-right-to-bracket' : 'fa-user-plus'}`
  }), mode === 'login' ? 'Se connecter' : "S'inscrire"))), step === 'otp' && /*#__PURE__*/React.createElement("form", {
    onSubmit: submitOtp,
    className: "authpane",
    key: "otp"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'center',
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "floaty",
    style: {
      display: 'inline-flex',
      width: 52,
      height: 52,
      borderRadius: 15,
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(37,99,235,.14)',
      border: '1px solid rgba(37,99,235,.3)'
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-shield-halved",
    style: {
      fontSize: 21,
      color: '#60a5fa'
    }
  })), /*#__PURE__*/React.createElement("p", {
    style: {
      color: 'var(--muted)',
      fontSize: 13,
      marginTop: 11,
      lineHeight: 1.6
    }
  }, "Saisissez le code \xE0 6 chiffres envoy\xE9 \xE0", /*#__PURE__*/React.createElement("br", null), /*#__PURE__*/React.createElement("b", {
    style: {
      color: 'var(--txt)'
    }
  }, ctx.email))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      justifyContent: 'center'
    }
  }, digits.map((d, i) => /*#__PURE__*/React.createElement("input", {
    key: i,
    ref: el => boxes.current[i] = el,
    className: `otp-box otp-in ${d ? 'filled' : ''}`,
    style: {
      animationDelay: `${i * 55}ms`
    },
    value: d,
    inputMode: "numeric",
    maxLength: 6,
    autoComplete: i === 0 ? 'one-time-code' : 'off',
    onChange: e => setDigit(i, e.target.value),
    onKeyDown: e => onKey(i, e),
    onFocus: e => e.target.select()
  }))), busy && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'center',
      marginTop: 16
    }
  }, /*#__PURE__*/React.createElement(Loader3D, {
    size: 40,
    label: "V\xE9rification du code\u2026"
  })), err && /*#__PURE__*/React.createElement("div", {
    className: "shake",
    style: {
      background: 'rgba(239,68,68,.12)',
      border: '1px solid rgba(239,68,68,.35)',
      color: '#fca5a5',
      padding: 11,
      borderRadius: 11,
      marginTop: 12,
      fontSize: 13,
      textAlign: 'center'
    }
  }, err), info && /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'rgba(16,185,129,.1)',
      border: '1px solid rgba(16,185,129,.3)',
      color: '#6ee7b7',
      padding: 11,
      borderRadius: 11,
      marginTop: 12,
      fontSize: 13,
      textAlign: 'center'
    }
  }, info), /*#__PURE__*/React.createElement("button", {
    className: "btn ok",
    type: "submit",
    disabled: busy || code.length !== 6,
    style: {
      width: '100%',
      marginTop: 16
    }
  }, busy ? /*#__PURE__*/React.createElement(Spinner, null) : /*#__PURE__*/React.createElement("i", {
    className: "fas fa-check"
  }), "Valider"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      marginTop: 12
    }
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "btn ghost sm",
    onClick: () => {
      setStep('creds');
      setErr('');
      setInfo('');
      setDigits(['', '', '', '', '', '']);
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-arrow-left"
  }), "Retour"), /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "btn ghost sm",
    onClick: resend,
    disabled: cooldown > 0
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-rotate-right"
  }), cooldown > 0 ? `Renvoyer (${cooldown}s)` : 'Renvoyer le code'))))))), /*#__PURE__*/React.createElement("p", {
    style: {
      textAlign: 'center',
      color: 'var(--dim)',
      fontSize: 11.5,
      marginTop: 16
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-lock",
    style: {
      marginRight: 6
    }
  }), "Connexion s\xE9curis\xE9e \xB7 session httpOnly \xB7 validation par code \xE0 usage unique")));
}

/* ══════════════ ANALYSE ══════════════ */

function Analyzer({
  onDone
}) {
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
  const add = fl => {
    const arr = Array.from(fl).filter(f => f.type.startsWith('image/'));
    setFiles(prev => [...prev, ...arr].slice(0, 4));
  };
  const stepLabels = ['Analyse des graphiques…', 'Recherche dans la base…', 'Combinaison des stratégies…', 'Génération du plan…'];
  const run = async () => {
    if (!files.length) {
      setErr('Ajoutez au moins une capture.');
      return;
    }
    setBusy(true);
    setErr('');
    setProg(8);
    setPhase(stepLabels[0]);
    let i = 0;
    timer.current = setInterval(() => {
      i = Math.min(i + 1, stepLabels.length - 1);
      setPhase(stepLabels[i]);
      setProg(p => Math.min(p + 22, 88));
    }, 2200);
    const fd = new FormData();
    files.forEach(f => fd.append('charts', f));
    fd.append('pair', pair);
    fd.append('timeframes', tfs);
    fd.append('notes', notes);
    fd.append('maxStrategies', String(maxStrat));
    try {
      const r = await api('/analyze', {
        method: 'POST',
        body: fd
      });
      const d = await r.json();
      if (d.success) {
        setProg(100);
        setPhase('Terminé');
        setTimeout(() => {
          onDone(d);
          setBusy(false);
          setProg(0);
          setPhase('');
        }, 420);
      } else {
        setErr(d.error || 'Erreur d\'analyse');
        setBusy(false);
        setProg(0);
      }
    } catch (e) {
      setErr('Erreur: ' + e.message);
      setBusy(false);
      setProg(0);
    } finally {
      clearInterval(timer.current);
    }
  };
  return /*#__PURE__*/React.createElement(Reveal, null, /*#__PURE__*/React.createElement(SpotlightCard, {
    className: "panel",
    spotlightColor: "rgba(37,99,235,.2)"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '22px 22px 24px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      flexWrap: 'wrap',
      gap: 10,
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: 18,
      fontWeight: 800,
      display: 'flex',
      alignItems: 'center',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-images",
    style: {
      color: '#60a5fa'
    }
  }), "Analyse multi-timeframe"), /*#__PURE__*/React.createElement("span", {
    className: "badge",
    style: {
      background: 'rgba(37,99,235,.14)',
      color: '#8fb4ff'
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-layer-group"
  }), "jusqu'\xE0 4 captures")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 14,
      gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "lbl",
    style: {
      marginTop: 0
    }
  }, "Paire"), /*#__PURE__*/React.createElement("input", {
    className: "fld",
    value: pair,
    onChange: e => setPair(e.target.value.toUpperCase())
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "lbl",
    style: {
      marginTop: 0
    }
  }, "Timeframes (ordre des images)"), /*#__PURE__*/React.createElement("input", {
    className: "fld",
    value: tfs,
    onChange: e => setTfs(e.target.value),
    placeholder: "M5, M30, H1"
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "lbl",
    style: {
      marginTop: 0
    }
  }, "Strat\xE9gies \xE0 combiner"), /*#__PURE__*/React.createElement("select", {
    className: "fld",
    "aria-label": "Nombre maximum de strat\xE9gies analys\xE9es",
    value: maxStrat,
    onChange: e => setMaxStrat(e.target.value)
  }, [2, 3, 4].map(n => /*#__PURE__*/React.createElement("option", {
    key: n,
    value: n
  }, n))))), /*#__PURE__*/React.createElement("label", {
    className: "lbl"
  }, "Contexte du trader (optionnel)"), /*#__PURE__*/React.createElement("textarea", {
    className: "fld",
    rows: "2",
    value: notes,
    onChange: e => setNotes(e.target.value),
    placeholder: "Ex : scalp London sur XAUUSD, biais H1 haussier\u2026"
  }), /*#__PURE__*/React.createElement("div", {
    className: `drop ${hot ? 'hot' : ''}`,
    style: {
      marginTop: 16
    },
    onClick: () => document.getElementById('f-charts').click(),
    onDragOver: e => {
      e.preventDefault();
      setHot(true);
    },
    onDragLeave: () => setHot(false),
    onDrop: e => {
      e.preventDefault();
      setHot(false);
      add(e.dataTransfer.files);
    }
  }, /*#__PURE__*/React.createElement("input", {
    id: "f-charts",
    type: "file",
    accept: "image/*",
    multiple: true,
    style: {
      display: 'none'
    },
    onChange: e => add(e.target.files)
  }), /*#__PURE__*/React.createElement("div", {
    className: "floaty",
    style: {
      display: 'inline-flex',
      width: 52,
      height: 52,
      borderRadius: 15,
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(37,99,235,.12)'
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-cloud-arrow-up",
    style: {
      fontSize: 22,
      color: '#60a5fa'
    }
  })), /*#__PURE__*/React.createElement("p", {
    style: {
      color: 'var(--muted)',
      marginTop: 10,
      fontSize: 13.5,
      fontWeight: 600
    }
  }, "Glissez vos captures TradingView ici"), /*#__PURE__*/React.createElement("p", {
    style: {
      color: 'var(--dim)',
      fontSize: 11.5,
      marginTop: 4
    }
  }, "ou cliquez \xB7 PNG / JPG \xB7 4 max")), files.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 12,
      gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))',
      marginTop: 14
    }
  }, files.map((f, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    className: "thumb"
  }, /*#__PURE__*/React.createElement("img", {
    src: URL.createObjectURL(f),
    alt: f.name
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      top: 6,
      left: 6,
      background: 'rgba(7,10,17,.82)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      padding: '2px 8px',
      fontSize: 10.5,
      fontWeight: 700,
      color: '#8fb4ff'
    }
  }, (tfs.split(',')[i] || `#${i + 1}`).trim()), /*#__PURE__*/React.createElement("button", {
    onClick: () => setFiles(files.filter((_, j) => j !== i)),
    style: {
      position: 'absolute',
      top: 6,
      right: 6,
      width: 24,
      height: 24,
      borderRadius: 8,
      border: '1px solid rgba(239,68,68,.4)',
      background: 'rgba(7,10,17,.82)',
      color: '#f87171',
      cursor: 'pointer',
      fontSize: 11
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-times"
  }))))), busy && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "bar"
  }, /*#__PURE__*/React.createElement("i", {
    style: {
      width: `${prog}%`
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      marginTop: 10,
      color: 'var(--muted)',
      fontSize: 12.5
    }
  }, /*#__PURE__*/React.createElement(Spinner, {
    size: 15,
    color: "#60a5fa"
  }), /*#__PURE__*/React.createElement("span", null, phase), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: 'auto',
      color: 'var(--dim)'
    }
  }, prog, "%"))), err && /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'rgba(239,68,68,.12)',
      border: '1px solid rgba(239,68,68,.35)',
      color: '#fca5a5',
      padding: 11,
      borderRadius: 11,
      marginTop: 12,
      fontSize: 13
    }
  }, err), /*#__PURE__*/React.createElement("button", {
    className: "btn ok",
    style: {
      width: '100%',
      marginTop: 16,
      padding: '13px'
    },
    onClick: run,
    disabled: busy || !files.length
  }, busy ? /*#__PURE__*/React.createElement(Spinner, null) : /*#__PURE__*/React.createElement("i", {
    className: "fas fa-bolt"
  }), busy ? 'Analyse en cours…' : "Lancer l'analyse"))));
}

/* ══════════════ RÉSULTAT ══════════════ */

function Result({
  result,
  onToJournal
}) {
  const [open, setOpen] = useState(false);
  const {
    analysis,
    recommendations: rec
  } = result;

  // On ne devine jamais un prix : le plan est textuel (zone/déclencheur).
  // On reporte paire, sens, stratégies et le plan en notes ; le trader saisit
  // ses vrais niveaux dans le journal.
  const toJournal = () => onToJournal && onToJournal({
    pair: analysis.pair,
    direction: rec.action === 'SELL' ? 'SELL' : 'BUY',
    strategyIds: (rec.strategiesUsed || []).map(s => s.id).filter(Boolean),
    originAnalysisId: analysis.analysisId || null,
    notes: [`Plan ${rec.action} (${rec.confidence})`, rec.reason, rec.entry && rec.entry.zone ? `Zone : ${rec.entry.zone}` : null, rec.entry && rec.entry.trigger ? `Déclencheur : ${rec.entry.trigger}` : null].filter(Boolean).join('\n')
  });
  const KV = ({
    k,
    v
  }) => /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      gap: 12,
      padding: '6px 0',
      borderBottom: '1px solid rgba(27,36,51,.55)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--muted)',
      fontSize: 12.5
    }
  }, k), /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 600,
      fontSize: 13,
      textAlign: 'right'
    }
  }, v || '—'));
  return /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 18
    }
  }, /*#__PURE__*/React.createElement(Reveal, null, /*#__PURE__*/React.createElement(SpotlightCard, {
    className: "panel",
    spotlightColor: "rgba(16,185,129,.18)"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '22px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: 19,
      fontWeight: 800,
      display: 'flex',
      alignItems: 'center',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-crosshairs",
    style: {
      color: '#34d399'
    }
  }), "Plan d'action \u2014 ", analysis.pair), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement(ActionBadge, {
    action: rec.action
  }), /*#__PURE__*/React.createElement("span", {
    className: "badge",
    style: {
      background: 'rgba(148,163,184,.12)',
      color: 'var(--muted)'
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-gauge-high"
  }), rec.confidence), /*#__PURE__*/React.createElement("span", {
    className: "badge",
    style: {
      background: 'rgba(148,163,184,.12)',
      color: 'var(--muted)'
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-image"
  }), analysis.imagesAnalyzed), onToJournal && /*#__PURE__*/React.createElement("button", {
    className: "btn sm",
    onClick: toJournal,
    title: "Reporter ce plan dans le journal de trades"
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-receipt"
  }), "Enregistrer ce trade"))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 14,
      padding: 15,
      borderRadius: 13,
      background: 'linear-gradient(135deg,rgba(16,185,129,.11),rgba(37,99,235,.07))',
      borderLeft: '3px solid #10b981',
      fontSize: 13.5,
      lineHeight: 1.7
    }
  }, rec.reason, rec.strategiesCombined && rec.strategiesCombined.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 9
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11.5,
      color: 'var(--muted)',
      fontWeight: 600
    }
  }, "COMBINAISON : "), rec.strategiesCombined.map((s, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    className: "tag"
  }, s))))))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 14,
      gridTemplateColumns: 'repeat(auto-fit,minmax(290px,1fr))',
      marginTop: 14
    }
  }, [{
    t: 'Entrée',
    ic: 'fa-sign-in-alt',
    c: '#60a5fa',
    rows: [['Zone', rec.entry?.zone], ['Déclencheur', rec.entry?.trigger], ['Timeframe', rec.entry?.timeframe]]
  }, {
    t: 'Stop Loss & Risque',
    ic: 'fa-shield-halved',
    c: '#f87171',
    rows: [['Stop loss', rec.stopLoss?.level], ['Logique', rec.stopLoss?.reason], ['Risque / trade', rec.riskManagement?.riskPerTrade], ['R:R', rec.riskManagement?.rr]]
  }].map((box, idx) => /*#__PURE__*/React.createElement(Reveal, {
    key: box.t,
    delay: 80 + idx * 70
  }, /*#__PURE__*/React.createElement("div", {
    className: "panel",
    style: {
      padding: 18,
      height: '100%'
    }
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      fontWeight: 700,
      fontSize: 14,
      marginBottom: 10,
      display: 'flex',
      alignItems: 'center',
      gap: 9
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: `fas ${box.ic}`,
    style: {
      color: box.c
    }
  }), box.t), box.rows.map(([k, v]) => /*#__PURE__*/React.createElement(KV, {
    key: k,
    k: k,
    v: v
  })))))), rec.takeProfit && rec.takeProfit.length > 0 && /*#__PURE__*/React.createElement(Reveal, {
    delay: 140
  }, /*#__PURE__*/React.createElement("div", {
    className: "panel",
    style: {
      padding: 18,
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      fontWeight: 700,
      fontSize: 14,
      marginBottom: 10,
      display: 'flex',
      alignItems: 'center',
      gap: 9
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-bullseye",
    style: {
      color: '#34d399'
    }
  }), "Objectifs"), rec.takeProfit.map((tp, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: 'flex',
      gap: 12,
      alignItems: 'center',
      padding: '9px 12px',
      borderRadius: 10,
      background: 'rgba(16,185,129,.07)',
      marginBottom: 7,
      border: '1px solid rgba(16,185,129,.18)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "badge",
    style: {
      background: 'rgba(16,185,129,.18)',
      color: '#34d399'
    }
  }, "TP", i + 1), /*#__PURE__*/React.createElement("b", {
    style: {
      fontSize: 13.5
    }
  }, tp.level), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--muted)',
      fontSize: 12.5
    }
  }, tp.reason))))), rec.executionPlan && rec.executionPlan.length > 0 && /*#__PURE__*/React.createElement(Reveal, {
    delay: 180
  }, /*#__PURE__*/React.createElement("div", {
    className: "panel",
    style: {
      padding: 18,
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      fontWeight: 700,
      fontSize: 14,
      marginBottom: 12,
      display: 'flex',
      alignItems: 'center',
      gap: 9
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-list-ol",
    style: {
      color: '#fbbf24'
    }
  }), "Plan d'ex\xE9cution"), rec.executionPlan.map((s, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: 'flex',
      gap: 12,
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flexShrink: 0,
      width: 28,
      height: 28,
      borderRadius: 9,
      background: 'rgba(245,158,11,.16)',
      border: '1px solid rgba(245,158,11,.35)',
      color: '#fbbf24',
      fontWeight: 800,
      fontSize: 12.5,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, s.step), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      paddingBottom: 8,
      borderBottom: '1px solid rgba(27,36,51,.5)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      fontWeight: 700,
      color: '#fbbf24'
    }
  }, s.when), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13.5,
      marginTop: 3,
      lineHeight: 1.6
    }
  }, s.do), s.before && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: 'var(--muted)',
      marginTop: 3
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-arrow-left",
    style: {
      marginRight: 5
    }
  }), "Avant : ", s.before)))))), rec.nextSteps && rec.nextSteps.length > 0 && /*#__PURE__*/React.createElement(Reveal, {
    delay: 210
  }, /*#__PURE__*/React.createElement("div", {
    className: "panel",
    style: {
      padding: 18,
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      fontWeight: 700,
      fontSize: 14,
      marginBottom: 9,
      display: 'flex',
      alignItems: 'center',
      gap: 9
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-forward",
    style: {
      color: '#60a5fa'
    }
  }), "Ensuite"), rec.nextSteps.map((s, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      fontSize: 13.5,
      color: '#c9d4e0',
      padding: '4px 0',
      display: 'flex',
      gap: 9
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-chevron-right",
    style: {
      color: '#2563eb',
      fontSize: 10,
      marginTop: 6
    }
  }), s)))), rec.invalidation && /*#__PURE__*/React.createElement(Reveal, {
    delay: 240
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 14,
      padding: 14,
      borderRadius: 12,
      background: 'rgba(239,68,68,.1)',
      border: '1px solid rgba(239,68,68,.3)'
    }
  }, /*#__PURE__*/React.createElement("b", {
    style: {
      fontSize: 13,
      color: '#f87171'
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-ban",
    style: {
      marginRight: 7
    }
  }), "Invalidation"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      color: '#fca5a5',
      marginLeft: 7
    }
  }, rec.invalidation))), /*#__PURE__*/React.createElement(Reveal, {
    delay: 260
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 16
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn ghost sm",
    onClick: () => setOpen(!open)
  }, /*#__PURE__*/React.createElement("i", {
    className: `fas fa-chevron-${open ? 'up' : 'down'}`
  }), open ? 'Masquer' : 'Voir', " l'analyse visuelle d\xE9taill\xE9e"), open && /*#__PURE__*/React.createElement("pre", {
    className: "panel-soft",
    style: {
      marginTop: 11,
      padding: 16,
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      fontSize: 13,
      lineHeight: 1.65,
      color: '#c9d4e0',
      fontFamily: 'ui-monospace,Consolas,monospace',
      maxHeight: 400,
      overflow: 'auto'
    }
  }, analysis.visionAnalysis), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 12,
      fontSize: 11.5,
      color: 'var(--dim)'
    }
  }, rec.candidatesFound, " strat\xE9gie(s) trouv\xE9e(s) \xB7 ", rec.strategiesUsed?.length || 0, " retenue(s) pour la combinaison"))));
}

/* ══════════════ AJOUT DE CONNAISSANCE ══════════════ */

function AddKnowledge({
  refresh
}) {
  const [tab, setTab] = useState('upload');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const [manual, setManual] = useState({
    title: '',
    content: '',
    type: 'strategy'
  });
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
    setBusy(true);
    setRes(null);
    try {
      const r = await api(path, {
        method: 'POST',
        headers: isForm ? {} : {
          'Content-Type': 'application/json'
        },
        body: isForm ? body : JSON.stringify(body)
      });
      const d = await r.json();
      setRes({
        ok: d.success !== false,
        data: d
      });
      if (d.success) refresh();
    } catch (e) {
      setRes({
        ok: false,
        data: {
          error: e.message
        }
      });
    } finally {
      setBusy(false);
    }
  };

  /** Envoie la description au moteur, qui la structure et l'enregistre. */
  const analyserDescription = async () => {
    setDecrireBusy(true);
    setDecrireErr('');
    setFiche(null);
    try {
      const r = await api('/strategies/decrire', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          texte: decrire
        })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Analyse refusée');
      setFiche(d);
      refresh();
    } catch (e) {
      setDecrireErr(e.message);
    } finally {
      setDecrireBusy(false);
    }
  };
  const METHODS = [{
    id: 'decrire',
    label: 'Décrire',
    icon: 'fa-wand-magic-sparkles'
  }, {
    id: 'upload',
    label: 'Documents',
    icon: 'fa-file-arrow-up'
  }, {
    id: 'manual',
    label: 'Manuel',
    icon: 'fa-pen'
  }, {
    id: 'url',
    label: 'Depuis URL',
    icon: 'fa-link'
  }, {
    id: 'search',
    label: 'Recherche web',
    icon: 'fa-magnifying-glass'
  }, {
    id: 'forum',
    label: 'Forums',
    icon: 'fa-comments'
  }];
  const summary = (() => {
    if (!res) return null;
    const d = res.data;
    if (d.saved) return `${d.saved.length} stratégie(s) sauvegardée(s) · ${d.found?.length || 0} résultat(s) trouvé(s)`;
    if (d.results) return d.results.map(r => `${r.success ? '✓' : '✗'} ${r.url || r.strategy?.title}`).join(' · ');
    if (d.strategy) return `Ajouté : ${d.strategy.title}`;
    return 'Terminé';
  })();
  return /*#__PURE__*/React.createElement(Reveal, null, /*#__PURE__*/React.createElement(SpotlightCard, {
    className: "panel",
    spotlightColor: "rgba(124,58,237,.2)"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '22px'
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: 18,
      fontWeight: 800,
      marginBottom: 14,
      display: 'flex',
      alignItems: 'center',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-brain",
    style: {
      color: 'var(--accent2)'
    }
  }), "Ajouter \xE0 la base de connaissance"), /*#__PURE__*/React.createElement("div", {
    className: "nav",
    style: {
      marginBottom: 20
    }
  }, METHODS.map(m => /*#__PURE__*/React.createElement("button", {
    key: m.id,
    type: "button",
    className: `nav-item ${tab === m.id ? 'on' : ''}`,
    onClick: () => {
      setTab(m.id);
      setRes(null);
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: `fas ${m.icon}`
  }), m.label))), tab === 'decrire' && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 13,
      color: 'var(--muted)',
      marginBottom: 12
    }
  }, "Explique ta strat\xE9gie avec tes mots. L'application l'analyse, en tire une fiche structur\xE9e \u2014 r\xE8gles, style, unit\xE9s de temps, entr\xE9e, invalidation \u2014 et l'enregistre. Elle est ensuite utilisable dans \xAB Ma strat\xE9gie \xBB."), /*#__PURE__*/React.createElement("textarea", {
    className: "fld",
    rows: "8",
    value: decrire,
    onChange: e => setDecrire(e.target.value),
    placeholder: "Ex. Je scalpe les indices synth\xE9tiques en 1 minute. J'attends que le prix balaie un plus bas \xE9vident puis revienne vite au-dessus. L\xE0 je regarde si la bougie de retour laisse un FVG ou un order block : quand le prix revient tester cette zone et rejette, j'ach\xE8te. Stop sous le plus bas du balayage, objectif sur l'\xE9quilibre du range. Je ne trade pas la session asiatique."
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 12,
      alignItems: 'center',
      marginTop: 10,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn",
    disabled: decrireBusy || decrire.trim().length < 30,
    onClick: analyserDescription
  }, decrireBusy ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-spinner fa-spin"
  }), " Analyse\u2026") : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-wand-magic-sparkles"
  }), " Analyser et enregistrer")), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: 'var(--dim)'
    }
  }, decrire.trim().length, " caract\xE8re(s)", decrire.trim().length < 30 ? ' — 30 minimum' : '')), decrireErr && /*#__PURE__*/React.createElement("p", {
    style: {
      color: '#f87171',
      fontSize: 12.5,
      marginTop: 10
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-circle-exclamation",
    style: {
      marginRight: 6
    }
  }), decrireErr), fiche && /*#__PURE__*/React.createElement("div", {
    className: "panel",
    style: {
      marginTop: 14,
      padding: '14px 16px',
      borderColor: 'rgba(16,185,129,.35)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      flexWrap: 'wrap',
      marginBottom: 9
    }
  }, /*#__PURE__*/React.createElement("b", {
    style: {
      fontSize: 14
    }
  }, fiche.strategy.title), /*#__PURE__*/React.createElement("span", {
    className: "badge",
    style: {
      background: 'rgba(16,185,129,.14)',
      color: '#34d399'
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-check",
    style: {
      marginRight: 5
    }
  }), "enregistr\xE9e"), fiche.moteur.style && /*#__PURE__*/React.createElement("span", {
    className: "tag"
  }, fiche.moteur.style), (fiche.moteur.timeframes || []).map(t => /*#__PURE__*/React.createElement("span", {
    key: t,
    className: "tag"
  }, t))), fiche.fiche && fiche.fiche.resume && /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 13,
      color: 'var(--muted)',
      margin: '0 0 11px'
    }
  }, fiche.fiche.resume), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 7,
      fontSize: 12.5
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("b", {
    style: {
      color: '#93c5fd'
    }
  }, "R\xE8gles retenues : "), (fiche.moteur.regles || []).join(' + ') || 'toutes'), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("b", {
    style: {
      color: '#93c5fd'
    }
  }, "Alignement : "), (fiche.moteur.timeframes || []).join(' + ') || 'unités du graphique', fiche.moteur.seuilAlignes ? ` · au moins ${fiche.moteur.seuilAlignes} d'accord` : ''), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("b", {
    style: {
      color: '#93c5fd'
    }
  }, "Force minimale : "), Math.round((fiche.moteur.seuilForce || 0) * 100), " %", ' · stop ', fiche.moteur.atrStop, "\xD7 ATR"), fiche.fiche && fiche.fiche.entree && /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("b", {
    style: {
      color: '#93c5fd'
    }
  }, "Entr\xE9e : "), fiche.fiche.entree), fiche.fiche && fiche.fiche.invalidation && /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("b", {
    style: {
      color: '#93c5fd'
    }
  }, "Invalidation : "), fiche.fiche.invalidation), fiche.fiche && fiche.fiche.objectif && /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("b", {
    style: {
      color: '#93c5fd'
    }
  }, "Objectif : "), fiche.fiche.objectif), fiche.fiche && fiche.fiche.contexte && /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("b", {
    style: {
      color: '#93c5fd'
    }
  }, "\xC0 \xE9viter : "), fiche.fiche.contexte), (fiche.strategy.structured && fiche.strategy.structured.concepts || []).length > 0 && /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("b", {
    style: {
      color: '#93c5fd'
    }
  }, "Concepts : "), fiche.strategy.structured.concepts.join(', '))), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 11.5,
      color: 'var(--dim)',
      marginTop: 11
    }
  }, "Utilisable tout de suite : onglet Direct \u2192 \xAB Ma strat\xE9gie \xBB. Tu peux l'ajuster ensuite depuis l'onglet Strat\xE9gies."))), tab === 'upload' && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 13,
      color: 'var(--muted)',
      marginBottom: 12
    }
  }, "PDF, DOCX, TXT ou MD \u2014 plusieurs fichiers \xE0 la fois. Le texte est extrait puis index\xE9."), /*#__PURE__*/React.createElement("div", {
    className: "drop",
    onClick: () => document.getElementById('f-docs').click()
  }, /*#__PURE__*/React.createElement("input", {
    id: "f-docs",
    type: "file",
    multiple: true,
    accept: ".pdf,.docx,.txt,.md",
    style: {
      display: 'none'
    },
    onChange: e => {
      const fd = new FormData();
      Array.from(e.target.files).forEach(f => fd.append('documents', f));
      post('/upload-strategies', fd, true);
    }
  }), /*#__PURE__*/React.createElement("i", {
    className: "fas fa-file-arrow-up",
    style: {
      fontSize: 26,
      color: '#60a5fa'
    }
  }), /*#__PURE__*/React.createElement("p", {
    style: {
      color: 'var(--muted)',
      marginTop: 9,
      fontSize: 13.5,
      fontWeight: 600
    }
  }, "Cliquez pour choisir des fichiers"))), tab === 'manual' && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("label", {
    className: "lbl",
    style: {
      marginTop: 0
    }
  }, "Titre"), /*#__PURE__*/React.createElement("input", {
    className: "fld",
    value: manual.title,
    onChange: e => setManual({
      ...manual,
      title: e.target.value
    })
  }), /*#__PURE__*/React.createElement("label", {
    className: "lbl"
  }, "Contenu (r\xE8gles, conditions, gestion du risque)"), /*#__PURE__*/React.createElement("textarea", {
    className: "fld",
    rows: "8",
    value: manual.content,
    onChange: e => setManual({
      ...manual,
      content: e.target.value
    })
  }), /*#__PURE__*/React.createElement("label", {
    className: "lbl"
  }, "Type"), /*#__PURE__*/React.createElement("select", {
    className: "fld",
    "aria-label": "Type de plan manuel",
    value: manual.type,
    onChange: e => setManual({
      ...manual,
      type: e.target.value
    })
  }, /*#__PURE__*/React.createElement("option", {
    value: "strategy"
  }, "Strat\xE9gie"), /*#__PURE__*/React.createElement("option", {
    value: "concept"
  }, "Concept"), /*#__PURE__*/React.createElement("option", {
    value: "pattern"
  }, "Pattern"), /*#__PURE__*/React.createElement("option", {
    value: "money-management"
  }, "Gestion du risque")), /*#__PURE__*/React.createElement("button", {
    className: "btn",
    style: {
      marginTop: 14
    },
    disabled: busy,
    onClick: () => post('/knowledge', manual)
  }, busy ? /*#__PURE__*/React.createElement(Spinner, null) : /*#__PURE__*/React.createElement("i", {
    className: "fas fa-plus"
  }), "Ajouter")), tab === 'url' && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 13,
      color: 'var(--muted)',
      marginBottom: 12
    }
  }, "L'IA lit la page, en extrait les strat\xE9gies et les structure (entr\xE9e, SL, TP, timeframes, conditions)."), /*#__PURE__*/React.createElement("label", {
    className: "lbl",
    style: {
      marginTop: 0
    }
  }, "URLs (une par ligne)"), /*#__PURE__*/React.createElement("textarea", {
    className: "fld",
    rows: "5",
    value: urls,
    onChange: e => setUrls(e.target.value),
    placeholder: "https://www.babypips.com/learn/forex/\u2026"
  }), /*#__PURE__*/React.createElement("button", {
    className: "btn",
    style: {
      marginTop: 14
    },
    disabled: busy,
    onClick: () => post('/scrape-strategies', {
      urls: urls.split('\n').map(u => u.trim()).filter(Boolean)
    })
  }, busy ? /*#__PURE__*/React.createElement(Spinner, null) : /*#__PURE__*/React.createElement("i", {
    className: "fas fa-download"
  }), "Importer & structurer")), tab === 'search' && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 13,
      color: 'var(--muted)',
      marginBottom: 12
    }
  }, "Recherche web autonome, scraping des meilleurs r\xE9sultats et sauvegarde automatique."), /*#__PURE__*/React.createElement("label", {
    className: "lbl",
    style: {
      marginTop: 0
    }
  }, "Requ\xEAte"), /*#__PURE__*/React.createElement("input", {
    className: "fld",
    value: sq,
    onChange: e => setSq(e.target.value),
    placeholder: "ex : order block strategy XAUUSD scalping"
  }), /*#__PURE__*/React.createElement("label", {
    className: "lbl"
  }, "Pages \xE0 sauvegarder"), /*#__PURE__*/React.createElement("select", {
    className: "fld",
    "aria-label": "Niveau de d\xE9tail de la r\xE9ponse",
    value: slim,
    onChange: e => setSlim(e.target.value)
  }, [3, 5, 8, 10].map(n => /*#__PURE__*/React.createElement("option", {
    key: n,
    value: n
  }, n))), /*#__PURE__*/React.createElement("button", {
    className: "btn ok",
    style: {
      marginTop: 14,
      width: '100%'
    },
    disabled: busy || !sq,
    onClick: () => post('/search-and-save', {
      query: sq,
      limit: Number(slim),
      autoSave: true
    })
  }, busy ? /*#__PURE__*/React.createElement(Spinner, null) : /*#__PURE__*/React.createElement("i", {
    className: "fas fa-magnifying-glass"
  }), "Chercher & sauvegarder")), tab === 'forum' && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("label", {
    className: "lbl",
    style: {
      marginTop: 0
    }
  }, "Source"), /*#__PURE__*/React.createElement("select", {
    className: "fld",
    "aria-label": "Forum de la source",
    value: forum,
    onChange: e => setForum(e.target.value)
  }, /*#__PURE__*/React.createElement("option", {
    value: "babypips"
  }, "BabyPips"), /*#__PURE__*/React.createElement("option", {
    value: "forexfactory"
  }, "ForexFactory"), /*#__PURE__*/React.createElement("option", {
    value: "tradingview"
  }, "TradingView"), /*#__PURE__*/React.createElement("option", {
    value: "reddit"
  }, "Reddit r/Forex"), /*#__PURE__*/React.createElement("option", {
    value: "investopedia"
  }, "Investopedia")), /*#__PURE__*/React.createElement("label", {
    className: "lbl"
  }, "Mots-cl\xE9s (optionnel)"), /*#__PURE__*/React.createElement("input", {
    className: "fld",
    value: fkw,
    onChange: e => setFkw(e.target.value),
    placeholder: "ex : liquidity sweep"
  }), /*#__PURE__*/React.createElement("button", {
    className: "btn",
    style: {
      marginTop: 14
    },
    disabled: busy,
    onClick: () => post('/scrape-forums', {
      forum,
      keywords: fkw,
      limit: 5
    })
  }, busy ? /*#__PURE__*/React.createElement(Spinner, null) : /*#__PURE__*/React.createElement("i", {
    className: "fas fa-comments"
  }), "Miner depuis ", forum)), busy && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 18,
      display: 'flex',
      alignItems: 'center',
      gap: 12
    }
  }, LatticeLoader ? /*#__PURE__*/React.createElement(LatticeLoader, {
    label: "Traitement",
    status: "working",
    color: "var(--accent2)",
    fontSize: 12
  }) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Spinner, {
    size: 18,
    color: "var(--accent2)"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--muted)',
      fontSize: 13
    }
  }, "Traitement\u2026"))), res && !busy && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 16,
      padding: 13,
      borderRadius: 11,
      fontSize: 12.5,
      lineHeight: 1.6,
      background: res.ok ? 'rgba(16,185,129,.1)' : 'rgba(239,68,68,.1)',
      border: `1px solid ${res.ok ? 'rgba(16,185,129,.3)' : 'rgba(239,68,68,.3)'}`,
      color: res.ok ? '#6ee7b7' : '#fca5a5'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 700,
      marginBottom: 4
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: `fas ${res.ok ? 'fa-circle-check' : 'fa-circle-exclamation'}`,
    style: {
      marginRight: 7
    }
  }), res.ok ? 'Succès' : 'Échec'), /*#__PURE__*/React.createElement("div", null, res.data.error || summary)))));
}

/* ══════════════ STRATÉGIES ══════════════ */

function Strategies({
  strategies,
  onDelete,
  onSaved
}) {
  const [q, setQ] = useState('');
  const [remote, setRemote] = useState(null); // résultats du moteur plein-texte
  const [searching, setSearching] = useState(false);
  // Édition en place : on modifie une stratégie sans quitter la liste.
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({
    title: '',
    content: '',
    type: 'strategy'
  });
  // Fonctionnement de la stratégie : règles, style, unités de temps, seuils et
  // réglages de calcul. C'est ce qui décide COMMENT elle analyse le marché.
  const [moteur, setMoteur] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const MOTEUR_VIDE = {
    style: '',
    regles: ['R1', 'R2', 'R3', 'R4'],
    seuilForce: 0.35,
    seuilRegles: 2,
    timeframes: [],
    seuilAlignes: 2,
    swingsWindow: 2,
    toleranceLiquidite: 0.0008,
    impulsion: 3,
    atrStop: 1.5
  };
  const REGLES_INFO = [{
    id: 'R1',
    label: 'Balayage de liquidité'
  }, {
    id: 'R2',
    label: 'Rupture de structure'
  }, {
    id: 'R3',
    label: 'Zone réactive (OB / FVG)'
  }, {
    id: 'R4',
    label: 'Position premium / discount'
  }];
  const TF_INFO = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];
  const STYLES_INFO = [{
    id: '',
    label: '— aucun (déduit du texte) —'
  }, {
    id: 'scalping',
    label: 'Scalping (1m / 5m / 15m, stop serré)'
  }, {
    id: 'intraday',
    label: 'Intraday (5m / 15m / 1h)'
  }, {
    id: 'swing',
    label: 'Swing (1h / 4h / 1d, stop large)'
  }];
  const ouvrirEdition = s => {
    setEditing(s.id);
    setForm({
      title: s.title || '',
      content: s.content || s.structured?.summary || '',
      type: s.type || 'strategy'
    });
    setMoteur(s.moteur ? {
      ...MOTEUR_VIDE,
      ...s.moteur
    } : null);
    setErr('');
  };
  const enregistrer = async () => {
    setBusy(true);
    setErr('');
    try {
      const r = await api('/knowledge/' + encodeURIComponent(editing), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ...form,
          moteur
        })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Modification refusée');
      setEditing(null);
      if (onSaved) await onSaved(); // recharge la liste ET les profils
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  // Recherche serveur (accents, pondération titre/tags/contenu, extrait).
  // En dessous de 2 caractères on affiche la liste complète.
  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setRemote(null);
      setSearching(false);
      return;
    }
    let alive = true;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const r = await api('/search?q=' + encodeURIComponent(query));
        const d = await r.json();
        if (alive) setRemote(r.ok ? d.results : []);
      } catch {
        if (alive) setRemote([]);
      } finally {
        if (alive) setSearching(false);
      }
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [q]);
  const list = useMemo(() => {
    if (!remote) return strategies;
    const byId = new Map(strategies.map(s => [s.id, s]));
    return remote.map(r => {
      const s = byId.get(r.id);
      return s ? {
        ...s,
        _excerpt: r.excerpt,
        _score: r.score
      } : null;
    }).filter(Boolean);
  }, [strategies, remote]);
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Reveal, null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 14,
      flexWrap: 'wrap',
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: 18,
      fontWeight: 800,
      display: 'flex',
      alignItems: 'center',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-book",
    style: {
      color: '#60a5fa'
    }
  }), "Base de connaissance", /*#__PURE__*/React.createElement("span", {
    className: "badge",
    style: {
      background: 'rgba(37,99,235,.14)',
      color: '#8fb4ff'
    }
  }, remote ? `${list.length} / ${strategies.length}` : strategies.length)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10
    }
  }, searching && /*#__PURE__*/React.createElement(Spinner, {
    size: 14
  }), remote && !searching && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11.5,
      color: 'var(--muted)'
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-magnifying-glass",
    style: {
      marginRight: 5
    }
  }), "plein-texte"), /*#__PURE__*/React.createElement("input", {
    className: "fld",
    style: {
      maxWidth: 280,
      margin: 0
    },
    placeholder: "Rechercher (accents ignor\xE9s)\u2026",
    value: q,
    onChange: e => setQ(e.target.value)
  })))), list.length === 0 && /*#__PURE__*/React.createElement("div", {
    className: "panel",
    style: {
      padding: 34,
      textAlign: 'center',
      color: 'var(--muted)',
      fontSize: 13.5
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-inbox",
    style: {
      fontSize: 26,
      color: 'var(--dim)',
      display: 'block',
      marginBottom: 10
    }
  }), remote ? /*#__PURE__*/React.createElement(React.Fragment, null, "Aucune strat\xE9gie ne correspond \xE0 \xAB ", q.trim(), " \xBB \u2014 tous les termes doivent \xEAtre pr\xE9sents.") : /*#__PURE__*/React.createElement(React.Fragment, null, "Aucune strat\xE9gie pour l'instant \u2014 utilisez l'onglet \xAB Ajouter \xBB.")), /*#__PURE__*/React.createElement("div", {
    className: "grid-auto"
  }, list.map((s, i) => /*#__PURE__*/React.createElement(Reveal, {
    key: s.id,
    delay: Math.min(i * 45, 360)
  }, /*#__PURE__*/React.createElement(SpotlightCard, {
    className: "panel",
    spotlightColor: "rgba(37,99,235,.2)"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 17,
      height: '100%',
      display: 'flex',
      flexDirection: 'column'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      gap: 9,
      alignItems: 'flex-start'
    }
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      fontSize: 14.5,
      fontWeight: 700,
      lineHeight: 1.35
    }
  }, s.title), /*#__PURE__*/React.createElement("span", {
    className: "badge",
    style: {
      flexShrink: 0,
      background: 'rgba(148,163,184,.12)',
      color: 'var(--muted)'
    }
  }, s.source || s.type)), editing === s.id ? /*#__PURE__*/React.createElement("div", {
    style: {
      margin: '9px 0 11px',
      display: 'grid',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("input", {
    className: "fld",
    style: {
      margin: 0
    },
    value: form.title,
    onChange: e => setForm(f => ({
      ...f,
      title: e.target.value
    })),
    placeholder: "Titre"
  }), /*#__PURE__*/React.createElement("select", {
    className: "fld",
    "aria-label": "Type d'entr\xE9e",
    style: {
      margin: 0
    },
    value: form.type,
    onChange: e => setForm(f => ({
      ...f,
      type: e.target.value
    }))
  }, /*#__PURE__*/React.createElement("option", {
    value: "strategy"
  }, "strat\xE9gie"), /*#__PURE__*/React.createElement("option", {
    value: "concept"
  }, "concept"), /*#__PURE__*/React.createElement("option", {
    value: "guide"
  }, "guide")), /*#__PURE__*/React.createElement("textarea", {
    className: "fld",
    rows: 7,
    style: {
      margin: 0,
      fontFamily: 'ui-monospace,monospace',
      fontSize: 12
    },
    value: form.content,
    onChange: e => setForm(f => ({
      ...f,
      content: e.target.value
    })),
    placeholder: "Contenu \u2014 ce texte conditionne les r\xE8gles qui seront appliqu\xE9es en mode \xAB Ma strat\xE9gie \xBB."
  }), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: 11.5,
      color: 'var(--dim)'
    }
  }, "Les \xE9tiquettes et les r\xE8gles d'analyse sont recalcul\xE9es depuis ce texte."), /*#__PURE__*/React.createElement("div", {
    style: {
      border: '1px solid rgba(27,36,51,.7)',
      borderRadius: 8,
      padding: '10px 12px',
      display: 'grid',
      gap: 9
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("b", {
    style: {
      fontSize: 12.5
    }
  }, "Fonctionnement"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: moteur ? '#34d399' : 'var(--dim)'
    }
  }, moteur ? 'défini explicitement' : 'déduit du texte'), /*#__PURE__*/React.createElement("button", {
    onClick: () => setMoteur(m => m ? null : {
      ...MOTEUR_VIDE
    }),
    style: {
      marginLeft: 'auto',
      background: 'none',
      border: 'none',
      color: '#60a5fa',
      cursor: 'pointer',
      fontSize: 12
    }
  }, moteur ? 'Revenir à la déduction' : 'Définir le fonctionnement')), moteur && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11.5,
      color: 'var(--muted)',
      marginBottom: 4
    }
  }, "Style de trading (fixe les unit\xE9s de temps)"), /*#__PURE__*/React.createElement("select", {
    className: "fld",
    "aria-label": "Style du moteur",
    style: {
      margin: 0,
      width: '100%'
    },
    value: moteur.style || '',
    onChange: e => setMoteur(m => ({
      ...m,
      style: e.target.value,
      timeframes: []
    }))
  }, STYLES_INFO.map(x => /*#__PURE__*/React.createElement("option", {
    key: x.id,
    value: x.id
  }, x.label)))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11.5,
      color: 'var(--muted)',
      marginBottom: 4
    }
  }, "R\xE8gles appliqu\xE9es"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 10,
      flexWrap: 'wrap'
    }
  }, REGLES_INFO.map(r => /*#__PURE__*/React.createElement("label", {
    key: r.id,
    style: {
      display: 'flex',
      gap: 5,
      alignItems: 'center',
      fontSize: 12,
      cursor: 'pointer'
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    checked: (moteur.regles || []).includes(r.id),
    onChange: () => setMoteur(m => ({
      ...m,
      regles: (m.regles || []).includes(r.id) ? (m.regles || []).filter(x => x !== r.id) : [...(m.regles || []), r.id]
    }))
  }), r.id, " \xB7 ", r.label)))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11.5,
      color: 'var(--muted)',
      marginBottom: 4
    }
  }, "Unit\xE9s de temps examin\xE9es ensemble (alignement)"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      flexWrap: 'wrap'
    }
  }, TF_INFO.map(t => /*#__PURE__*/React.createElement("label", {
    key: t,
    style: {
      display: 'flex',
      gap: 4,
      alignItems: 'center',
      fontSize: 12,
      cursor: 'pointer'
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    checked: (moteur.timeframes || []).includes(t),
    onChange: () => setMoteur(m => {
      // Le seuil suit le nombre d'unités cochées : 2 unités → 2
      // alignements exigés, 3 → 3, 4 → 4. C'est la règle de la
      // stratégie, pas un plafond de la plateforme.
      const liste = (m.timeframes || []).includes(t) ? (m.timeframes || []).filter(x => x !== t) : [...(m.timeframes || []), t];
      return {
        ...m,
        timeframes: liste,
        seuilAlignes: liste.length || 1
      };
    })
  }), t))), /*#__PURE__*/React.createElement("div", {
    style: {
      color: 'var(--muted)',
      fontSize: 11.5,
      marginTop: 6
    }
  }, "Toutes les unit\xE9s coch\xE9es doivent s'aligner : ", (moteur.timeframes || []).length || 0, " coch\xE9e(s) \u2192 seuil ", moteur.seuilAlignes || 1, ". Une strat\xE9gie en 2 unit\xE9s n'exige pas de 3e.")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("label", {
    style: {
      fontSize: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      color: 'var(--muted)',
      marginBottom: 3
    }
  }, "Force mini ", ((moteur.seuilForce || 0) * 100).toFixed(0), " %"), /*#__PURE__*/React.createElement("input", {
    type: "range",
    min: "0",
    max: "1",
    step: "0.05",
    value: moteur.seuilForce || 0,
    onChange: e => setMoteur(m => ({
      ...m,
      seuilForce: Number(e.target.value)
    })),
    style: {
      width: '100%'
    }
  })), /*#__PURE__*/React.createElement("label", {
    style: {
      fontSize: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      color: 'var(--muted)',
      marginBottom: 3
    }
  }, "Unit\xE9s \xE0 aligner"), /*#__PURE__*/React.createElement("input", {
    className: "fld",
    type: "number",
    min: "1",
    max: "5",
    value: moteur.seuilAlignes || 2,
    onChange: e => setMoteur(m => ({
      ...m,
      seuilAlignes: Number(e.target.value)
    }))
  })), /*#__PURE__*/React.createElement("label", {
    style: {
      fontSize: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      color: 'var(--muted)',
      marginBottom: 3
    }
  }, "Stop (\xD7 ATR)"), /*#__PURE__*/React.createElement("input", {
    className: "fld",
    type: "number",
    min: "0.5",
    max: "5",
    step: "0.5",
    value: moteur.atrStop || 1.5,
    onChange: e => setMoteur(m => ({
      ...m,
      atrStop: Number(e.target.value)
    }))
  })), /*#__PURE__*/React.createElement("label", {
    style: {
      fontSize: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      color: 'var(--muted)',
      marginBottom: 3
    }
  }, "Fen\xEAtre des swings"), /*#__PURE__*/React.createElement("input", {
    className: "fld",
    type: "number",
    min: "1",
    max: "5",
    value: moteur.swingsWindow || 2,
    onChange: e => setMoteur(m => ({
      ...m,
      swingsWindow: Number(e.target.value)
    }))
  })))))) : /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 12.5,
      color: 'var(--muted)',
      lineHeight: 1.6,
      margin: '9px 0 11px',
      flex: 1
    }
  }, s._excerpt ? s._excerpt : `${(s.structured?.summary || s.content || '').slice(0, 190)}…`), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 11
    }
  }, (s.tags || []).slice(0, 6).map((t, k) => /*#__PURE__*/React.createElement("span", {
    key: k,
    className: "tag"
  }, t))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingTop: 10,
      borderTop: '1px solid rgba(27,36,51,.6)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: 'var(--dim)'
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-clock",
    style: {
      marginRight: 5
    }
  }), new Date(s.createdAt).toLocaleDateString('fr-FR')), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8
    }
  }, s.sourceUrl && /*#__PURE__*/React.createElement("a", {
    href: s.sourceUrl,
    target: "_blank",
    rel: "noreferrer",
    style: {
      color: '#60a5fa',
      fontSize: 12.5
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-external-link-alt"
  })), editing === s.id ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("button", {
    onClick: enregistrer,
    disabled: busy,
    style: {
      background: 'none',
      border: 'none',
      color: '#34d399',
      cursor: 'pointer',
      fontSize: 12.5
    }
  }, busy ? '…' : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-check"
  }), " Enregistrer")), /*#__PURE__*/React.createElement("button", {
    onClick: () => setEditing(null),
    style: {
      background: 'none',
      border: 'none',
      color: 'var(--muted)',
      cursor: 'pointer',
      fontSize: 12.5
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-xmark"
  }))) : /*#__PURE__*/React.createElement("button", {
    onClick: () => ouvrirEdition(s),
    title: "Modifier le titre, le type et le contenu",
    style: {
      background: 'none',
      border: 'none',
      color: '#60a5fa',
      cursor: 'pointer',
      fontSize: 12.5
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-pen"
  })), /*#__PURE__*/React.createElement("button", {
    onClick: () => onDelete(s.id),
    style: {
      background: 'none',
      border: 'none',
      color: '#f87171',
      cursor: 'pointer',
      fontSize: 12.5
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-trash"
  }))))))))));
}

/* ══════════════ HISTORIQUE ══════════════ */

function History({
  history
}) {
  if (!history.length) {
    return /*#__PURE__*/React.createElement("div", {
      className: "panel",
      style: {
        padding: 34,
        textAlign: 'center',
        color: 'var(--muted)',
        fontSize: 13.5
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: "fas fa-clock-rotate-left",
      style: {
        fontSize: 26,
        color: 'var(--dim)',
        display: 'block',
        marginBottom: 10
      }
    }), "Aucune analyse pour l'instant.");
  }
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Reveal, null, /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: 18,
      fontWeight: 800,
      marginBottom: 16,
      display: 'flex',
      alignItems: 'center',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-clock-rotate-left",
    style: {
      color: '#60a5fa'
    }
  }), "Historique des analyses")), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      paddingLeft: 22
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      left: 7,
      top: 6,
      bottom: 6,
      width: 2,
      background: 'linear-gradient(180deg,rgba(37,99,235,.6),rgba(124,58,237,.15))'
    }
  }), history.map((h, i) => /*#__PURE__*/React.createElement(Reveal, {
    key: h.id,
    delay: Math.min(i * 50, 300)
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      marginBottom: 13
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      left: -21,
      top: 16,
      width: 12,
      height: 12,
      borderRadius: '50%',
      background: h.action === 'BUY' ? '#10b981' : h.action === 'SELL' ? '#ef4444' : '#f59e0b',
      border: '2px solid #070a11',
      boxShadow: '0 0 10px rgba(37,99,235,.5)'
    }
  }), /*#__PURE__*/React.createElement("div", {
    className: "panel",
    style: {
      padding: 15
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 10,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 700,
      fontSize: 14,
      display: 'flex',
      alignItems: 'center',
      gap: 9
    }
  }, h.pair, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--muted)',
      fontWeight: 500,
      fontSize: 12.5
    }
  }, h.timeframes), /*#__PURE__*/React.createElement(ActionBadge, {
    action: h.action
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: 'var(--dim)'
    }
  }, new Date(h.timestamp).toLocaleString('fr-FR'))), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      color: 'var(--muted)',
      marginTop: 6,
      lineHeight: 1.6
    }
  }, h.reason)))))));
}

/* ══════════════ MARCHÉ EN DIRECT ══════════════ */

/* Graphique TradingView Lightweight Charts : chandeliers + volume + niveaux.
   Zoom, déplacement et échelle de prix sont natifs (molette, glisser-déposer). */
function PriceChart({
  candles,
  levels,
  signal,
  height,
  symbol,
  tf,
  report
}) {
  const boxRef = useRef(null);
  const overlayRef = useRef(null);
  const api = useRef({
    chart: null,
    series: null,
    vol: null,
    lines: [],
    full: true
  });
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
    if (window.LightweightCharts) {
      setLibPrete(true);
      setLibMissing(false);
      return;
    }
    const reveil = () => {
      if (window.LightweightCharts) {
        setLibPrete(true);
        setLibMissing(false);
      }
    };
    window.addEventListener('lwc-pret', reveil);
    const veille = setInterval(() => {
      if (window.LightweightCharts) {
        setLibPrete(true);
        setLibMissing(false);
        clearInterval(veille);
      }
    }, 500);
    return () => {
      window.removeEventListener('lwc-pret', reveil);
      clearInterval(veille);
    };
  }, []);
  useEffect(() => {
    const box = boxRef.current;
    const LC = window.LightweightCharts;
    if (!box || !LC) {
      setLibMissing(true);
      return;
    }
    setLibMissing(false);
    const chart = LC.createChart(box, {
      layout: {
        background: {
          type: 'solid',
          color: '#080c14'
        },
        textColor: '#cbd5e1',
        fontSize: 11,
        fontFamily: 'ui-sans-serif, system-ui, sans-serif'
      },
      grid: {
        vertLines: {
          color: 'rgba(148,163,184,.07)'
        },
        horzLines: {
          color: 'rgba(148,163,184,.07)'
        }
      },
      crosshair: {
        mode: LC.CrosshairMode.Normal,
        vertLine: {
          color: 'rgba(148,163,184,.55)',
          width: 1,
          style: LC.LineStyle.Dashed,
          labelBackgroundColor: '#1e293b'
        },
        horzLine: {
          color: 'rgba(148,163,184,.55)',
          width: 1,
          style: LC.LineStyle.Dashed,
          labelBackgroundColor: '#1e293b'
        }
      },
      rightPriceScale: {
        borderColor: 'rgba(148,163,184,.18)',
        scaleMargins: {
          top: 0.08,
          bottom: 0.24
        }
      },
      timeScale: {
        borderColor: 'rgba(148,163,184,.18)',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 4
      },
      localization: {
        locale: 'fr-FR'
      },
      handleScroll: true,
      handleScale: true
    });
    const series = chart.addCandlestickSeries({
      upColor: '#22d38a',
      downColor: '#f2545b',
      borderUpColor: '#22d38a',
      borderDownColor: '#f2545b',
      wickUpColor: '#22d38a',
      wickDownColor: '#f2545b',
      priceLineVisible: true,
      priceLineColor: 'rgba(255,255,255,.4)',
      priceLineStyle: LC.LineStyle.Dashed
    });
    const vol = chart.addHistogramSeries({
      priceFormat: {
        type: 'volume'
      },
      priceScaleId: 'vol',
      lastValueVisible: false,
      priceLineVisible: false
    });
    chart.priceScale('vol').applyOptions({
      scaleMargins: {
        top: 0.82,
        bottom: 0
      }
    });
    api.current = {
      chart,
      series,
      vol,
      lines: [],
      full: true
    };

    // La taille ne doit jamais rester à zéro : dans un onglet en arrière-plan
    // ou un panneau pas encore disposé, clientWidth vaut 0 et le graphique
    // resterait invisible. On remesure à plusieurs moments.
    const fit = () => {
      const w = box.clientWidth,
        h = box.clientHeight;
      if (w > 0 && h > 0) chart.applyOptions({
        width: w,
        height: h
      });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    const t1 = setTimeout(fit, 250);
    const t2 = setTimeout(fit, 1200);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      ro.disconnect();
      chart.remove();
      api.current = {
        chart: null,
        series: null,
        vol: null,
        lines: [],
        full: true
      };
    };
  }, [libPrete]);

  // setData au premier chargement (ou après changement de symbole/timeframe),
  // puis update du seul dernier point : c'est ce qui rend le direct fluide.
  useEffect(() => {
    // Toute erreur de dessin est rattrapée ici : elle ne doit jamais remonter à
    // React et faire disparaître toute l'interface (erreur vécue).
    try {
      const {
        chart,
        series,
        vol
      } = api.current;
      if (!series || !candles || !candles.length) return;
      const sigKey = `${symbol}|${tf}`;
      if (keyRef.current !== sigKey) {
        api.current.full = true;
        keyRef.current = sigKey;
      }
      const toTime = c => Math.floor(c.t / 1000);
      const point = c => ({
        time: toTime(c),
        open: c.o,
        high: c.h,
        low: c.l,
        close: c.c
      });
      const bar = c => ({
        time: toTime(c),
        value: c.v || 0,
        color: c.c >= c.o ? 'rgba(34,211,138,.32)' : 'rgba(242,84,91,.32)'
      });
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
    const {
      series
    } = api.current;
    if (!series) return;
    api.current.lines.forEach(l => {
      try {
        series.removePriceLine(l);
      } catch (e) {}
    });
    // L'axe ne supporte pas vingt-cinq étiquettes : elles se chevauchaient, se
    // superposaient au prix et rendaient le graphique illisible. On garde les
    // niveaux qui décident — les plus proches du prix — plus le support et la
    // résistance les plus proches, et on ANNONCE les autres au lieu de les
    // faire disparaître en silence.
    const tous = (levels || []).filter(l => Number.isFinite(l.price));
    const MAX_NIVEAUX = 6;
    const ref = Number.isFinite(api.current.lastClose) ? api.current.lastClose : tous.length ? tous.map(l => l.price).sort((a, b) => a - b)[Math.floor(tous.length / 2)] : null;
    let gardes = tous;
    if (ref !== null && tous.length > MAX_NIVEAUX) {
      const choisis = [...tous].sort((a, b) => Math.abs(a.price - ref) - Math.abs(b.price - ref)).slice(0, MAX_NIVEAUX);
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
      const color = l.side === 'support' ? 'rgba(34,211,138,.8)' : l.side === 'resistance' ? 'rgba(242,84,91,.8)' : l.side === 'liquidité' ? 'rgba(245,158,11,.75)' : 'rgba(96,165,250,.75)';
      return series.createPriceLine({
        price: l.price,
        color,
        lineWidth: 1,
        lineStyle: window.LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true,
        title: l.kind
      });
    });
  }, [levels]);

  // Repère du signal sur la bougie concernée
  useEffect(() => {
    const {
      series
    } = api.current;
    if (!series || !signal || !signal.at) return;
    const buy = signal.direction === 'BUY';
    try {
      series.setMarkers([{
        time: Math.floor(signal.at / 1000),
        position: buy ? 'belowBar' : 'aboveBar',
        color: signal.status === 'confirme' && signal.levels ? buy ? '#22d38a' : '#f2545b' : '#64748b',
        shape: buy ? 'arrowUp' : 'arrowDown',
        // Gris = règles d'accord SANS niveaux publiés, donc rien à exécuter.
        text: (signal.status === 'confirme' && signal.levels ? '' : 'règles ') + (buy ? 'ACHAT' : 'VENTE')
      }]);
    } catch (e) {}
  }, [signal]);

  // ── Calque de zones : OB, FVG, liquidité, premium/discount, OTE ──
  // Tout est redessiné quand les données changent, quand on zoome ou qu'on
  // déplace le graphique, et quand la taille change. C'est ce qui fait bouger
  // les zones AVEC le prix au lieu d'afficher un dessin figé.
  useEffect(() => {
    const {
      chart,
      series
    } = api.current;
    const cvs = overlayRef.current;
    if (!chart || !series || !cvs) return;
    // Le rapport courant est stocké ici : dessiner() le relit à chaque redessin.
    api.current.report = report;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const dessiner = () => {
      const w = cvs.clientWidth,
        h = cvs.clientHeight;
      if (!w || !h) return;
      const cw = Math.round(w * dpr),
        chh = Math.round(h * dpr);
      if (cvs.width !== cw || cvs.height !== chh) {
        cvs.width = cw;
        cvs.height = chh;
      }
      const ctx = cvs.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const rep = api.current.report;
      if (!rep) return;
      const compte = {
        ob: 0,
        fvg: 0,
        liq: 0,
        sweep: 0,
        labels: 0
      };
      // Budget de TEXTE : toutes les zones restent tracées, mais seules quelques
      // unes portent un libellé. Vingt-cinq étiquettes au même x se
      // chevauchaient et rendaient le graphique illisible ; les tracés, eux,
      // restent lisibles.
      const BUDGET_LABELS = 6;
      const peutEtiqueter = () => compte.labels < BUDGET_LABELS;

      // Conversion temps → pixel, prix → pixel. null si hors de la vue.
      const X = t => {
        try {
          const v = chart.timeScale().timeToCoordinate(t);
          return Number.isFinite(v) ? v : null;
        } catch (e) {
          return null;
        }
      };
      const Y = p => {
        try {
          const v = series.priceToCoordinate(p);
          return Number.isFinite(v) ? v : null;
        } catch (e) {
          return null;
        }
      };
      const tFin = api.current.lastTime;
      if (!Number.isFinite(tFin)) return;
      const zone = (t0, t1, p1, p2, fond, bord, etiquette) => {
        const x0 = X(t0),
          x1 = X(t1),
          y0 = Y(p1),
          y1 = Y(p2);
        if (x0 === null || x1 === null || y0 === null || y1 === null) return;
        const g = Math.min(x0, x1),
          d = Math.max(x0, x1);
        const ht = Math.min(y0, y1),
          bs = Math.max(y0, y1);
        if (d < 0 || g > w || bs < 0 || ht > h) return;
        const lg = Math.max(2, d - g),
          hh = Math.max(1.5, bs - ht);
        ctx.fillStyle = fond;
        ctx.fillRect(g, ht, lg, hh);
        if (bord) {
          ctx.strokeStyle = bord;
          ctx.lineWidth = 1;
          ctx.strokeRect(g + .5, ht + .5, lg - 1, hh - 1);
        }
        if (etiquette && hh > 11 && peutEtiqueter()) {
          ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
          ctx.fillStyle = bord || 'rgba(226,232,240,.75)';
          ctx.fillText(etiquette, g + 4, ht + 10);
          compte.labels++;
        }
      };
      const bande = (p1, p2, fond, bord, etiquette) => {
        const y0 = Y(p1),
          y1 = Y(p2);
        if (y0 === null || y1 === null) return;
        const ht = Math.min(y0, y1),
          bs = Math.max(y0, y1);
        if (bs < 0 || ht > h) return;
        ctx.fillStyle = fond;
        ctx.fillRect(0, ht, w, Math.max(1.5, bs - ht));
        if (bord) {
          ctx.strokeStyle = bord;
          ctx.setLineDash([5, 4]);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, ht + .5);
          ctx.lineTo(w, ht + .5);
          ctx.moveTo(0, bs - .5);
          ctx.lineTo(w, bs - .5);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        if (etiquette && bs - ht > 12 && peutEtiqueter()) {
          ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
          ctx.fillStyle = bord || 'rgba(226,232,240,.7)';
          ctx.fillText(etiquette, 6, ht + 11);
          compte.labels++;
        }
      };

      // Order blocks : de leur bougie d'origine jusqu'à maintenant.
      for (const ob of rep.orderBlocks || []) {
        const t0 = Math.floor((ob.t || 0) / 1000);
        if (!t0 || !Number.isFinite(ob.low) || !Number.isFinite(ob.high)) continue;
        const haussier = /bull|haus/i.test(String(ob.type || ''));
        compte.ob++;
        zone(t0, tFin, ob.low, ob.high, haussier ? 'rgba(34,211,138,.10)' : 'rgba(242,84,91,.10)', haussier ? 'rgba(34,211,138,.42)' : 'rgba(242,84,91,.42)', 'OB ' + (haussier ? 'haussier' : 'baissier'));
      }
      // Déséquilibres (FVG)
      for (const f of rep.fvgs || []) {
        const t0 = Math.floor((f.t || 0) / 1000);
        if (!t0 || !Number.isFinite(f.low) || !Number.isFinite(f.high)) continue;
        const haussier = /bull|haus/i.test(String(f.type || ''));
        compte.fvg++;
        zone(t0, tFin, f.low, f.high, haussier ? 'rgba(96,165,250,.10)' : 'rgba(251,191,36,.10)', haussier ? 'rgba(96,165,250,.40)' : 'rgba(251,191,36,.40)', 'FVG ' + (haussier ? 'haussier' : 'baissier'));
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
      for (const l of rep.liquidity || []) {
        const y = Y(l.price);
        if (y === null || y < 0 || y > h) continue;
        ctx.strokeStyle = 'rgba(245,158,11,.55)';
        ctx.setLineDash([2, 4]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, y + .5);
        ctx.lineTo(w, y + .5);
        ctx.stroke();
        ctx.setLineDash([]);
        compte.liq++;
        if (peutEtiqueter()) {
          ctx.fillStyle = 'rgba(245,158,11,.9)';
          ctx.fillText((l.type || 'liquidite') + (l.touches ? ' (' + l.touches + ')' : ''), 6, y - 3);
          compte.labels++;
        }
      }
      // Balayages : l'extrême atteint est entouré.
      for (const s of rep.sweeps || []) {
        const x = X(Math.floor((s.at || 0) / 1000));
        const y = Y(s.extreme || s.level);
        if (x === null || y === null) continue;
        compte.sweep++;
        ctx.strokeStyle = 'rgba(167,139,250,.85)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.stroke();
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
    try {
      sub = chart.timeScale().subscribeVisibleLogicalRangeChange(dessiner);
    } catch (e) {}
    const ro = new ResizeObserver(dessiner);
    ro.observe(cvs);
    const t1 = setTimeout(dessiner, 120);
    const t2 = setTimeout(dessiner, 700);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      ro.disconnect();
      try {
        if (sub) chart.timeScale().unsubscribeVisibleLogicalRangeChange(sub);
      } catch (e) {}
      api.current.dessiner = null;
    };
  }, [candles, report, levels]);
  const reset = () => {
    try {
      api.current.chart.timeScale().fitContent();
    } catch (e) {}
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "chart-mobile",
    style: {
      position: 'relative'
    }
  }, /*#__PURE__*/React.createElement("div", {
    ref: boxRef,
    className: "chart-mobile",
    style: {
      width: '100%',
      height,
      borderRadius: 10,
      overflow: 'hidden'
    }
  }), /*#__PURE__*/React.createElement("canvas", {
    ref: overlayRef,
    style: {
      position: 'absolute',
      inset: 0,
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      borderRadius: 10,
      zIndex: 3
    }
  }), zonesTracees && /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      left: 10,
      bottom: 8,
      zIndex: 4,
      pointerEvents: 'none',
      fontSize: 11,
      color: '#94a3b8',
      background: 'rgba(8,12,20,.78)',
      padding: '3px 9px',
      borderRadius: 6,
      border: '1px solid rgba(148,163,184,.2)'
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-layer-group",
    style: {
      marginRight: 6,
      color: '#60a5fa'
    }
  }), "zones trac\xE9es : ", zonesTracees.ob, " OB \xB7 ", zonesTracees.fvg, " FVG \xB7", ' ', zonesTracees.liq, " liquidit\xE9 \xB7 ", zonesTracees.sweep, " balayage(s)"), libMissing && /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      inset: 0,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      textAlign: 'center',
      background: 'rgba(8,12,20,.92)',
      borderRadius: 10,
      fontSize: 13,
      color: '#fbbf24'
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-triangle-exclamation",
    style: {
      fontSize: 20
    }
  }), /*#__PURE__*/React.createElement("b", null, "Biblioth\xE8que de graphique non charg\xE9e"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--muted)',
      maxWidth: 380
    }
  }, "La page vient d'une version en cache. Rechargez-la en for\xE7ant :", /*#__PURE__*/React.createElement("b", null, " Ctrl + Maj + R"), " (ou Ctrl + F5).")), /*#__PURE__*/React.createElement("button", {
    className: "btn ghost sm",
    onClick: reset,
    title: "Revenir au prix actuel",
    style: {
      position: 'absolute',
      top: 8,
      right: 92,
      zIndex: 5
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-crosshairs"
  })));
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
  ok: '#10b981',
  bad: '#ef4444',
  warn: '#f59e0b',
  neu: '#94a3b8',
  info: '#3b82f6',
  okBg: 'rgba(16,185,129,.12)',
  badBg: 'rgba(239,68,68,.12)',
  warnBg: 'rgba(245,158,11,.12)',
  neuBg: 'rgba(148,163,184,.10)',
  infoBg: 'rgba(59,130,246,.12)',
  line: 'rgba(27,36,51,.85)'
};
const TT_TONE = {
  ok: {
    c: TT.ok,
    bg: TT.okBg
  },
  bad: {
    c: TT.bad,
    bg: TT.badBg
  },
  warn: {
    c: TT.warn,
    bg: TT.warnBg
  },
  neu: {
    c: TT.neu,
    bg: TT.neuBg
  },
  info: {
    c: TT.info,
    bg: TT.infoBg
  }
};

/** Prix : 5 décimales sous 1000 (FX), 2 au-dessus (indices, crypto). */
const ttFmt = p => {
  const n = Number(p);
  if (p === null || p === undefined || !Number.isFinite(n)) return '—';
  return n >= 1000 ? n.toLocaleString('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }) : n.toFixed(5);
};
const ttHeure = t => {
  if (!t) return '—';
  try {
    return new Date(t).toLocaleTimeString('fr-FR');
  } catch {
    return '—';
  }
};
const ttAge = ms => {
  if (ms === null || ms === undefined) return '—';
  if (ms < 60000) return Math.round(ms / 1000) + ' s';
  if (ms < 3600000) return Math.round(ms / 60000) + ' min';
  return Math.round(ms / 3600000) + ' h';
};
function TtLabel({
  children,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10.5,
      fontWeight: 700,
      letterSpacing: '.09em',
      textTransform: 'uppercase',
      color: 'var(--dim)',
      ...style
    }
  }, children);
}
function TtPill({
  tone = 'neu',
  children,
  title,
  style
}) {
  const t = TT_TONE[tone] || TT_TONE.neu;
  return /*#__PURE__*/React.createElement("span", {
    title: title,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      fontSize: 10.5,
      fontWeight: 700,
      letterSpacing: '.04em',
      padding: '3px 9px',
      borderRadius: 6,
      background: t.bg,
      color: t.c,
      whiteSpace: 'nowrap',
      ...style
    }
  }, children);
}

// ── Indicateur de synchronisation ─────────────────────────────────────────
function LiveStatusIndicator({
  live,
  offline,
  ticks,
  lastUpdate,
  onRefresh,
  busy
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement(TtPill, {
    tone: live ? 'ok' : 'warn'
  }, /*#__PURE__*/React.createElement("span", {
    className: "dot-live",
    style: {
      width: 6,
      height: 6
    }
  }), live ? 'EN DIRECT' : 'CONNEXION…'), offline && /*#__PURE__*/React.createElement(TtPill, {
    tone: "warn",
    title: "R\xE9seau absent : bougies servies du cache local."
  }, "CACHE"), lastUpdate && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: 'var(--dim)',
      fontVariantNumeric: 'tabular-nums'
    }
  }, ticks, " maj \xB7 ", ttHeure(lastUpdate)), /*#__PURE__*/React.createElement("button", {
    className: "btn ghost sm",
    onClick: onRefresh,
    disabled: busy,
    title: "Recharger les donn\xE9es du march\xE9",
    style: {
      padding: '5px 9px'
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: `fas ${busy ? 'fa-spinner fa-spin' : 'fa-rotate'}`
  })));
}

// ── NIVEAU 03 : Live Decision Center — l'état global, en un coup d'œil ────
function LiveDecisionCenter({
  decision,
  sse,
  price,
  at,
  symbol,
  tf,
  providerLabel,
  confluence
}) {
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
  const etatBrut = vientDUneDecision && refusRisque && src.decision === 'ATTENTE' ? 'ATTENTE_RISQUE' : vientDUneDecision ? src.decision : src && src.status === 'confirme' ? src.direction === 'BUY' ? 'ACHAT_REGLES' : 'VENTE_REGLES' : null;
  const ETATS = {
    ACHAT: {
      label: 'ACHAT CONFIRMÉ',
      tone: 'ok',
      ico: 'fa-arrow-trend-up',
      sous: 'Signal d\'achat validé par toutes les règles obligatoires.'
    },
    VENTE: {
      label: 'VENTE CONFIRMÉE',
      tone: 'bad',
      ico: 'fa-arrow-trend-down',
      sous: 'Signal de vente validé par toutes les règles obligatoires.'
    },
    // Accord des règles SEUL : ce n'est pas une entrée, et le dire autrement est
    // la faute la plus coûteuse qu'un terminal puisse commettre.
    ACHAT_REGLES: {
      label: 'RÈGLES ALIGNÉES — ACHAT',
      tone: 'warn',
      ico: 'fa-circle-check',
      sous: 'Les règles d\'achat sont d\'accord. Ce n\'est pas une entrée exécutable : l\'arbitrage n\'a pas conclu.'
    },
    VENTE_REGLES: {
      label: 'RÈGLES ALIGNÉES — VENTE',
      tone: 'warn',
      ico: 'fa-circle-check',
      sous: 'Les règles de vente sont d\'accord. Ce n\'est pas une entrée exécutable : l\'arbitrage n\'a pas conclu.'
    },
    ATTENTE: {
      label: 'ATTENTE',
      tone: 'warn',
      ico: 'fa-hourglass-half',
      sous: 'Signaux contradictoires : le moteur n\'arbitre pas à ta place.'
    },
    // Le setup est bon, le COMPTE ne suit pas. Ce n'est pas la même chose qu'une
    // attente technique, et les confondre ferait chercher la cause au mauvais endroit.
    ATTENTE_RISQUE: {
      label: 'ATTENTE — RISQUE REFUSÉ',
      tone: 'bad',
      ico: 'fa-shield-halved',
      sous: 'Le setup est valide, mais les plafonds du compte interdisent cette prise.'
    },
    NO_TRADE: {
      label: 'NO TRADE',
      tone: 'neu',
      ico: 'fa-ban',
      sous: 'Aucun signal exécutable après tous les filtres.'
    }
  };
  const etat = ETATS[etatBrut] || {
    label: 'ANALYSE…',
    tone: 'info',
    ico: 'fa-satellite-dish',
    sous: 'Le moteur évalue le marché…'
  };
  const tone = TT_TONE[etat.tone];

  // Métriques — uniquement quand le moteur les fournit réellement.
  const conf = confluence && confluence.confluence ? confluence.confluence : null;
  const trace = src && src.trace ? src.trace : null;
  const nbUnites = conf && Array.isArray(conf.detail) ? conf.detail.length : null;
  const biais = src && src.biais || trace && trace.arbitrage && trace.arbitrage.biais || null;
  const validation = trace && trace.validation ? trace.validation : null;
  const detection = trace && trace.detection ? trace.detection : null;
  const execution = trace && trace.execution ? trace.execution : null;

  // Aucun « undefined » à l'écran : on lit le compteur du moteur s'il existe,
  // sinon on recompte `details`, sinon on affiche « — ».
  const nb = x => Number.isFinite(x) ? x : null;
  const compte = (niveau, champ, total) => {
    const n = nb(niveau && niveau[champ]);
    const t = nb(niveau && niveau.total) ?? nb(total);
    return n === null || t === null ? '—' : `${n} / ${t}`;
  };
  const metres = [{
    k: 'Biais directionnel',
    v: biais ? biais.toUpperCase() : '—',
    tone: biais === 'haussier' ? 'ok' : biais === 'baissier' ? 'bad' : biais === 'partagé' ? 'warn' : 'neu'
  }, {
    k: 'Confirmation MTF',
    v: conf ? `${conf.nbAlignes} / ${nbUnites || '—'} unités` : compte(trace && trace.confirmation, 'confirmes', detection ? (detection.details || []).length : null),
    tone: conf ? conf.aligne ? 'ok' : 'warn' : 'neu'
  }, {
    k: 'Conditions validées',
    v: compte(validation, 'valides', detection ? (detection.details || []).length : null),
    tone: validation && validation.bloques > 0 ? 'warn' : validation ? 'ok' : 'neu'
  }, {
    k: 'Entrée exécutable',
    v: execution ? execution.executables > 0 ? 'OUI' : 'NON' : '—',
    tone: execution ? execution.executables > 0 ? 'ok' : 'neu' : 'neu'
  }];
  return /*#__PURE__*/React.createElement("div", {
    className: "panel",
    style: {
      padding: 0,
      marginBottom: 12,
      overflow: 'hidden',
      borderColor: tone.c + '66'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '16px 18px',
      background: tone.bg,
      borderBottom: `1px solid ${tone.c}33`
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement(TtLabel, {
    style: {
      color: tone.c,
      margin: 0
    }
  }, "D\xE9cision du moteur"), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: '1 1 auto'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: 'var(--dim)'
    }
  }, providerLabel || symbol, " \xB7 ", tf)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 14,
      marginTop: 6,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: `fas ${etat.ico}`,
    style: {
      fontSize: 30,
      color: tone.c
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 26,
      fontWeight: 900,
      letterSpacing: '-.02em',
      color: tone.c,
      lineHeight: 1.1
    }
  }, etat.label), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      color: 'var(--muted)',
      marginTop: 3,
      lineHeight: 1.5
    }
  }, src && src.raison || etat.sous), src && src.risque && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11.5,
      marginTop: 5,
      lineHeight: 1.45,
      color: src.risque.ok === false ? '#fca5a5' : src.risque.consulte ? '#6ee7b7' : 'var(--dim)'
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: `fas ${src.risque.ok === false ? 'fa-shield-halved' : src.risque.consulte ? 'fa-check-double' : 'fa-circle-question'}`,
    style: {
      marginRight: 6
    }
  }), src.risque.ok === false ? /*#__PURE__*/React.createElement(React.Fragment, null, "Risque : refus\xE9 \u2014 ", (src.risque.refus || []).join(' · ')) : src.risque.consulte ? /*#__PURE__*/React.createElement(React.Fragment, null, "Risque : plafonds du compte respect\xE9s pour cette prise") : /*#__PURE__*/React.createElement(React.Fragment, null, "Risque : ", /*#__PURE__*/React.createElement("b", null, "non v\xE9rifi\xE9"), " \u2014 ", src.risque.motif || "aucun état de compte n'a été fourni à la décision"))), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: '1 1 auto'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'right'
    }
  }, /*#__PURE__*/React.createElement(TtLabel, null, "Prix actuel"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 28,
      fontWeight: 800,
      fontVariantNumeric: 'tabular-nums',
      letterSpacing: '-.02em',
      color: '#fff'
    }
  }, ttFmt(price)), at && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10.5,
      color: 'var(--dim)'
    }
  }, ttHeure(at))))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit,minmax(135px,1fr))'
    }
  }, metres.map((m, i) => {
    const t = TT_TONE[m.tone] || TT_TONE.neu;
    return /*#__PURE__*/React.createElement("div", {
      key: m.k,
      style: {
        padding: '11px 14px',
        borderTop: '1px solid ' + TT.line,
        borderRight: i < metres.length - 1 ? '1px solid ' + TT.line : 'none'
      }
    }, /*#__PURE__*/React.createElement(TtLabel, null, m.k), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 16,
        fontWeight: 800,
        marginTop: 3,
        color: t.c,
        fontVariantNumeric: 'tabular-nums'
      }
    }, m.v));
  })));
}

// ── Trade Setup — seulement quand les niveaux sont réellement calculables ──
/* Compteur d'attente : une analyse prend 6 à 20 s (alignement multi-unités +
   décision). Un spinner muet laisse croire à un blocage ; un compteur montre
   que ça avance. */
function TempsAnalyse({
  depuis
}) {
  const [s, setS] = React.useState(0);
  React.useEffect(() => {
    const t = setInterval(() => setS(Math.round((Date.now() - (depuis || Date.now())) / 1000)), 1000);
    return () => clearInterval(t);
  }, [depuis]);
  return /*#__PURE__*/React.createElement("span", {
    style: {
      fontVariantNumeric: 'tabular-nums'
    }
  }, " (", s, " s)");
}
function TradeSetupCard({
  signal,
  decision,
  sens,
  onToJournal,
  symbol,
  tf,
  provider,
  providerLabel
}) {
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
    const motifMoteur = decision ? signal && signal.levels ? null : decision.raison || decision.decision || 'aucun setup exécutable' : null;
    return /*#__PURE__*/React.createElement("div", {
      className: "panel",
      style: {
        padding: '11px 14px',
        marginBottom: 12,
        borderColor: 'rgba(148,163,184,.3)'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12,
        color: 'var(--muted)'
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: `fas ${enCours ? 'fa-spinner fa-spin' : 'fa-circle-info'}`,
      style: {
        marginRight: 7,
        color: TT.neu
      }
    }), enCours ? /*#__PURE__*/React.createElement(React.Fragment, null, "Analyse du march\xE9 en cours : les niveaux ne sont pas encore calcul\xE9s.", /*#__PURE__*/React.createElement(TempsAnalyse, {
      depuis: window.__debutAnalyse
    })) : /*#__PURE__*/React.createElement(React.Fragment, null, "Aucun setup ex\xE9cutable \u2014 ", motifMoteur, ". Le moteur ne publie pas de trade qu'il ne peut pas chiffrer.")));
  }
  const achat = signal.sens === 'long' || sens === 'BUY';
  const col = achat ? TT.ok : TT.bad;
  const risque = Math.abs(Number(lv.entry) - Number(lv.stop));
  const rr = Number.isFinite(Number(signal.rr)) && Number(signal.rr) > 0 ? Number(signal.rr) : Number.isFinite(Number(lv.target1)) && risque > 0 ? Math.abs(Number(lv.target1) - Number(lv.entry)) / risque : null;
  const ligne = (k, v, c) => /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      gap: 10,
      padding: '5px 0',
      borderBottom: '1px solid ' + TT.line
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11.5,
      color: 'var(--muted)'
    }
  }, k), /*#__PURE__*/React.createElement("b", {
    style: {
      fontSize: 12.5,
      color: c || '#e2e8f0',
      fontVariantNumeric: 'tabular-nums'
    }
  }, v));
  return /*#__PURE__*/React.createElement("div", {
    className: "panel",
    style: {
      padding: '13px 15px',
      marginBottom: 12,
      borderColor: col + '55'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      marginBottom: 8,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-crosshairs",
    style: {
      color: col
    }
  }), /*#__PURE__*/React.createElement("b", {
    style: {
      fontSize: 13
    }
  }, "Setup de trade"), /*#__PURE__*/React.createElement(TtPill, {
    tone: achat ? 'ok' : 'bad'
  }, achat ? 'ACHAT' : 'VENTE'), signal.nom && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11.5,
      color: 'var(--muted)'
    }
  }, signal.nom), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: '1 1 auto'
    }
  }), onToJournal && /*#__PURE__*/React.createElement("button", {
    className: "btn ghost sm",
    style: {
      padding: '5px 9px'
    },
    onClick: () => onToJournal({
      pair: symbol,
      direction: achat ? 'BUY' : 'SELL',
      entry: Number(lv.entry),
      sl: Number(lv.stop),
      tp: Number.isFinite(Number(lv.target1)) ? Number(lv.target1) : null,
      timeframe: tf,
      provider,
      providerLabel,
      signalStatus: 'confirme',
      signalStrength: signal.force,
      notes: `Setup ${achat ? 'achat' : 'vente'} — ${signal.nom || 'moteur'}`
    }),
    title: "Ouvrir le journal avec ce setup pr\xE9-rempli"
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-floppy-disk"
  }), "Journal")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))',
      gap: '0 18px'
    }
  }, /*#__PURE__*/React.createElement("div", null, ligne('Entrée', ttFmt(lv.entry)), ligne('Invalidation', ttFmt(lv.stop), TT.bad)), /*#__PURE__*/React.createElement("div", null, ligne('Objectif 1', ttFmt(lv.target1), TT.ok), ligne('Objectif 2', ttFmt(lv.target2), TT.ok)), /*#__PURE__*/React.createElement("div", null, ligne('Risque / Rendement', rr ? rr.toFixed(2) : '—', rr ? '#e2e8f0' : 'var(--dim)'), ligne('R attendu (modèle)', signal.modele && Number.isFinite(signal.modele.rAttendu) ? `${signal.modele.rAttendu > 0 ? '+' : ''}${signal.modele.rAttendu} R` : 'non couvert', signal.modele && Number.isFinite(signal.modele.rAttendu) && signal.modele.rAttendu > 0 ? TT.ok : 'var(--dim)'))), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '8px 0 0',
      fontSize: 10.5,
      color: 'var(--dim)'
    }
  }, "Obj 3 non affich\xE9 : le moteur ne le calcule pas. Aucun niveau n'est estim\xE9."));
}

// ── Condition Tracker : ✓ REMPLIE / ◷ EN ATTENTE / ✕ MANQUANTE ────────────
function ConditionChecklist({
  items
}) {
  if (!items || !items.length) {
    return /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11.5,
        color: 'var(--dim)'
      }
    }, "Aucune condition d\xE9taill\xE9e disponible pour cette strat\xE9gie.");
  }
  const etat = it => {
    if (it.ok === true) return {
      ico: 'fa-check',
      tone: 'ok',
      label: 'REMPLIE'
    };
    if (it.ok === false) return {
      ico: 'fa-xmark',
      tone: 'bad',
      label: 'MANQUANTE'
    };
    return {
      ico: 'fa-clock',
      tone: 'warn',
      label: 'EN ATTENTE'
    };
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 5
    }
  }, items.map((it, i) => {
    const e = etat(it);
    const t = TT_TONE[e.tone];
    return /*#__PURE__*/React.createElement("div", {
      key: i,
      style: {
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        padding: '5px 8px',
        borderRadius: 6,
        background: 'rgba(148,163,184,.045)'
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: `fas ${e.ico}`,
      style: {
        color: t.c,
        fontSize: 10,
        marginTop: 3,
        width: 10
      }
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        flex: 1,
        fontSize: 12,
        color: '#dbe4f0'
      }
    }, it.nom, it.valeur !== undefined && it.valeur !== null && String(it.valeur) !== '' && /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--muted)'
      }
    }, " = ", String(it.valeur)), it.seuil ? /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--dim)'
      }
    }, " (seuil ", String(it.seuil), ")") : null, it.detail && /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--dim)'
      }
    }, " \u2014 ", it.detail)), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 9.5,
        fontWeight: 700,
        color: t.c,
        whiteSpace: 'nowrap'
      }
    }, e.label));
  }));
}

// ── Strategy Card : une stratégie = un état lisible + conditions repliables ─
function StrategyCard({
  nom,
  categorie,
  etat,
  direction,
  conditionsOk,
  conditionsTotal,
  etape,
  prochaine,
  at,
  conditions,
  defautOuvert
}) {
  const ETATS = {
    VALIDEE: {
      label: 'VALIDÉE',
      tone: 'ok',
      ico: 'fa-circle-check'
    },
    ACTIVE: {
      label: 'ACTIVE',
      tone: 'info',
      ico: 'fa-satellite-dish'
    },
    ATTENTE: {
      label: 'EN ATTENTE',
      tone: 'warn',
      ico: 'fa-clock'
    },
    BLOQUEE: {
      label: 'BLOQUÉE',
      tone: 'bad',
      ico: 'fa-circle-xmark'
    },
    INACTIVE: {
      label: 'INACTIVE',
      tone: 'neu',
      ico: 'fa-circle-minus'
    },
    EXPIREE: {
      label: 'EXPIRÉE',
      tone: 'neu',
      ico: 'fa-hourglass-end'
    }
  };
  const e = ETATS[etat] || ETATS.INACTIVE;
  const t = TT_TONE[e.tone];
  const sensCol = direction === 'BUY' || direction === 'long' ? TT.ok : direction === 'SELL' || direction === 'short' ? TT.bad : TT.neu;
  const sensLab = direction === 'BUY' || direction === 'long' ? 'ACHAT' : direction === 'SELL' || direction === 'short' ? 'VENTE' : 'NEUTRE';
  return /*#__PURE__*/React.createElement("details", {
    open: !!defautOuvert,
    style: {
      border: `1px solid ${t.c}33`,
      borderRadius: 10,
      background: 'rgba(148,163,184,.03)',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("summary", {
    style: {
      cursor: 'pointer',
      padding: '9px 11px',
      listStyle: 'none',
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: `fas ${e.ico}`,
    style: {
      color: t.c,
      fontSize: 12
    }
  }), /*#__PURE__*/React.createElement("b", {
    style: {
      fontSize: 12.5,
      color: '#e8eef7'
    }
  }, nom), /*#__PURE__*/React.createElement(TtPill, {
    tone: e.tone
  }, e.label), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10.5,
      fontWeight: 700,
      color: sensCol
    }
  }, sensLab), conditionsTotal > 0 && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: 'var(--dim)',
      fontVariantNumeric: 'tabular-nums'
    }
  }, conditionsOk, "/", conditionsTotal, " conditions"), categorie && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10.5,
      color: 'var(--dim)'
    }
  }, "\xB7 ", categorie), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: '1 1 auto'
    }
  }), at && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10,
      color: 'var(--dim)'
    }
  }, ttAge(at))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '0 11px 11px'
    }
  }, etape && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11.5,
      color: 'var(--muted)',
      marginBottom: 6
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-route",
    style: {
      marginRight: 6,
      color: TT.info,
      fontSize: 10
    }
  }), etape), prochaine && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11.5,
      color: TT.warn,
      marginBottom: 7
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-arrow-right",
    style: {
      marginRight: 6,
      fontSize: 9
    }
  }), "Pour avancer : ", prochaine), /*#__PURE__*/React.createElement(ConditionChecklist, {
    items: conditions
  })));
}

// ── NIVEAU 02 : Strategy Monitor ─────────────────────────────────────────
function StrategyMonitor({
  playbooks,
  signaux,
  statuts,
  filtre,
  setFiltre,
  typeTrade,
  setTypeTrade
}) {
  const FILTRES = [['all', 'Toutes'], ['BUY', 'Achat'], ['SELL', 'Vente'], ['validated', 'Validées'], ['waiting', 'En attente'], ['blocked', 'Bloquées'], ['scalping', 'Scalping'], ['intraday', 'Intraday'], ['swing', 'Swing']];

  // 1. Types de trade (playbooks) — la lecture « métier » de l'avancement.
  const pbs = (playbooks || []).map(pb => {
    const etat = pb.pret ? 'VALIDEE' : pb.prerequisOk < pb.prerequisTotal ? 'BLOQUEE' : 'ATTENTE';
    const conditions = [...(pb.prerequis || []).map(p => ({
      nom: p.label,
      ok: p.ok === true,
      detail: p.detail
    })), ...(pb.etapes || []).map(e => ({
      nom: `Étape ${e.numero} — ${e.label}`,
      ok: e.ok === null || e.ok === undefined ? null : e.ok === true,
      detail: e.detail
    }))];
    return {
      cle: 'pb:' + pb.type,
      nom: pb.nom,
      categorie: 'Type de trade',
      type: pb.type,
      etat,
      direction: null,
      conditionsOk: conditions.filter(c => c.ok === true).length,
      conditionsTotal: conditions.length,
      etape: `${pb.avancement} · ${pb.duree} · ${(pb.timeframes || []).join('/')}`,
      prochaine: pb.pret ? null : pb.blocage || null,
      conditions,
      at: null,
      defautOuvert: pb.pret
    };
  });

  // 2. Signaux par stratégie/motif du moteur (arbitrage réel).
  const sigs = (signaux || []).map((s, i) => ({
    cle: 'sig:' + (s.id || i),
    nom: s.nom || s.id || 'Signal',
    categorie: s.source === 'strategie' ? 'Stratégie' : s.source === 'structure' ? 'Structure' : 'Motif',
    etat: s.status === 'confirme' ? 'VALIDEE' : s.status === 'surveiller' ? 'ATTENTE' : 'BLOQUEE',
    direction: s.sens,
    conditionsOk: (s.conditions || []).filter(c => c.ok).length,
    conditionsTotal: (s.conditions || []).length,
    etape: `force ${Number(s.force || 0).toFixed(2)}/1`,
    prochaine: s.raison || null,
    conditions: (s.conditions || []).map(c => ({
      nom: c.nom,
      valeur: c.valeur,
      seuil: c.seuil,
      ok: c.ok
    })),
    at: null,
    defautOuvert: false
  }));

  // 3. Évaluations persistées (toutes les stratégies suivies).
  const evals = (statuts || []).map((s, i) => ({
    cle: 'ev:' + i,
    nom: s.strategie + (s.version ? ` v${s.version}` : ''),
    categorie: `${s.symbole || ''} ${s.timeframe || ''}`.trim(),
    etat: s.statut === 'VALID' ? 'VALIDEE' : s.statut === 'WAITING' ? 'ATTENTE' : s.statut === 'INVALID' ? 'BLOQUEE' : 'INACTIVE',
    direction: s.direction,
    conditionsOk: s.conditionRemplies,
    conditionsTotal: s.conditionTotal,
    etape: s.score !== null && s.score !== undefined ? `score ${Number(s.score).toFixed(2)}` : null,
    prochaine: (s.obligatoiresManquantes || []).length ? `manque : ${s.obligatoiresManquantes.join(', ')}` : null,
    conditions: (s.obligatoiresManquantes || []).map(nom => ({
      nom,
      ok: false
    })),
    at: s.ageMs,
    defautOuvert: false
  }));
  let tous = [...pbs, ...sigs, ...evals];

  // Filtres
  if (filtre === 'validated') tous = tous.filter(x => x.etat === 'VALIDEE');else if (filtre === 'waiting') tous = tous.filter(x => x.etat === 'ATTENTE');else if (filtre === 'blocked') tous = tous.filter(x => x.etat === 'BLOQUEE');else if (filtre === 'BUY') tous = tous.filter(x => x.direction === 'BUY' || x.direction === 'long');else if (filtre === 'SELL') tous = tous.filter(x => x.direction === 'SELL' || x.direction === 'short');else if (['scalping', 'intraday', 'swing'].includes(filtre)) {
    tous = tous.filter(x => x.type === filtre || x.cle.startsWith('pb:') && x.type === filtre);
  }
  if (typeTrade !== 'auto') tous = tous.filter(x => x.type === typeTrade);

  // Compteurs réels
  const compte = etat => tous.filter(x => x.etat === etat).length;
  const nbValides = compte('VALIDEE'),
    nbAttente = compte('ATTENTE'),
    nbBloquees = compte('BLOQUEE');
  const nbStrategies = new Set((statuts || []).map(s => s.strategie)).size;
  return /*#__PURE__*/React.createElement("div", {
    className: "panel",
    style: {
      padding: '13px 15px',
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 9,
      flexWrap: 'wrap',
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-layer-group",
    style: {
      color: TT.info
    }
  }), /*#__PURE__*/React.createElement("b", {
    style: {
      fontSize: 13
    }
  }, "\xC9tat des strat\xE9gies"), /*#__PURE__*/React.createElement(TtPill, {
    tone: "ok"
  }, nbValides, " valid\xE9e", nbValides > 1 ? 's' : ''), /*#__PURE__*/React.createElement(TtPill, {
    tone: "warn"
  }, nbAttente, " en attente"), /*#__PURE__*/React.createElement(TtPill, {
    tone: "bad"
  }, nbBloquees, " bloqu\xE9e", nbBloquees > 1 ? 's' : ''), nbStrategies > 0 && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10.5,
      color: 'var(--dim)'
    }
  }, nbStrategies, " strat\xE9gie(s) \xE9valu\xE9e(s)"), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: '1 1 auto'
    }
  }), /*#__PURE__*/React.createElement("select", {
    className: "fld",
    "aria-label": "Filtrer les strat\xE9gies",
    style: {
      width: 'auto',
      margin: 0,
      padding: '4px 8px',
      fontSize: 11.5
    },
    value: typeTrade,
    onChange: e => setTypeTrade(e.target.value)
  }, /*#__PURE__*/React.createElement("option", {
    value: "auto"
  }, "Tous les types"), (playbooks || []).map(pb => /*#__PURE__*/React.createElement("option", {
    key: pb.type,
    value: pb.type
  }, pb.nom)))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 5,
      flexWrap: 'wrap',
      marginBottom: 10
    }
  }, FILTRES.map(([k, lab]) => /*#__PURE__*/React.createElement("button", {
    key: k,
    onClick: () => setFiltre(k),
    style: {
      fontSize: 11,
      fontWeight: 600,
      padding: '4px 9px',
      borderRadius: 999,
      cursor: 'pointer',
      fontFamily: 'inherit',
      border: `1px solid ${filtre === k ? TT.info + '88' : 'var(--border)'}`,
      background: filtre === k ? TT.infoBg : 'transparent',
      color: filtre === k ? '#93c5fd' : 'var(--muted)'
    }
  }, lab))), /*#__PURE__*/React.createElement(TtLabel, {
    style: {
      marginBottom: 6
    }
  }, "Cheminement du signal & strat\xE9gies en cours"), tous.length === 0 ? /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: 'var(--muted)',
      padding: '8px 10px',
      borderRadius: 8,
      background: 'rgba(148,163,184,.05)'
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-circle-minus",
    style: {
      marginRight: 7
    }
  }), "Aucune strat\xE9gie ne correspond \xE0 ce filtre. Le moteur n'en invente pas.") : /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 7
    }
  }, tous.map(x => /*#__PURE__*/React.createElement(StrategyCard, {
    key: x.cle,
    nom: x.nom,
    categorie: x.categorie,
    etat: x.etat,
    direction: x.direction,
    conditionsOk: x.conditionsOk,
    conditionsTotal: x.conditionsTotal,
    etape: x.etape,
    prochaine: x.prochaine,
    at: x.at,
    conditions: x.conditions,
    defautOuvert: x.defautOuvert
  }))));
}

// ── Matrice multi-timeframes ─────────────────────────────────────────────
function MultiTimeframeMatrix({
  confluence
}) {
  if (!confluence || !confluence.confluence) {
    return /*#__PURE__*/React.createElement("div", {
      className: "panel",
      style: {
        padding: '11px 14px',
        marginBottom: 12
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12,
        color: 'var(--muted)'
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: "fas fa-crosshairs",
      style: {
        marginRight: 7,
        color: TT.neu
      }
    }), "Alignement multi-timeframes indisponible (historique insuffisant sur les unit\xE9s sup\xE9rieures)."));
  }
  const c = confluence.confluence;
  const detail = c.detail || [];
  const parTF = new Map((confluence.parTimeframe || []).map(x => [x.tf, x]));
  const tendCol = t => t === 'bullish' ? TT.ok : t === 'bearish' ? TT.bad : TT.warn;
  const tendLab = t => t === 'bullish' ? 'HAUSSIER' : t === 'bearish' ? 'BAISSIER' : 'RANGE';
  return /*#__PURE__*/React.createElement("div", {
    className: "panel",
    style: {
      padding: '13px 15px',
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 9,
      flexWrap: 'wrap',
      marginBottom: 9
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-crosshairs",
    style: {
      color: TT.warn
    }
  }), /*#__PURE__*/React.createElement("b", {
    style: {
      fontSize: 13
    }
  }, "Alignement multi-timeframes"), /*#__PURE__*/React.createElement(TtPill, {
    tone: c.aligne ? 'ok' : 'warn'
  }, c.aligne ? 'ALIGNÉ' : 'NON ALIGNÉ', " \xB7 ", c.nbAlignes, "/", detail.length), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10.5,
      color: 'var(--dim)'
    }
  }, "seuil ", c.seuilAlignes, " unit\xE9(s)")), /*#__PURE__*/React.createElement("div", {
    className: "m-bar",
    role: "progressbar",
    "aria-valuemin": 0,
    "aria-valuemax": detail.length || 1,
    "aria-valuenow": c.nbAlignes,
    "aria-label": `Alignement ${c.nbAlignes} sur ${detail.length || 0} unités de temps`,
    style: {
      height: 4,
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "m-bar__fill",
    "data-animate": "in",
    style: {
      '--m-value': detail.length ? c.nbAlignes / detail.length : 0,
      background: c.aligne ? TT.ok : TT.warn
    }
  })), /*#__PURE__*/React.createElement("div", {
    className: "m-list",
    style: {
      display: 'flex',
      gap: 5,
      overflowX: 'auto',
      paddingBottom: 4
    }
  }, detail.map(t => {
    const info = parTF.get(t.tf) || {};
    const col = tendCol(t.tendance);
    return /*#__PURE__*/React.createElement("div", {
      key: t.tf,
      style: {
        minWidth: 74,
        flex: '1 0 auto',
        textAlign: 'center',
        padding: '7px 6px',
        borderRadius: 8,
        border: `1px solid ${t.confirme ? col + '77' : 'var(--border)'}`,
        background: t.confirme ? col + '14' : 'rgba(148,163,184,.04)'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11.5,
        fontWeight: 800,
        color: '#e8eef7'
      }
    }, t.tf), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 9.5,
        fontWeight: 700,
        color: col,
        marginTop: 2
      }
    }, tendLab(t.tendance)), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 9.5,
        color: 'var(--dim)',
        marginTop: 1
      }
    }, info.direction && info.direction !== 'NEUTRE' ? info.direction : '—'), /*#__PURE__*/React.createElement("i", {
      className: `fas ${t.confirme ? 'fa-circle-check' : 'fa-circle-minus'}`,
      style: {
        fontSize: 9,
        color: t.confirme ? TT.ok : TT.neu,
        marginTop: 3
      }
    }));
  })), c.motif && /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '8px 0 0',
      fontSize: 11,
      color: 'var(--dim)'
    }
  }, c.motif), c.contreTendance && /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '4px 0 0',
      fontSize: 11,
      color: TT.bad
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-triangle-exclamation",
    style: {
      marginRight: 5
    }
  }), "Contre-tendance d\xE9tect\xE9e : le signal va contre une unit\xE9 sup\xE9rieure."));
}

// ── Signal Explanation — les 4 couches, séparées ─────────────────────────
function SignalExplanation({
  trace,
  decision,
  signal
}) {
  if (!trace && !signal) {
    return /*#__PURE__*/React.createElement("div", {
      className: "panel",
      style: {
        padding: '11px 14px',
        marginBottom: 12
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12,
        color: 'var(--muted)'
      }
    }, "Explication indisponible : le moteur n'a pas encore arbitr\xE9 ce march\xE9."));
  }
  const couches = trace ? [{
    n: '1',
    k: 'Biais du marché',
    v: trace.arbitrage ? trace.arbitrage.biais : null,
    o: trace.detection
  }, {
    n: '2',
    k: 'Validation stratégie',
    v: trace.validation && trace.validation.resume,
    o: trace.validation
  }, {
    n: '3',
    k: 'Confirmation d\'entrée',
    v: trace.confirmation && trace.confirmation.resume,
    o: trace.confirmation
  }, {
    n: '4',
    k: 'Éligibilité d\'exécution',
    v: trace.execution && trace.execution.resume,
    o: trace.execution
  }] : [];
  // Premier blocage réel, tous niveaux confondus.
  let blocage = null;
  if (trace) {
    for (const niveau of ['validation', 'confirmation', 'execution']) {
      const t = trace[niveau];
      if (!t || !Array.isArray(t.details)) continue;
      const d = t.details.find(x => x.ok === false && x.blocages && x.blocages.length);
      if (d) {
        blocage = `${d.nom} — ${d.blocages[0]}`;
        break;
      }
    }
  }
  return /*#__PURE__*/React.createElement("div", {
    className: "panel",
    style: {
      padding: '13px 15px',
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 9,
      marginBottom: 9
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-circle-question",
    style: {
      color: TT.info
    }
  }), /*#__PURE__*/React.createElement("b", {
    style: {
      fontSize: 13
    }
  }, "Pourquoi cette d\xE9cision")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 6
    }
  }, couches.map(c => {
    const ok = c.o && c.o.ok === true;
    const tone = !c.o ? 'neu' : ok ? 'ok' : 'warn';
    const t = TT_TONE[tone];
    return /*#__PURE__*/React.createElement("div", {
      key: c.k,
      style: {
        display: 'flex',
        gap: 9,
        alignItems: 'baseline',
        fontSize: 12,
        padding: '5px 8px',
        borderRadius: 6,
        background: t.bg
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 9.5,
        fontWeight: 800,
        color: t.c,
        minWidth: 12
      }
    }, c.n), /*#__PURE__*/React.createElement("b", {
      style: {
        color: t.c,
        minWidth: 150
      }
    }, c.k), /*#__PURE__*/React.createElement("span", {
      style: {
        flex: 1,
        color: 'var(--muted)'
      }
    }, c.v || (c.o ? c.o.resume : 'non évalué')), /*#__PURE__*/React.createElement("i", {
      className: `fas ${ok ? 'fa-check' : c.o ? 'fa-xmark' : 'fa-minus'}`,
      style: {
        color: t.c,
        fontSize: 10
      }
    }));
  })), blocage && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 8,
      padding: '7px 10px',
      borderRadius: 7,
      background: TT.badBg,
      border: '1px solid ' + TT.bad + '44',
      fontSize: 11.5,
      color: '#fca5a5'
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-lock",
    style: {
      marginRight: 7
    }
  }), "Ce qui bloque : ", blocage), decision && decision.raison && /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '8px 0 0',
      fontSize: 11,
      color: 'var(--dim)'
    }
  }, "Arbitrage : ", decision.raison), signal && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 9,
      paddingTop: 8,
      borderTop: '1px solid ' + TT.line,
      fontSize: 11.5,
      color: 'var(--muted)',
      display: 'flex',
      gap: 4,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 600,
      color: '#dbe4f0'
    }
  }, "D\xE9tail du verdict"), /*#__PURE__*/React.createElement("span", null, signal.confirmations, "/", (signal.reglesEvaluees || signal.reglesActives || []).length || signal.confirmations, " r\xE8gle(s) d'accord"), /*#__PURE__*/React.createElement("span", {
    title: signal.forceDetail ? signal.forceDetail.lecture : 'Score interne du moteur — ce n\'est pas un taux de réussite.'
  }, ' · ', "force ", signal.forceNiveau || '—', ' ', /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--dim)'
    }
  }, "(", Number(signal.strength || 0).toFixed(2), "/1)")), signal.trend ? /*#__PURE__*/React.createElement("span", null, ' · ', "tendance ", signal.trend) : null, (signal.reglesSansAvis || []).length > 0 && /*#__PURE__*/React.createElement("span", {
    title: (signal.reglesLecture || '') + ' — une règle sans avis n\'est ni d\'accord ni contre : elle n\'a rien trouvé sur ce graphique.',
    style: {
      color: 'var(--dim)'
    }
  }, ' · ', signal.reglesSansAvis.length, " sans avis (", signal.reglesSansAvis.join(', '), ")"), (signal.reglesOpposees || []).length > 0 && /*#__PURE__*/React.createElement("span", {
    style: {
      color: TT.bad
    }
  }, ' · ', signal.reglesOpposees.length, " contre (", signal.reglesOpposees.join(', '), ")")));
}

// ── NIVEAU 01 : Market Intelligence (structure du marché) ────────────────
function MarketStructurePanel({
  carte,
  report
}) {
  if (!carte) return null;
  const tendCol = carte.tendance === 'bullish' ? TT.ok : carte.tendance === 'bearish' ? TT.bad : TT.warn;
  const tendLab = carte.tendance === 'bullish' ? 'HAUSSIÈRE' : carte.tendance === 'bearish' ? 'BAISSIÈRE' : 'RANGE';
  const liq = (carte.liquidite || []).slice().sort((a, b) => (a.distanceAtr ?? 99) - (b.distanceAtr ?? 99))[0];
  const z = carte.zoneLaPlusProche;
  const ev = carte.evenement;
  const pos = carte.position;
  const cell = (label, valeur, couleur) => /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 118
    }
  }, /*#__PURE__*/React.createElement(TtLabel, null, label), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      fontWeight: 700,
      color: couleur || '#e2e8f0',
      marginTop: 2
    }
  }, valeur));
  return /*#__PURE__*/React.createElement("div", {
    className: "panel",
    style: {
      padding: '13px 15px',
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 9,
      flexWrap: 'wrap',
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 9.5,
      fontWeight: 800,
      color: TT.info,
      letterSpacing: '.08em'
    }
  }, "01"), /*#__PURE__*/React.createElement("i", {
    className: "fas fa-sitemap",
    style: {
      color: TT.info
    }
  }), /*#__PURE__*/React.createElement("b", {
    style: {
      fontSize: 13
    }
  }, "Intelligence de march\xE9"), carte.session && carte.session.killZone && carte.session.killZone !== 'aucune en ce moment' && /*#__PURE__*/React.createElement(TtPill, {
    tone: "warn"
  }, "kill zone ", carte.session.killZone)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 20,
      flexWrap: 'wrap'
    }
  }, cell('Tendance', tendLab, tendCol), ev ? cell('Dernière cassure', `${ev.type} @ ${ttFmt(ev.niveau)}`, ev.sens === 'long' ? TT.ok : TT.bad) : cell('Dernière cassure', 'aucune (range)', 'var(--muted)'), pos ? cell('Position', `${pos.zone}`, pos.zone === 'premium' ? TT.bad : TT.ok) : null, z ? cell('Zone la plus proche', `${z.type} · ${z.distanceAtr} ATR`, '#93c5fd') : null, liq ? cell('Liquidité', `${liq.type} ${ttFmt(liq.prix)}`, TT.warn) : null, Number.isFinite(carte.atr) ? cell('ATR', ttFmt(carte.atr), 'var(--muted)') : null, carte.session ? cell('Session', carte.session.courante || '—', 'var(--muted)') : null), report && /*#__PURE__*/React.createElement("details", {
    style: {
      marginTop: 10
    }
  }, /*#__PURE__*/React.createElement("summary", {
    style: {
      cursor: 'pointer',
      fontSize: 11.5,
      color: 'var(--muted)'
    }
  }, "D\xE9tail technique (Fibonacci, niveaux, inventaire)"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 8,
      marginTop: 8,
      fontSize: 11.5
    }
  }, report.structure && /*#__PURE__*/React.createElement("div", {
    style: {
      color: 'var(--muted)'
    }
  }, "Structure : tendance ", /*#__PURE__*/React.createElement("b", {
    style: {
      color: '#e2e8f0'
    }
  }, report.structure.trend), report.structure.recent && report.structure.recent.length > 0 && /*#__PURE__*/React.createElement(React.Fragment, null, " \xB7 ", (report.structure.recent || []).map(r => `${r.label} ${ttFmt(r.price)}`).join(' · '))), report.fibLevels && /*#__PURE__*/React.createElement("div", {
    style: {
      color: 'var(--muted)'
    }
  }, "Fibonacci (", report.fibLevels.sens, ") :\xA0", Object.entries(report.fibLevels.levels).map(([k, v]) => `${k}=${ttFmt(v)}`).join(' · ')), Array.isArray(report.levels) && report.levels.length > 0 && /*#__PURE__*/React.createElement("div", {
    tabIndex: 0,
    role: "region",
    "aria-label": "Niveaux calcul\xE9s",
    style: {
      maxHeight: 160,
      overflowY: 'auto'
    }
  }, report.levels.slice(0, 40).map((l, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      gap: 10,
      padding: '3px 0',
      borderBottom: '1px solid ' + TT.line
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--muted)'
    }
  }, l.kind), /*#__PURE__*/React.createElement("b", {
    style: {
      fontVariantNumeric: 'tabular-nums'
    }
  }, ttFmt(l.price))))))));
}

// ── Historique des signaux (confirmés / rejetés / expirés) ───────────────
function SignalHistory({
  journal
}) {
  const RES = {
    tp1: {
      l: 'OBJ 1',
      tone: 'ok'
    },
    tp2: {
      l: 'OBJ 2',
      tone: 'ok'
    },
    sl: {
      l: 'STOP',
      tone: 'bad'
    },
    be: {
      l: 'BE',
      tone: 'neu'
    },
    expire: {
      l: 'EXPIRÉ',
      tone: 'neu'
    },
    ouvert: {
      l: 'OUVERT',
      tone: 'info'
    }
  };
  const liste = (journal || []).slice(0, 20);
  return /*#__PURE__*/React.createElement("details", {
    className: "panel",
    style: {
      padding: '13px 15px',
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("summary", {
    style: {
      cursor: 'pointer',
      fontSize: 12.5,
      fontWeight: 700
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-clock-rotate-left",
    style: {
      marginRight: 8,
      color: TT.info
    }
  }), "Historique des signaux (", liste.length, ")"), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 9
    }
  }, liste.length === 0 ? /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11.5,
      color: 'var(--dim)'
    }
  }, "Aucun signal enregistr\xE9. Le journal se remplit \xE0 chaque signal confirm\xE9 ou \xE0 surveiller.") : /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 4
    }
  }, liste.map((s, i) => {
    const r = RES[s.resultat] || RES.ouvert;
    const achat = s.sens === 'long';
    return /*#__PURE__*/React.createElement("div", {
      key: i,
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 11.5,
        padding: '4px 0',
        borderBottom: '1px solid ' + TT.line
      }
    }, /*#__PURE__*/React.createElement("b", {
      style: {
        color: achat ? TT.ok : TT.bad,
        minWidth: 46
      }
    }, achat ? 'ACHAT' : 'VENTE'), /*#__PURE__*/React.createElement("span", {
      style: {
        color: '#dbe4f0',
        minWidth: 76
      }
    }, s.symbol || '—'), /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--muted)',
        flex: 1,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap'
      }
    }, s.nom || s.id || ''), /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--dim)',
        fontVariantNumeric: 'tabular-nums'
      }
    }, s.entree !== undefined ? ttFmt(s.entree) : ''), /*#__PURE__*/React.createElement(TtPill, {
      tone: r.tone
    }, r.l));
  }))));
}

/* ══════════════════════════ ÉCRAN DIRECT ══════════════════════════ */

function LiveMarket({
  onToJournal
}) {
  const [meta, setMeta] = useState({
    symbols: [],
    timeframes: ['1m', '5m', '15m', '1h']
  });
  const [symbol, setSymbol] = useState('R_75');
  const [provider, setProvider] = useState('deriv');
  const [tf, setTf] = useState('5m');
  const [profondeur, setProfondeur] = useState(300);
  const [mode, setMode] = useState('auto');
  const [strategiesChoisies, setStrategiesChoisies] = useState([]);
  const [choixOuvert, setChoixOuvert] = useState(false);
  const [filtreProfil, setFiltreProfil] = useState('');
  const [profils, setProfils] = useState([]);
  const [reglages, setReglages] = useState(false); // panneau de réglages replié

  const [candles, setCandles] = useState([]);
  const [report, setReport] = useState(null);
  const [vocabulaire, setVocabulaire] = useState(null);
  const [playbooks, setPlaybooks] = useState(null);
  const [decision, setDecision] = useState(null); // DecisionEngine complet
  const [verdict, setVerdict] = useState(null); // verdict détaillé (règles, force)
  const [sse, setSse] = useState(null); // flux temps réel (repli)
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
      } catch (e) {/* la sélection reste vide, le direct fonctionne en auto */}
    })();
  }, []);

  // Marchés disponibles.
  useEffect(() => {
    (async () => {
      try {
        const m = await (await api('/market/symbols')).json();
        if (m.success) setMeta({
          symbols: m.symbols || [],
          timeframes: m.timeframes || meta.timeframes
        });
      } catch (e) {/* hors ligne : on garde les valeurs par défaut */}
    })();
  }, []);
  const paramsCommuns = useCallback(() => {
    const p = `symbol=${encodeURIComponent(symbol)}&tf=${tf}&provider=${provider}&mode=${mode}`;
    return mode === 'manuel' && strategiesChoisies.length ? p + '&strategies=' + encodeURIComponent(strategiesChoisies.join(',')) : p;
  }, [symbol, tf, provider, mode, strategiesChoisies.join(',')]);

  // Changement de marché : on vide tout de suite (jamais l'ancien marché étiqueté).
  useEffect(() => {
    setCandles([]);
    setReport(null);
    setVocabulaire(null);
    setDecision(null);
    setSse(null);
    setConfluence(null);
    setTicks(0);
    window.__debutAnalyse = Date.now(); // point de départ du compteur d'attente
  }, [symbol, tf, provider]);

  // Bougies + structure (playbooks, vocabulaire) — rafraîchi régulièrement.
  const load = useCallback(async () => {
    setErr('');
    try {
      const [cb, st] = await Promise.all([api(`/market/candles?symbol=${encodeURIComponent(symbol)}&tf=${tf}&count=${profondeur}&provider=${provider}`).then(r => r.json()).catch(() => null), api(`/market/structure?symbol=${encodeURIComponent(symbol)}&tf=${tf}&provider=${provider}`).then(r => r.json()).catch(() => null)]);
      if (cb && cb.success && Array.isArray(cb.candles) && cb.candles.length) setCandles(cb.candles);
      if (cb && cb.offline) setOffline(true);
      if (st && st.success && st.report) {
        setReport(st.report);
        if (st.vocabulaire) setVocabulaire(st.vocabulaire);
        if (st.playbooks) setPlaybooks(st.playbooks);
      }
      if (!cb || !cb.success) {
        setErr(cb && cb.error || 'chargement des bougies impossible');
      }
    } catch (e) {
      setErr(String(e.message || e));
    }
  }, [symbol, tf, provider, profondeur]);
  useEffect(() => {
    let vivant = true;
    const recharger = () => {
      if (vivant) load();
    };
    recharger();
    const it = setInterval(recharger, 5000);
    return () => {
      vivant = false;
      clearInterval(it);
    };
  }, [load]);

  // Décision complète du moteur (arbitrage 5 niveaux) — et alignement MTF.
  useEffect(() => {
    let vivant = true;
    const chargerDecision = async () => {
      try {
        const d = await (await api(`/decision?${paramsCommuns()}`)).json();
        if (vivant && d.success && d.decision) {
          setDecision(d.decision);
        }
      } catch (e) {/* repli : le flux SSE garde le dernier verdict */}
    };
    const chargerVerdict = async () => {
      try {
        const d = await (await api(`/signals?${paramsCommuns()}`)).json();
        if (vivant && d.success && d.verdict) setVerdict(d.verdict);
      } catch (e) {/* verdict détaillé absent : on n'affiche rien plutôt qu'un faux */}
    };
    const chargerConfluence = async () => {
      try {
        const d = await (await api(`/signals/confluence?${paramsCommuns()}`)).json();
        if (vivant && d.success) setConfluence(d);
      } catch (e) {/* pas d'alignement : on n'affiche rien plutôt qu'un faux */}
    };
    const chargerStatuts = async () => {
      try {
        const d = await (await api('/live/statuts')).json();
        if (vivant && d.success) setStatuts(Array.isArray(d.statuts) ? d.statuts : []);
      } catch (e) {/* table absente : liste vide, jamais inventée */}
    };
    const chargerJournal = async () => {
      try {
        const d = await (await api('/journal-signaux?limite=40')).json();
        if (vivant && d.success) setJournal(Array.isArray(d.signaux) ? d.signaux : []);
      } catch (e) {/* journal absent : section vide */}
    };
    setDecision(null);
    setConfluence(null);
    setVerdict(null);
    chargerDecision();
    chargerVerdict();
    chargerConfluence();
    chargerStatuts();
    chargerJournal();
    const iDec = setInterval(() => {
      if (vivant) chargerDecision();
    }, 15000);
    const iVer = setInterval(() => {
      if (vivant) chargerVerdict();
    }, 15000);
    const iConf = setInterval(() => {
      if (vivant) chargerConfluence();
    }, 60000);
    const iStat = setInterval(() => {
      if (vivant) chargerStatuts();
    }, 30000);
    const iJour = setInterval(() => {
      if (vivant) chargerJournal();
    }, 60000);
    return () => {
      vivant = false;
      clearInterval(iDec);
      clearInterval(iVer);
      clearInterval(iConf);
      clearInterval(iStat);
      clearInterval(iJour);
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
      } catch (e) {/* trame illisible : ignorée */}
    });
    es.addEventListener('error', () => setLive(false));
    return () => es.close();
  }, [symbol, tf, provider]);

  // Ticks bruts (prix réel).
  useEffect(() => {
    if (!symbol) return;
    setTick(null);
    setTickRate(0);
    tickPrec.current = null;
    const es = new EventSource(`/api/market/ticks?symbol=${encodeURIComponent(symbol)}&provider=${provider}`);
    let recus = 0;
    es.addEventListener('tick', ev => {
      try {
        const t = JSON.parse(ev.data);
        setTick({
          ...t,
          prec: tickPrec.current
        });
        tickPrec.current = t.prix;
        recus++;
      } catch (e) {/* tick illisible */}
    });
    es.addEventListener('error', () => {});
    const compteur = setInterval(() => {
      setTickRate(recus);
      recus = 0;
    }, 1000);
    return () => {
      clearInterval(compteur);
      es.close();
    };
  }, [symbol, provider]);

  // Verdict en direct (SSE) : repli immédiat du Decision Center.
  useEffect(() => {
    setSse(null);
    const es = new EventSource(`/api/signals/stream?${paramsCommuns()}`);
    es.addEventListener('signal', ev => {
      try {
        setSse(JSON.parse(ev.data));
      } catch (e) {/* trame illisible */}
    });
    return () => es.close();
  }, [paramsCommuns]);
  const analyser = async () => {
    setBusy(true);
    setErr('');
    try {
      const r = await (await api('/market/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          symbol,
          tf,
          provider,
          maxStrategies: 3
        })
      })).json();
      if (!r.success) throw new Error(r.error || 'analyse impossible');
      setResult(r);
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };
  const last = candles.length ? candles[candles.length - 1] : null;
  const prix = tick ? tick.prix : last ? last.c : null;
  const cur = meta.symbols.find(s => s.symbol === symbol && s.provider === provider);
  const providerLabel = cur ? cur.tv || cur.providerLabel : provider;
  const sensAffiche = decision && decision.signal && decision.signal.sens || sse && sse.direction || null;
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
    return plein ? {
      ...s,
      levels: {
        entry: plein.entree,
        stop: plein.stop,
        target1: (plein.objectifs || [])[0],
        target2: (plein.objectifs || [])[1]
      }
    } : s;
  })();
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "panel",
    style: {
      padding: '11px 14px',
      marginBottom: 12,
      position: 'sticky',
      top: 0,
      zIndex: 40,
      background: 'var(--panel)',
      boxShadow: '0 6px 18px -12px rgba(0,0,0,.9)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9.5,
      fontWeight: 800,
      letterSpacing: '.1em',
      color: 'var(--dim)',
      textTransform: 'uppercase'
    }
  }, "5trade terminal"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'baseline',
      gap: 8,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("b", {
    style: {
      fontSize: 16
    }
  }, providerLabel), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11.5,
      color: 'var(--muted)'
    }
  }, cur && cur.label || symbol, " \xB7 ", tf), signal && signal.mode === 'manuel' && signal.strategieAppliquee && /*#__PURE__*/React.createElement(TtPill, {
    tone: "info",
    title: `Verdict limité aux règles de : ${(signal.strategieAppliquee.regles || []).join(', ')}`
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-book",
    style: {
      fontSize: 9
    }
  }), signal.strategieAppliquee.titre))), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: '1 1 auto'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'right'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 20,
      fontWeight: 800,
      fontVariantNumeric: 'tabular-nums',
      letterSpacing: '-.02em',
      color: tick && tick.prec !== null && tick.prec !== undefined ? tick.prix > tick.prec ? TT.ok : tick.prix < tick.prec ? TT.bad : '#fff' : '#fff'
    }
  }, ttFmt(prix)), tickRate > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9.5,
      color: 'var(--dim)'
    }
  }, tickRate, " tick/s")), /*#__PURE__*/React.createElement(LiveStatusIndicator, {
    live: live,
    offline: offline,
    ticks: ticks,
    lastUpdate: lastUpdate,
    onRefresh: load,
    busy: busy
  }), /*#__PURE__*/React.createElement("button", {
    className: "btn ghost sm",
    style: {
      padding: '5px 9px'
    },
    onClick: () => setReglages(r => !r),
    title: "March\xE9, unit\xE9 de temps, strat\xE9gie"
  }, /*#__PURE__*/React.createElement("i", {
    className: `fas ${reglages ? 'fa-xmark' : 'fa-sliders'}`
  }))), reglages && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 10,
      paddingTop: 10,
      borderTop: '1px solid ' + TT.line,
      display: 'flex',
      gap: 8,
      alignItems: 'center',
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("select", {
    className: "fld",
    "aria-label": "March\xE9 analys\xE9",
    style: {
      width: 220
    },
    value: `${provider}|${symbol}`,
    onChange: e => {
      const [pv, sy] = e.target.value.split('|');
      setProvider(pv);
      setSymbol(sy);
    }
  }, Object.entries((meta.symbols || []).reduce((acc, s) => {
    const k = s.providerLabel || 'Marchés';
    (acc[k] = acc[k] || []).push(s);
    return acc;
  }, {})).map(([label, list]) => /*#__PURE__*/React.createElement("optgroup", {
    key: label,
    label: label
  }, list.map(s => /*#__PURE__*/React.createElement("option", {
    key: `${s.provider}|${s.symbol}`,
    value: `${s.provider}|${s.symbol}`
  }, s.tv ? `${s.tv} — ${s.label}` : s.label))))), /*#__PURE__*/React.createElement("select", {
    className: "fld",
    "aria-label": "Unit\xE9 de temps",
    style: {
      width: 92
    },
    value: tf,
    onChange: e => setTf(e.target.value)
  }, (meta.timeframes || []).map(t => /*#__PURE__*/React.createElement("option", {
    key: t,
    value: t
  }, t))), /*#__PURE__*/React.createElement("select", {
    className: "fld",
    "aria-label": "Mode d'analyse",
    style: {
      width: 148
    },
    value: mode,
    onChange: e => setMode(e.target.value),
    title: "Auto : l'app combine toutes les r\xE8gles. Manuel : uniquement les r\xE8gles d'une strat\xE9gie de ta base."
  }, /*#__PURE__*/React.createElement("option", {
    value: "auto"
  }, "Analyse auto"), /*#__PURE__*/React.createElement("option", {
    value: "manuel"
  }, "Ma strat\xE9gie")), /*#__PURE__*/React.createElement("select", {
    className: "fld",
    "aria-label": "Profondeur d'historique",
    style: {
      width: 112
    },
    value: profondeur,
    onChange: e => setProfondeur(Number(e.target.value))
  }, [150, 300, 500, 1000].map(n => /*#__PURE__*/React.createElement("option", {
    key: n,
    value: n
  }, n, " bougies"))), mode === 'manuel' && /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative'
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn ghost sm",
    onClick: () => setChoixOuvert(o => !o)
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-list-check"
  }), strategiesChoisies.length ? `${strategiesChoisies.length} stratégie(s)` : 'Choisir'), choixOuvert && /*#__PURE__*/React.createElement("div", {
    className: "panel",
    style: {
      position: 'absolute',
      zIndex: 60,
      top: '115%',
      left: 0,
      width: 340,
      maxHeight: 320,
      overflowY: 'auto',
      padding: 12
    }
  }, /*#__PURE__*/React.createElement("input", {
    className: "fld",
    placeholder: "Filtrer\u2026",
    value: filtreProfil,
    onChange: e => setFiltreProfil(e.target.value),
    style: {
      width: '100%',
      marginBottom: 8
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 6,
      marginBottom: 8
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn ghost sm",
    onClick: () => setStrategiesChoisies(profils.map(p => p.id))
  }, "Tout"), /*#__PURE__*/React.createElement("button", {
    className: "btn ghost sm",
    onClick: () => setStrategiesChoisies([])
  }, "Aucune"), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: 'auto',
      fontSize: 11,
      color: 'var(--dim)',
      alignSelf: 'center'
    }
  }, profils.length, " disponible(s)")), profils.filter(p => !filtreProfil || String(p.titre || '').toLowerCase().includes(filtreProfil.toLowerCase())).map(p => /*#__PURE__*/React.createElement("label", {
    key: p.id,
    style: {
      display: 'flex',
      gap: 8,
      alignItems: 'center',
      padding: '5px 2px',
      fontSize: 12.5,
      cursor: 'pointer'
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    checked: strategiesChoisies.includes(p.id),
    onChange: () => setStrategiesChoisies(l => l.includes(p.id) ? l.filter(x => x !== p.id) : [...l, p.id])
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }, p.titre), /*#__PURE__*/React.createElement("span", {
    className: "tag",
    style: {
      fontSize: 10
    }
  }, (p.regles || []).join('+')))), !profils.length && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: 'var(--dim)'
    }
  }, "Aucune strat\xE9gie dans la base."))), mode === 'manuel' && strategiesChoisies.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 5,
      flexWrap: 'wrap',
      alignItems: 'center'
    }
  }, strategiesChoisies.map(id => {
    const p = profils.find(x => x.id === id);
    return /*#__PURE__*/React.createElement("span", {
      key: id,
      className: "tag",
      style: {
        fontSize: 10.5,
        cursor: 'pointer'
      },
      title: "Cliquer pour retirer",
      onClick: () => setStrategiesChoisies(l => l.filter(x => x !== id))
    }, (p ? p.titre : id).slice(0, 28), /*#__PURE__*/React.createElement("i", {
      className: "fas fa-xmark",
      style: {
        marginLeft: 5
      }
    }));
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: '1 1 auto'
    }
  }), /*#__PURE__*/React.createElement("button", {
    className: "btn ghost sm",
    onClick: () => setBig(b => !b),
    title: big ? 'Réduire le graphique' : 'Agrandir le graphique'
  }, /*#__PURE__*/React.createElement("i", {
    className: `fas ${big ? 'fa-compress' : 'fa-expand'}`
  })), /*#__PURE__*/React.createElement("button", {
    className: "btn ghost sm",
    onClick: () => setVue(v => v === 'app' ? 'tradingview' : 'app')
  }, /*#__PURE__*/React.createElement("i", {
    className: `fas ${vue === 'app' ? 'fa-tv' : 'fa-chart-line'}`
  }), vue === 'app' ? 'TradingView' : 'Vue app'), /*#__PURE__*/React.createElement("button", {
    className: "btn",
    onClick: analyser,
    disabled: busy
  }, busy ? /*#__PURE__*/React.createElement(Spinner, null) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-bolt"
  }), "Analyser")))), err && /*#__PURE__*/React.createElement("div", {
    className: "panel",
    style: {
      padding: '10px 14px',
      marginBottom: 12,
      borderColor: 'rgba(239,68,68,.45)',
      color: '#fca5a5',
      fontSize: 12.5
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-triangle-exclamation",
    style: {
      marginRight: 8
    }
  }), /Pas assez de bougies/i.test(err) ? `${err} — marché probablement fermé. Les indices synthétiques (Volatility) et les cryptos cotent 24 h/24.` : err), /*#__PURE__*/React.createElement(LiveDecisionCenter, {
    decision: decision,
    sse: sse,
    price: prix,
    at: decision && decision.at || last && last.t,
    symbol: symbol,
    tf: tf,
    providerLabel: providerLabel,
    confluence: confluence
  }), /*#__PURE__*/React.createElement(TradeSetupCard, {
    signal: meilleurSetup,
    decision: decision || (sse && sse.decision ? sse : null),
    sens: sensAffiche,
    onToJournal: onToJournal,
    symbol: symbol,
    tf: tf,
    provider: provider,
    providerLabel: providerLabel
  }), /*#__PURE__*/React.createElement("div", {
    className: "panel",
    style: {
      padding: 14,
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      flexWrap: 'wrap',
      gap: 8,
      marginBottom: 8
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'baseline',
      gap: 10,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement(TtLabel, null, "Graphique"), last && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: 'var(--muted)'
    }
  }, "O ", ttFmt(last.o), " \xB7 H ", ttFmt(last.h), " \xB7 L ", ttFmt(last.l), " \xB7 C ", ttFmt(last.c))), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: 'var(--dim)'
    }
  }, report ? `${report.candles} bougies · ATR ${report.atr14}` : '')), /*#__PURE__*/React.createElement("div", {
    className: "chart-mobile"
  }, vue === 'app' ? /*#__PURE__*/React.createElement(PriceChart, {
    candles: candles,
    report: report,
    levels: report ? report.levels : [],
    signal: decision && decision.signal,
    height: big ? etroi ? 460 : 620 : etroi ? 300 : 430,
    symbol: symbol,
    tf: tf
  }) : /*#__PURE__*/React.createElement(TradingViewChart, {
    symbole: cur && cur.tv,
    tf: tf,
    height: big ? etroi ? 460 : 620 : etroi ? 300 : 430
  }))), /*#__PURE__*/React.createElement(StrategyMonitor, {
    playbooks: playbooks,
    signaux: decision && decision.signaux || [],
    statuts: statuts,
    filtre: filtre,
    setFiltre: setFiltre,
    typeTrade: typeTrade,
    setTypeTrade: setTypeTrade
  }), /*#__PURE__*/React.createElement(MultiTimeframeMatrix, {
    confluence: confluence
  }), /*#__PURE__*/React.createElement(SignalExplanation, {
    trace: decision && decision.trace || sse && sse.trace,
    decision: decision,
    signal: verdict
  }), /*#__PURE__*/React.createElement(MarketStructurePanel, {
    carte: decision && decision.carte,
    report: report
  }), /*#__PURE__*/React.createElement(SignalHistory, {
    journal: journal
  }), vocabulaire && vocabulaire.length > 0 && /*#__PURE__*/React.createElement("details", {
    className: "panel",
    style: {
      padding: '12px 15px',
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("summary", {
    style: {
      cursor: 'pointer',
      fontSize: 12.5,
      fontWeight: 700
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-list-check",
    style: {
      marginRight: 8,
      color: TT.info
    }
  }), "Termes v\xE9rifi\xE9s sur ce graphique", ' · ', vocabulaire.filter(t => t.present).length, "/", vocabulaire.length), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 4,
      marginTop: 8
    }
  }, vocabulaire.map(t => /*#__PURE__*/React.createElement("div", {
    key: t.sigle,
    style: {
      display: 'flex',
      gap: 10,
      alignItems: 'baseline',
      fontSize: 12,
      opacity: t.present ? 1 : 0.45
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: `fas ${t.present ? 'fa-circle-check' : 'fa-circle-minus'}`,
    style: {
      width: 12,
      color: t.present ? TT.ok : TT.neu,
      fontSize: 10
    }
  }), /*#__PURE__*/React.createElement("b", {
    style: {
      width: 104,
      color: t.present ? '#93c5fd' : 'var(--muted)'
    }
  }, t.sigle), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      color: 'var(--muted)'
    }
  }, t.valeur || t.lecture))))), result && /*#__PURE__*/React.createElement(Result, {
    result: result
  }));
}

/* ══════════════ JOURNAL DE TRADES ══════════════ */

const TRADE_R = {
  win: {
    label: 'Gain',
    color: '#10b981',
    bg: 'rgba(16,185,129,.13)',
    icon: 'fa-arrow-trend-up'
  },
  loss: {
    label: 'Perte',
    color: '#ef4444',
    bg: 'rgba(239,68,68,.13)',
    icon: 'fa-arrow-trend-down'
  },
  breakeven: {
    label: 'Neutre',
    color: '#94a3b8',
    bg: 'rgba(148,163,184,.13)',
    icon: 'fa-equals'
  }
};
function ResultBadge({
  result,
  status
}) {
  if (status === 'open') {
    return /*#__PURE__*/React.createElement("span", {
      className: "badge",
      style: {
        background: 'rgba(37,99,235,.14)',
        color: '#7cb2ff'
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: "fas fa-hourglass-half"
    }), "en cours");
  }
  const s = TRADE_R[result] || {
    label: result || '—',
    color: '#94a3b8',
    bg: 'rgba(148,163,184,.13)',
    icon: 'fa-circle'
  };
  return /*#__PURE__*/React.createElement("span", {
    className: "badge",
    style: {
      background: s.bg,
      color: s.color
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: `fas ${s.icon}`
  }), s.label);
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
      setData(r);
      setErr('');
    } catch (e) {
      setErr(e.message);
    }
  };
  useEffect(() => {
    charger();
    const t = setInterval(charger, 30000);
    return () => clearInterval(t);
  }, []);
  const teinte = {
    VALID: '#34d399',
    WAITING: '#fbbf24',
    INVALID: '#f87171',
    NO_DATA: '#94a3b8'
  };
  const libelle = {
    VALID: 'Valide',
    WAITING: 'En attente',
    INVALID: 'Invalidé',
    NO_DATA: 'Pas de données'
  };
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
  const teinteDir = {
    BUY: '#34d399',
    SELL: '#f87171',
    NEUTRAL: '#94a3b8',
    UNKNOWN: '#fbbf24'
  };
  const surv = data && data.surveillance;
  const statuts = data && data.statuts ? data.statuts : [];
  const age = ms => ms === null || ms === undefined ? '—' : ms < 60000 ? Math.round(ms / 1000) + ' s' : ms < 3600000 ? Math.round(ms / 60000) + ' min' : Math.round(ms / 3600000) + ' h';
  return /*#__PURE__*/React.createElement("div", {
    className: "panel",
    style: {
      padding: '14px 18px',
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      flexWrap: 'wrap',
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-satellite-dish",
    style: {
      color: surv && surv.active ? '#34d399' : '#94a3b8'
    }
  }), /*#__PURE__*/React.createElement("b", {
    style: {
      fontSize: 13.5,
      color: '#fff'
    }
  }, "Statut en direct"), surv && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", {
    className: "badge",
    style: {
      fontSize: 10,
      background: surv.active ? 'rgba(34,211,138,.14)' : 'rgba(148,163,184,.12)',
      color: surv.active ? '#34d399' : 'var(--muted)'
    }
  }, surv.active ? 'surveillance active' : 'surveillance arrêtée'), /*#__PURE__*/React.createElement("span", {
    className: "badge",
    style: {
      fontSize: 10,
      background: 'rgba(96,165,250,.13)',
      color: '#93c5fd'
    }
  }, surv.marches, " march\xE9(s) \xB7 ", surv.strategies, " strat\xE9gie(s) \xB7 toutes les ", surv.intervalleSec, " s"), surv.mode === 'generique' && /*#__PURE__*/React.createElement("span", {
    className: "badge",
    style: {
      fontSize: 10,
      background: 'rgba(245,158,11,.14)',
      color: '#fbbf24'
    },
    title: "Aucune strat\xE9gie coch\xE9e : le moteur juge avec ses r\xE8gles g\xE9n\xE9riques, pas avec une strat\xE9gie."
  }, "mode g\xE9n\xE9rique"))), err && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11.5,
      color: '#f87171'
    }
  }, err), !err && statuts.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11.5,
      color: 'var(--muted)'
    }
  }, "Aucune \xE9valuation enregistr\xE9e pour l'instant. Chaque cycle de surveillance en \xE9crit une \u2014 si cette liste reste vide alors que la surveillance est active, c'est que le moteur n'a pas encore tourn\xE9."), statuts.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      overflowX: 'auto'
    }
  }, /*#__PURE__*/React.createElement("table", {
    style: {
      width: '100%',
      borderCollapse: 'collapse',
      fontSize: 11.5
    }
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", {
    style: {
      color: 'var(--muted)',
      textAlign: 'left'
    }
  }, /*#__PURE__*/React.createElement("th", {
    style: {
      padding: '4px 8px 4px 0'
    }
  }, "March\xE9"), /*#__PURE__*/React.createElement("th", {
    style: {
      padding: '4px 8px'
    }
  }, "Unit\xE9"), /*#__PURE__*/React.createElement("th", {
    style: {
      padding: '4px 8px'
    }
  }, "Strat\xE9gie"), /*#__PURE__*/React.createElement("th", {
    style: {
      padding: '4px 8px'
    },
    title: "Ce que la strat\xE9gie voit : BUY, SELL, NEUTRAL ou UNKNOWN"
  }, "Direction"), /*#__PURE__*/React.createElement("th", {
    style: {
      padding: '4px 8px'
    },
    title: "Ce que le moteur autorise : valid\xE9, en attente, rejet\xE9"
  }, "D\xE9cision"), /*#__PURE__*/React.createElement("th", {
    style: {
      padding: '4px 8px'
    }
  }, "Conditions"), /*#__PURE__*/React.createElement("th", {
    style: {
      padding: '4px 8px'
    }
  }, "Manquantes"), /*#__PURE__*/React.createElement("th", {
    style: {
      padding: '4px 8px'
    }
  }, "\xC2ge"))), /*#__PURE__*/React.createElement("tbody", null, statuts.slice(0, 40).map((s, i) => /*#__PURE__*/React.createElement("tr", {
    key: i,
    style: {
      borderTop: '1px solid rgba(148,163,184,.12)'
    }
  }, /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '5px 8px 5px 0',
      color: '#fff'
    }
  }, s.symbole), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '5px 8px',
      color: 'var(--muted)'
    }
  }, s.timeframe || '—'), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '5px 8px',
      color: 'var(--muted)'
    }
  }, s.strategie, s.version ? ' · v' + s.version : ''), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '5px 8px'
    }
  }, (() => {
    const d = dirDe(s);
    return /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 10,
        fontWeight: 600,
        padding: '2px 7px',
        borderRadius: 4,
        background: teinteDir[d] + '1c',
        color: teinteDir[d],
        border: '1px solid ' + teinteDir[d] + '44'
      }
    }, d === 'BUY' ? 'BUY ↗' : d === 'SELL' ? 'SELL ↘' : d === 'NEUTRAL' ? 'NEUTRAL ·' : 'UNKNOWN ?');
  })()), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '5px 8px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10,
      padding: '2px 7px',
      borderRadius: 999,
      background: (teinte[s.statut] || '#94a3b8') + '22',
      color: teinte[s.statut] || '#94a3b8'
    }
  }, libelle[s.statut] || s.statut)), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '5px 8px',
      color: 'var(--muted)'
    }
  }, s.conditionTotal ? s.conditionRemplies + '/' + s.conditionTotal : '—'), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '5px 8px',
      color: s.obligatoiresManquantes.length ? '#f87171' : 'var(--muted)'
    }
  }, s.obligatoiresManquantes.length ? s.obligatoiresManquantes.join(', ') : '—'), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '5px 8px',
      color: s.frais ? 'var(--muted)' : '#fbbf24'
    }
  }, age(s.ageMs), s.frais ? '' : ' (figé)')))))));
}
function JournalSignauxPanel() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [filtre, setFiltre] = useState('tout');
  const px = p => p === null || p === undefined || !Number.isFinite(Number(p)) ? '—' : Number(p) >= 1000 ? Number(p).toFixed(2) : Number(p).toFixed(5);
  const charger = async () => {
    try {
      const r = await (await api('/journal-signaux?limite=150')).json();
      if (!r.success) throw new Error(r.error || 'lecture impossible');
      setData(r);
      setErr('');
    } catch (e) {
      setErr(e.message);
    }
  };
  useEffect(() => {
    charger();
  }, []);
  const maj = async () => {
    setBusy(true);
    try {
      await api('/journal-signaux/maj', {
        method: 'POST'
      });
      await charger();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const st = data && data.stats;
  const libelle = {
    tp2: 'Objectif 2',
    tp1: 'Objectif 1',
    be: 'Retour entrée (BE)',
    sl: 'Stop touché',
    expire: 'Expiré',
    ouvert: 'En cours'
  };
  const teinte = {
    tp2: '#34d399',
    tp1: '#6ee7b7',
    be: '#fbbf24',
    sl: '#f87171',
    expire: '#94a3b8',
    ouvert: '#60a5fa'
  };
  const liste = (data && data.signaux ? data.signaux : []).filter(s => filtre === 'tout' ? true : filtre === 'clos' ? s.resultat !== 'ouvert' : s.resultat === 'ouvert');
  return /*#__PURE__*/React.createElement("div", {
    className: "panel",
    style: {
      padding: '14px 18px',
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      flexWrap: 'wrap',
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-clipboard-check",
    style: {
      color: '#60a5fa'
    }
  }), /*#__PURE__*/React.createElement("b", {
    style: {
      fontSize: 13.5,
      color: '#fff'
    }
  }, "Signaux suivis automatiquement"), st && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", {
    className: "badge",
    style: {
      fontSize: 10,
      background: 'rgba(96,165,250,.13)',
      color: '#93c5fd'
    }
  }, st.total, " enregistr\xE9(s)"), /*#__PURE__*/React.createElement("span", {
    className: "badge",
    style: {
      fontSize: 10,
      background: 'rgba(148,163,184,.12)',
      color: 'var(--muted)'
    }
  }, st.ouverts, " en cours"), st.tauxReussite !== null && /*#__PURE__*/React.createElement("span", {
    className: "badge",
    style: {
      fontSize: 10,
      background: st.tauxReussite >= 50 ? 'rgba(34,211,138,.14)' : 'rgba(245,158,11,.14)',
      color: st.tauxReussite >= 50 ? '#34d399' : '#fbbf24'
    }
  }, st.tauxReussite, " % de r\xE9ussite"), st.rTotal !== 0 && /*#__PURE__*/React.createElement("span", {
    className: "badge",
    title: st.fraisMoyenR > 0 ? 'Frais déduits de chaque prise.' : 'Aucun frais configuré : total AVANT frais. Au-delà de ' + st.coutCritique + ' R de frais par prise, cet avantage disparaît.',
    style: {
      fontSize: 10,
      background: 'transparent',
      border: '1px solid rgba(148,163,184,.3)',
      color: st.rTotal >= 0 ? '#34d399' : '#f87171'
    }
  }, st.rTotal >= 0 ? '+' : '', st.rTotal, " R cumul\xE9s", st.fraisMoyenR > 0 ? '' : ' (brut)')), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: '1 1 auto'
    }
  }), /*#__PURE__*/React.createElement("select", {
    className: "fld",
    "aria-label": "Filtrer les signaux par r\xE9sultat",
    style: {
      width: 130,
      fontSize: 12
    },
    value: filtre,
    onChange: e => setFiltre(e.target.value)
  }, /*#__PURE__*/React.createElement("option", {
    value: "tout"
  }, "Tous"), /*#__PURE__*/React.createElement("option", {
    value: "clos"
  }, "Tranch\xE9s"), /*#__PURE__*/React.createElement("option", {
    value: "ouvert"
  }, "En cours")), /*#__PURE__*/React.createElement("button", {
    className: "btn ghost sm",
    onClick: maj,
    disabled: busy
  }, busy ? /*#__PURE__*/React.createElement(Spinner, null) : /*#__PURE__*/React.createElement("i", {
    className: "fas fa-rotate"
  }), " Actualiser")), err && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      color: '#fca5a5'
    }
  }, err), st && st.clos > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 14,
      flexWrap: 'wrap',
      fontSize: 12,
      color: 'var(--muted)',
      marginBottom: 10
    }
  }, ['tp2', 'tp1', 'be', 'sl', 'expire'].map(k => /*#__PURE__*/React.createElement("span", {
    key: k,
    style: {
      color: teinte[k]
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-circle",
    style: {
      fontSize: 7,
      marginRight: 5
    }
  }), libelle[k], " : ", st.parResultat[k] || 0))), liste.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      color: 'var(--muted)'
    }
  }, "Aucun signal enregistr\xE9 pour l'instant. Laisse le flux \xAB Direct \xBB tourner : chaque signal retenu est enregistr\xE9 avec ses niveaux, puis son issue est v\xE9rifi\xE9e automatiquement sur les bougies suivantes."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 5
    }
  }, liste.slice(0, 40).map(s => /*#__PURE__*/React.createElement("div", {
    key: s.cle,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 9,
      flexWrap: 'wrap',
      padding: '6px 9px',
      borderRadius: 7,
      background: 'rgba(148,163,184,.04)',
      border: `1px solid ${s.resultat === 'ouvert' ? 'rgba(96,165,250,.22)' : 'rgba(148,163,184,.13)'}`
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "badge",
    style: {
      fontSize: 9,
      background: 'rgba(148,163,184,.12)',
      color: 'var(--muted)'
    }
  }, s.symbol, " ", s.timeframe), /*#__PURE__*/React.createElement("b", {
    style: {
      fontSize: 12,
      color: '#e2e8f0'
    }
  }, (s.strategie || s.nom || '').slice(0, 40)), /*#__PURE__*/React.createElement("span", {
    className: "badge",
    style: {
      fontSize: 9,
      background: 'rgba(148,163,184,.10)',
      color: s.source === 'strategie' ? '#93c5fd' : 'var(--muted)'
    },
    title: s.source === 'strategie' ? 'Signal produit par une stratégie déclarée' : 'Signal générique : motif ou structure, aucune stratégie déclarée'
  }, s.source === 'strategie' ? 'stratégie' : s.source === 'motif' ? 'motif' : s.source === 'structure' ? 'structure' : s.source || 'générique'), /*#__PURE__*/React.createElement("span", {
    className: "badge",
    style: {
      fontSize: 9,
      background: 'transparent',
      border: `1px solid ${s.sens === 'long' ? '#34d399' : '#f87171'}`,
      color: s.sens === 'long' ? '#34d399' : '#f87171'
    }
  }, s.sens === 'long' ? 'ACHAT' : 'VENTE'), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: teinte[s.resultat] || 'var(--muted)',
      fontWeight: 600
    }
  }, libelle[s.resultat] || s.resultat, Number.isFinite(s.r) ? ` · ${s.r >= 0 ? '+' : ''}${s.r} R` : ''), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10.5,
      color: 'var(--dim)'
    }
  }, "entr\xE9e ", px(s.entree), " \xB7 stop ", px(s.stop), " \xB7 obj. ", (s.objectifs || []).map(px).join(' / ')), s.modele && Number.isFinite(s.modele.rAttendu) && /*#__PURE__*/React.createElement("span", {
    className: "badge",
    style: {
      fontSize: 9,
      background: s.modele.rAttendu > 0 ? 'rgba(34,211,138,.12)' : 'rgba(242,84,91,.12)',
      color: s.modele.rAttendu > 0 ? '#34d399' : '#f87171'
    },
    title: `R attendu au moment de l'émission (modèle v${s.modele.version})`
  }, "annonc\xE9 ", s.modele.rAttendu > 0 ? '+' : '', s.modele.rAttendu, " R", Number.isFinite(s.r) ? ` · réel ${s.r > 0 ? '+' : ''}${s.r} R` : ''), s.risque && Number.isFinite(s.risque.taille) && /*#__PURE__*/React.createElement("span", {
    className: "badge",
    style: {
      fontSize: 9,
      background: 'rgba(96,165,250,.12)',
      color: '#93c5fd'
    },
    title: `Taille calculée à l'émission : ${s.risque.risqueMontant} risqués (${s.risque.risquePct} % de ${s.risque.capital})`
  }, +Number(s.risque.taille).toPrecision(4), " unit\xE9(s) \xB7 ", s.risque.risqueMontant, " risqu\xE9s"), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: '1 1 auto'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10.5,
      color: 'var(--dim)'
    }
  }, s.bougiesSuivies ? `${s.bougiesSuivies} bougie(s) suivie(s)` : '', s.atteintTP1 && s.resultat === 'ouvert' ? ' · TP1 déjà touché' : '')))), st && (st.combinaisons || []).length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: 'var(--muted)',
      marginBottom: 6
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-crosshairs",
    style: {
      marginRight: 6
    }
  }), "O\xF9 \xE7a gagne vraiment \u2014 strat\xE9gie \xD7 march\xE9 \xD7 unit\xE9 de temps"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 4
    }
  }, (st.combinaisons || []).filter(c => c.fiable).slice(0, 10).map((c, i) => /*#__PURE__*/React.createElement("div", {
    key: 'c' + i,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      fontSize: 11.5
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      flex: '1 1 260px',
      color: '#e2e8f0'
    }
  }, (c.strategie || '').slice(0, 34), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--dim)'
    }
  }, " \xB7 ", c.symbole, " ", c.timeframe)), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--dim)',
      minWidth: 44,
      textAlign: 'right'
    }
  }, c.total, " tr."), /*#__PURE__*/React.createElement("span", {
    style: {
      color: (c.tauxReussite ?? 0) >= 50 ? '#34d399' : '#fbbf24',
      minWidth: 44,
      textAlign: 'right'
    }
  }, c.tauxReussite === null ? '—' : c.tauxReussite + ' %'), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--dim)',
      minWidth: 56,
      textAlign: 'right'
    }
  }, c.rMoyen > 0 ? '+' : '', c.rMoyen, " R/tr."), /*#__PURE__*/React.createElement("span", {
    style: {
      color: (c.rTotal ?? 0) >= 0 ? '#34d399' : '#f87171',
      minWidth: 64,
      textAlign: 'right'
    }
  }, (c.rTotal ?? 0) >= 0 ? '+' : '', c.rTotal, " R")))), (() => {
    const faibles = (st.combinaisons || []).filter(c => !c.fiable).length;
    return faibles > 0 ? /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 10.5,
        color: 'var(--dim)',
        marginTop: 6
      }
    }, faibles, " autre(s) combinaison(s) masqu\xE9e(s) : moins de 10 trades tranch\xE9s, trop peu pour conclure quoi que ce soit.") : null;
  })()), data && (data.preuves || []).length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: 'var(--muted)',
      marginBottom: 6
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-list-check",
    style: {
      marginRight: 6
    }
  }), "Pourquoi ce signal \u2014 conditions v\xE9rifi\xE9es, nomm\xE9es"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 8
    }
  }, (data.preuves || []).slice(0, 6).map((e, i) => {
    const teinte = e.statut === 'VALID' ? '#34d399' : e.statut === 'INVALID' ? '#f87171' : e.statut === 'NO_DATA' ? '#94a3b8' : '#fbbf24';
    const remplies = (e.preuves || []).filter(p => p.remplie).length;
    return /*#__PURE__*/React.createElement("div", {
      key: 'p' + i,
      style: {
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '8px 10px'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 11.5,
        flexWrap: 'wrap'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        color: '#e2e8f0',
        fontWeight: 600
      }
    }, e.symbole, " ", e.timeframe), /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--dim)'
      }
    }, e.strategie_id, " v", e.version), /*#__PURE__*/React.createElement("span", {
      style: {
        color: teinte
      }
    }, e.statut), e.direction && /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--dim)'
      }
    }, e.direction), /*#__PURE__*/React.createElement("span", {
      style: {
        flex: '1 1 auto'
      }
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--dim)'
      }
    }, remplies, "/", (e.preuves || []).length, " condition(s) remplie(s)")), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'grid',
        gap: 2,
        marginTop: 6
      }
    }, (e.preuves || []).map((c, j) => /*#__PURE__*/React.createElement("div", {
      key: 'c' + j,
      style: {
        display: 'flex',
        gap: 7,
        alignItems: 'baseline',
        fontSize: 11
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        color: c.remplie ? '#34d399' : '#f87171',
        width: 12
      }
    }, c.remplie ? '✓' : '✗'), /*#__PURE__*/React.createElement("span", {
      style: {
        color: c.remplie ? '#cbd5e1' : '#94a3b8',
        flex: '1 1 auto'
      }
    }, c.condition, c.obligatoire && /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 9,
        color: '#fbbf24',
        marginLeft: 6
      }
    }, "obligatoire")), c.detail && /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 10,
        color: 'var(--dim)'
      }
    }, String(c.detail).slice(0, 60))))));
  }))), st && Object.keys(st.parStrategie || {}).length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: 'var(--muted)',
      marginBottom: 6
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-chart-simple",
    style: {
      marginRight: 6
    }
  }), "R\xE9sultats par strat\xE9gie / concept"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 4
    }
  }, Object.entries(st.parStrategie).sort((a, b) => b[1].total - a[1].total).slice(0, 8).map(([nom, v]) => {
    const taux = v.gagnes + v.perdus ? Math.round(v.gagnes / (v.gagnes + v.perdus) * 100) : null;
    return /*#__PURE__*/React.createElement("div", {
      key: nom,
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        fontSize: 11.5
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        flex: '1 1 220px',
        color: '#e2e8f0'
      }
    }, nom.slice(0, 52)), /*#__PURE__*/React.createElement("span", {
      style: {
        color: '#34d399'
      }
    }, v.gagnes, "\u2713"), /*#__PURE__*/React.createElement("span", {
      style: {
        color: '#f87171'
      }
    }, v.perdus, "\u2717"), v.be > 0 && /*#__PURE__*/React.createElement("span", {
      style: {
        color: '#fbbf24'
      }
    }, v.be, " BE"), /*#__PURE__*/React.createElement("span", {
      style: {
        color: (taux ?? 0) >= 50 ? '#34d399' : '#fbbf24',
        minWidth: 44,
        textAlign: 'right'
      }
    }, taux === null ? '—' : taux + ' %'), /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--dim)',
        minWidth: 56,
        textAlign: 'right'
      }
    }, v.r >= 0 ? '+' : '', v.r.toFixed(1), " R"));
  }))));
}

// ── Backtest ────────────────────────────────────────────────────────────
// Le moteur rejoué sur l'historique, avec le MÊME code que le direct. C'est la
// seule réponse honnête à « est-ce que ça gagne ? » : le journal ne dit que ce
// qui s'est passé depuis qu'on l'écoute.
function BacktestPanel() {
  const [marches, setMarches] = useState([]);
  const [tf, setTf] = useState('5m');
  const [cles, setCles] = useState({
    symbol: 'BTCUSDT',
    provider: 'binance'
  });
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
        if (crypto) setCles({
          symbol: crypto.symbol,
          provider: crypto.provider
        });
      } catch (e) {}
    })();
  }, []);
  const lancer = async () => {
    setBusy(true);
    setErr('');
    try {
      const q = `symbol=${encodeURIComponent(cles.symbol)}&tf=${tf}&provider=${encodeURIComponent(cles.provider)}&pas=${pas}&bougies=800&mode=auto`;
      const d = await (await api('/backtest?' + q)).json();
      if (!d.success) throw new Error(d.error || 'backtest impossible');
      setRes(d);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const r2 = x => Number.isFinite(x) ? x.toFixed(2) : '—';
  const bloc = (titre, table) => {
    if (!table || !Object.keys(table).length) return null;
    return /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 12
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12,
        color: 'var(--muted)',
        marginBottom: 6
      }
    }, titre), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'grid',
        gap: 3
      }
    }, Object.entries(table).sort((a, b) => b[1].total - a[1].total).slice(0, 8).map(([k, v]) => /*#__PURE__*/React.createElement("div", {
      key: k,
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        fontSize: 11.5
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        flex: '1 1 200px',
        color: '#e2e8f0'
      }
    }, String(k).slice(0, 46)), /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--dim)',
        minWidth: 52
      }
    }, v.total, " prise(s)"), /*#__PURE__*/React.createElement("span", {
      style: {
        color: '#34d399'
      }
    }, v.gagnes, "\u2713"), /*#__PURE__*/React.createElement("span", {
      style: {
        color: '#f87171'
      }
    }, v.perdus, "\u2717"), /*#__PURE__*/React.createElement("span", {
      style: {
        color: '#fbbf24',
        minWidth: 30
      }
    }, v.be, "BE"), /*#__PURE__*/React.createElement("span", {
      style: {
        color: (v.tauxReussite ?? 0) >= 50 ? '#34d399' : '#fbbf24',
        minWidth: 48,
        textAlign: 'right'
      }
    }, v.tauxReussite === null ? '—' : v.tauxReussite + ' %'), /*#__PURE__*/React.createElement("span", {
      style: {
        color: v.r >= 0 ? '#34d399' : '#f87171',
        minWidth: 60,
        textAlign: 'right'
      }
    }, v.r >= 0 ? '+' : '', r2(v.r), " R")))));
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "panel",
    style: {
      padding: '14px 18px',
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      flexWrap: 'wrap',
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-flask",
    style: {
      color: '#a78bfa'
    }
  }), /*#__PURE__*/React.createElement("b", {
    style: {
      fontSize: 13.5,
      color: '#fff'
    }
  }, "Backtest \u2014 le moteur rejou\xE9 sur l'historique"), /*#__PURE__*/React.createElement("span", {
    className: "badge",
    style: {
      fontSize: 10,
      background: 'rgba(167,139,250,.14)',
      color: '#c4b5fd'
    }
  }, "co\xFBt IA : 0")), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '0 0 12px',
      fontSize: 12.5,
      color: 'var(--muted)'
    }
  }, "Chaque bougie est jug\xE9e avec le pass\xE9 seulement, puis le signal est suivi jusqu'\xE0 son objectif, son invalidation ou son retour \xE0 l'entr\xE9e. M\xEAme code que le direct."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 9,
      alignItems: 'center',
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("select", {
    className: "fld",
    "aria-label": "March\xE9 du backtest",
    style: {
      width: 'auto',
      maxWidth: '100%',
      fontSize: 12
    },
    value: `${cles.provider}|${cles.symbol}`,
    onChange: e => {
      const [provider, symbol] = e.target.value.split('|');
      setCles({
        provider,
        symbol
      });
    }
  }, (marches.length ? marches : [{
    symbol: 'BTCUSDT',
    provider: 'binance',
    label: 'BTC / USD',
    providerLabel: 'Binance'
  }]).map(m => /*#__PURE__*/React.createElement("option", {
    key: `${m.provider}|${m.symbol}`,
    value: `${m.provider}|${m.symbol}`
  }, m.providerLabel ? `${m.providerLabel} · ` : '', m.label || m.symbol))), /*#__PURE__*/React.createElement("select", {
    className: "fld",
    "aria-label": "Unit\xE9 de temps du backtest",
    style: {
      width: 90,
      fontSize: 12
    },
    value: tf,
    onChange: e => setTf(e.target.value)
  }, ['1m', '5m', '15m', '30m', '1h', '4h', '1d'].map(t => /*#__PURE__*/React.createElement("option", {
    key: t,
    value: t
  }, t))), /*#__PURE__*/React.createElement("select", {
    className: "fld",
    "aria-label": "Pas d'\xE9valuation",
    style: {
      width: 150,
      fontSize: 12
    },
    value: pas,
    onChange: e => setPas(Number(e.target.value))
  }, /*#__PURE__*/React.createElement("option", {
    value: 1
  }, "pas 1 (pr\xE9cis, lent)"), /*#__PURE__*/React.createElement("option", {
    value: 2
  }, "pas 2 (recommand\xE9)"), /*#__PURE__*/React.createElement("option", {
    value: 3
  }, "pas 3 (rapide)")), /*#__PURE__*/React.createElement("button", {
    className: "btn sm",
    onClick: lancer,
    disabled: busy
  }, busy ? /*#__PURE__*/React.createElement(Spinner, null) : /*#__PURE__*/React.createElement("i", {
    className: "fas fa-play"
  }), " Lancer le backtest"), res && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11.5,
      color: 'var(--dim)'
    }
  }, res.bougies, " bougies \xB7 ", res.evaluations, " \xE9valuations \xB7 ", res.ignoresDoublons, " doublon(s) \xE9vit\xE9(s)", Number.isFinite(res.types) && ` · ${res.types} type(s) de configuration`, Number.isFinite(res.concentrationTop3) && ` · top 3 = ${res.concentrationTop3} % des prises`)), res && res.fiable === false && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 10,
      fontSize: 12,
      color: '#fbbf24',
      padding: '8px 10px',
      borderRadius: 8,
      background: 'rgba(245,158,11,.08)',
      border: '1px solid rgba(245,158,11,.25)'
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-triangle-exclamation",
    style: {
      marginRight: 7
    }
  }), /*#__PURE__*/React.createElement("b", null, "\xC9chantillon trop court pour conclure."), " ", res.bougies, " bougies", res.demandees ? ` (${res.demandees} demandées, le courtier en a rendu ${res.bougies})` : '', Number.isFinite(res.types) ? ` · ${res.types} type(s) de configuration` : '', " \u2014 les chiffres ci-dessous d\xE9crivent ces bougies, pas le march\xE9. Choisis une unit\xE9 de temps plus grande ou un historique plus long."), err && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 10,
      fontSize: 12.5,
      color: '#fca5a5'
    }
  }, err), res && res.indisponible && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 10,
      fontSize: 12.5,
      color: 'var(--muted)'
    }
  }, res.raison), res && !res.indisponible && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 22,
      flexWrap: 'wrap',
      marginTop: 14,
      fontSize: 13
    }
  }, /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--muted)'
    }
  }, "Prises "), /*#__PURE__*/React.createElement("b", null, res.clos)), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--muted)'
    }
  }, "Objectifs "), /*#__PURE__*/React.createElement("b", {
    style: {
      color: '#34d399'
    }
  }, res.gagnes)), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--muted)'
    }
  }, "Stops "), /*#__PURE__*/React.createElement("b", {
    style: {
      color: '#f87171'
    }
  }, res.perdus)), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--muted)'
    }
  }, "BE "), /*#__PURE__*/React.createElement("b", {
    style: {
      color: '#fbbf24'
    }
  }, res.be)), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--muted)'
    }
  }, "R\xE9ussite "), /*#__PURE__*/React.createElement("b", {
    style: {
      color: (res.tauxReussite ?? 0) >= 50 ? '#34d399' : '#fbbf24'
    }
  }, res.tauxReussite === null ? '—' : res.tauxReussite + ' %')), /*#__PURE__*/React.createElement("span", {
    title: fraisActifs ? 'Gain/perte moyen par prise, frais déduits.' : 'Gain/perte moyen par prise AVANT frais : aucun frais n’est configuré.'
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--muted)'
    }
  }, fraisActifs ? 'Espérance nette ' : 'Espérance BRUTE '), /*#__PURE__*/React.createElement("b", {
    style: {
      color: res.esperance >= 0 ? '#34d399' : '#f87171'
    }
  }, res.esperance >= 0 ? '+' : '', r2(res.esperance), " R")), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--muted)'
    }
  }, fraisActifs ? 'Total ' : 'Total brut '), /*#__PURE__*/React.createElement("b", {
    style: {
      color: res.rTotal >= 0 ? '#34d399' : '#f87171'
    }
  }, res.rTotal >= 0 ? '+' : '', r2(res.rTotal), " R")), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--dim)'
    }
  }, res.enCours, " encore en cours (exclues)")), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 9,
      fontSize: 12,
      lineHeight: 1.5,
      color: fraisActifs ? 'var(--muted)' : '#fbbf24'
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: `fas ${fraisActifs ? 'fa-receipt' : 'fa-triangle-exclamation'}`,
    style: {
      marginRight: 6
    }
  }), fraisActifs ? /*#__PURE__*/React.createElement(React.Fragment, null, "Frais appliqu\xE9s : ", /*#__PURE__*/React.createElement("b", null, r2(res.fraisMoyenR), " R"), " par prise. Les chiffres ci-dessus sont nets.") : /*#__PURE__*/React.createElement(React.Fragment, null, "Aucun frais n\u2019est configur\xE9 : les chiffres ci-dessus sont ", /*#__PURE__*/React.createElement("b", null, "BRUTS"), ". Cet avantage survit tant que le co\xFBt r\xE9el reste sous", ' ', /*#__PURE__*/React.createElement("b", null, r2(res.coutCritique), " R"), " par prise \u2014 au-del\xE0, il dispara\xEEt.")), res.instrument && res.instrument.synthetique && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 8,
      fontSize: 11.5,
      padding: '8px 10px',
      borderRadius: 7,
      background: 'rgba(239,68,68,.08)',
      border: '1px solid rgba(239,68,68,.35)',
      color: '#fca5a5'
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-dice",
    style: {
      marginRight: 7
    }
  }), /*#__PURE__*/React.createElement("b", null, "Instrument synth\xE9tique."), " ", res.instrument.avertissement), Number.isFinite(res.beTheorique) && res.beTheorique !== 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 8,
      fontSize: 11.5,
      padding: '7px 10px',
      borderRadius: 7,
      background: 'rgba(148,163,184,.06)',
      border: '1px solid rgba(148,163,184,.2)',
      color: 'var(--dim)'
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-scale-unbalanced",
    style: {
      marginRight: 7
    }
  }), res.gestionPartielle ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("b", null, "Gestion partielle activ\xE9e."), " Un BE (objectif 1 touch\xE9 puis retour \xE0 l'entr\xE9e) est cr\xE9dit\xE9 de la moiti\xE9 du premier objectif : ", /*#__PURE__*/React.createElement("b", null, "+", r2(res.beSomme), " R"), " sur", ' ', res.be || 0, " trade(s). Sans cette hypoth\xE8se : ", /*#__PURE__*/React.createElement("b", null, r2(res.rTotalSansGestion), " R"), ".") : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("b", null, "Gestion partielle d\xE9sactiv\xE9e"), " \u2014 un BE vaut 0 R. Si on cr\xE9ditait la moiti\xE9 du premier objectif, le total passerait \xE0 ", /*#__PURE__*/React.createElement("b", null, r2(res.rTotal + res.beTheorique), " R"), ' ', "(soit +", r2(res.beTheorique), " R d'hypoth\xE8se). Ce n'est pas une mesure : aucune sortie partielle n'est simul\xE9e dans les frais.")), res.courbeR && res.courbeR.length > 1 && (() => {
    const max = Math.max(...res.courbeR.map(Math.abs), 1);
    const pts = res.courbeR;
    const pasE = Math.max(1, Math.floor(pts.length / 60));
    return /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 12
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12,
        color: 'var(--muted)',
        marginBottom: 5
      }
    }, "Capital cumul\xE9 en R"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'flex-end',
        gap: 1,
        height: 44,
        padding: '0 2px',
        background: 'rgba(148,163,184,.05)',
        borderRadius: 6
      }
    }, pts.filter((_, i) => i % pasE === 0 || i === pts.length - 1).map((v, i) => /*#__PURE__*/React.createElement("span", {
      key: i,
      title: `${v} R`,
      style: {
        flex: '1 1 auto',
        minWidth: 1,
        height: `${Math.max(2, Math.abs(v) / max * 100)}%`,
        background: v >= 0 ? 'rgba(52,211,153,.75)' : 'rgba(248,113,113,.75)',
        alignSelf: v >= 0 ? 'flex-end' : 'flex-start'
      }
    }))), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        fontSize: 10.5,
        color: 'var(--dim)',
        marginTop: 3
      }
    }, /*#__PURE__*/React.createElement("span", null, "d\xE9but"), /*#__PURE__*/React.createElement("span", null, r2(res.courbeR[res.courbeR.length - 1]), " R"), /*#__PURE__*/React.createElement("span", null, "fin")));
  })(), bloc('Par source', res.parSource), bloc('Par stratégie / concept', res.parStrategie), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 10,
      fontSize: 11,
      color: 'var(--dim)',
      lineHeight: 1.6
    }
  }, "Une prise = un signal retenu au moment de son \xE9mission. Les signaux encore ouverts \xE0 la fin de l'historique sont exclus du taux. Le taux ne compte que les objectifs atteints face aux stops : les BE et les expirations sont affich\xE9s \xE0 part.")));
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
    } catch (e) {/* sans cache, les badges restent absents — rien d'inventé */}
  };
  useEffect(() => {
    chargerImpactCache();
  }, []);
  const normTitre = t => String(t || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const impactDe = a => impacts[normTitre(a.titre)] || null;
  const interpreterImpact = async () => {
    const liste = (data && data.articles || []).slice(0, 12).map(a => ({
      titre: a.titre,
      resume: a.resume,
      source: a.source,
      sourceId: a.sourceId,
      actifs: a.actifs
    }));
    if (!liste.length) return;
    setBusyImpact(true);
    setErr('');
    try {
      const d = await (await api('/news/impact', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          articles: liste
        })
      })).json();
      if (!d.success) throw new Error(d.error || 'interprétation impossible');
      if (d.parTitre) setImpacts(d.parTitre);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusyImpact(false);
    }
  };
  const charger = async (force = false) => {
    setBusy(true);
    setErr('');
    try {
      const q = `?marche=${marche}&impact=${impact}${force ? '&force=1' : ''}`;
      const d = await (await api('/news/panorama' + q)).json();
      if (!d.success) throw new Error(d.error || 'flux indisponible');
      setData(d);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    charger();
  }, [marche, impact]);
  const ilYA = ts => {
    if (!Number.isFinite(ts)) return '';
    const m = Math.round((Date.now() - ts) / 60000);
    if (m < 1) return "à l'instant";
    if (m < 60) return `il y a ${m} min`;
    const h = Math.round(m / 60);
    if (h < 24) return `il y a ${h} h`;
    return `il y a ${Math.round(h / 24)} j`;
  };
  const heure = ts => Number.isFinite(ts) ? new Date(ts).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit'
  }) : '—';
  const jourLisible = j => {
    const d = new Date(j + 'T12:00:00');
    const auj = new Date().toISOString().slice(0, 10);
    if (j === auj) return "Aujourd'hui";
    const demain = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    if (j === demain) return 'Demain';
    return d.toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'short'
    });
  };
  const teinteImpact = n => n === 3 ? '#f87171' : n === 2 ? '#fbbf24' : '#94a3b8';
  const articles = data && data.articles || [];
  const jours = data && data.calendrier || [];
  const prochaines = data && data.prochaines24h || [];
  const elevees = prochaines.filter(e => e.impactNiveau >= 3);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "panel",
    style: {
      padding: '14px 18px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-newspaper",
    style: {
      color: '#60a5fa'
    }
  }), /*#__PURE__*/React.createElement("b", {
    style: {
      fontSize: 13.5,
      color: '#fff'
    }
  }, "Actualit\xE9s et calendrier \xE9conomique"), /*#__PURE__*/React.createElement("span", {
    className: "badge",
    style: {
      fontSize: 10,
      background: 'rgba(52,211,153,.14)',
      color: '#34d399'
    },
    title: "Flux RSS publics et calendrier ForexFactory : aucune cl\xE9, aucun abonnement."
  }, "sources gratuites"), data && data.etat && data.etat.fluxAt && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: 'var(--dim)'
    }
  }, "d\xE9p\xEAches ", ilYA(data.etat.fluxAt)), data && data.etat && data.etat.degrade && /*#__PURE__*/React.createElement("span", {
    className: "badge",
    style: {
      fontSize: 10,
      background: 'rgba(245,158,11,.14)',
      color: '#fbbf24'
    }
  }, "flux partiel \u2014 dernier \xE9tat conserv\xE9"), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: '1 1 auto'
    }
  }), /*#__PURE__*/React.createElement("button", {
    className: "btn ghost sm",
    onClick: interpreterImpact,
    disabled: busyImpact || !articles.length,
    title: "Chaque d\xE9p\xEAche re\xE7oit un sens exploitable (ACHAT / VENTE / NEUTRE) et sa raison. Calcul\xE9 une seule fois puis m\xE9moris\xE9."
  }, busyImpact ? /*#__PURE__*/React.createElement(Spinner, null) : /*#__PURE__*/React.createElement("i", {
    className: "fas fa-wand-magic-sparkles"
  }), busyImpact ? 'Interprétation…' : 'Interpréter l\'impact'), /*#__PURE__*/React.createElement("button", {
    className: "btn ghost sm",
    onClick: () => charger(true),
    disabled: busy
  }, busy ? /*#__PURE__*/React.createElement(Spinner, null) : /*#__PURE__*/React.createElement("i", {
    className: "fas fa-rotate"
  }), " Actualiser")), prochaines.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 11,
      padding: '9px 12px',
      borderRadius: 9,
      background: elevees.length ? 'rgba(248,113,113,.08)' : 'rgba(148,163,184,.06)',
      border: `1px solid ${elevees.length ? 'rgba(248,113,113,.35)' : 'rgba(148,163,184,.16)'}`
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      color: elevees.length ? '#fca5a5' : 'var(--muted)'
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-triangle-exclamation",
    style: {
      marginRight: 7
    }
  }), /*#__PURE__*/React.createElement("b", null, "Dans les 24 h :"), " ", prochaines.length, " annonce(s)", elevees.length > 0 && /*#__PURE__*/React.createElement(React.Fragment, null, " dont ", /*#__PURE__*/React.createElement("b", {
    style: {
      color: '#f87171'
    }
  }, elevees.length, " \xE0 impact \xE9lev\xE9"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 12,
      flexWrap: 'wrap',
      marginTop: 5,
      fontSize: 11.5
    }
  }, prochaines.slice(0, 5).map((e, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    style: {
      color: 'var(--muted)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: teinteImpact(e.impactNiveau)
    }
  }, "\u25CF"), ' ', heure(e.date), " \xB7 ", e.devise || e.pays || '—', " \xB7 ", e.titre.slice(0, 44))))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      flexWrap: 'wrap',
      marginTop: 11
    }
  }, [['tout', 'Tout'], ['crypto', 'Crypto'], ['forex', 'Forex'], ['macro', 'Macro']].map(([id, label]) => /*#__PURE__*/React.createElement("button", {
    key: id,
    className: "btn ghost sm",
    onClick: () => setMarche(id),
    style: {
      borderColor: marche === id ? 'rgba(96,165,250,.55)' : undefined,
      color: marche === id ? '#93c5fd' : undefined
    }
  }, label)), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 1,
      background: 'rgba(148,163,184,.2)',
      margin: '0 4px'
    }
  }), [[0, 'Tout impact'], [2, 'Moyen et +'], [3, 'Élevé']].map(([n, label]) => /*#__PURE__*/React.createElement("button", {
    key: n,
    className: "btn ghost sm",
    onClick: () => setImpact(n),
    style: {
      borderColor: impact === n ? 'rgba(245,158,11,.55)' : undefined,
      color: impact === n ? '#fbbf24' : undefined
    }
  }, label))), err && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 10,
      fontSize: 12.5,
      color: '#fca5a5'
    }
  }, err)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 16,
      gridTemplateColumns: 'repeat(auto-fit,minmax(340px,1fr))'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "panel",
    style: {
      padding: '14px 18px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-rss",
    style: {
      color: '#f59e0b'
    }
  }), /*#__PURE__*/React.createElement("b", {
    style: {
      fontSize: 13,
      color: '#fff'
    }
  }, "D\xE9p\xEAches (", articles.length, ")")), articles.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      color: 'var(--muted)'
    }
  }, "Aucune d\xE9p\xEAche pour ce filtre. Les flux publics r\xE9pondent parfois lentement : r\xE9essaie dans un instant."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 7,
      maxHeight: 620,
      overflowY: 'auto'
    }
  }, articles.map((a, i) => /*#__PURE__*/React.createElement("a", {
    key: i,
    href: a.lien,
    target: "_blank",
    rel: "noopener noreferrer",
    style: {
      display: 'block',
      padding: '8px 10px',
      borderRadius: 8,
      textDecoration: 'none',
      background: 'rgba(148,163,184,.04)',
      border: '1px solid rgba(148,163,184,.12)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 7,
      flexWrap: 'wrap',
      marginBottom: 3
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "badge",
    style: {
      fontSize: 9,
      background: 'rgba(148,163,184,.14)',
      color: 'var(--muted)'
    }
  }, a.source), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10.5,
      color: 'var(--dim)'
    }
  }, ilYA(a.date)), a.impact && /*#__PURE__*/React.createElement("span", {
    className: "badge",
    style: {
      fontSize: 9,
      background: 'rgba(245,158,11,.14)',
      color: '#fbbf24'
    },
    title: "Le texte contient un mot-cl\xE9 \xE0 fort retentissement (CPI, FOMC, hack, ETF\u2026)"
  }, "\xE0 impact"), (a.actifs || []).map(x => /*#__PURE__*/React.createElement("span", {
    key: x,
    className: "tag",
    style: {
      fontSize: 9
    }
  }, x)), (() => {
    const im = impactDe(a);
    if (!im) return null;
    const col = im.sens === 'ACHAT' ? '#34d399' : im.sens === 'VENTE' ? '#f87171' : '#94a3b8';
    const bg = im.sens === 'ACHAT' ? 'rgba(34,211,138,.16)' : im.sens === 'VENTE' ? 'rgba(242,84,91,.16)' : 'rgba(148,163,184,.14)';
    const ico = im.sens === 'ACHAT' ? 'fa-arrow-trend-up' : im.sens === 'VENTE' ? 'fa-arrow-trend-down' : 'fa-minus';
    return /*#__PURE__*/React.createElement("span", {
      className: "badge",
      style: {
        fontSize: 9.5,
        background: bg,
        color: col
      },
      title: `${im.raison || 'impact estimé'}${im.force != null ? ` · force ${im.force}/1` : ''}`
    }, /*#__PURE__*/React.createElement("i", {
      className: `fas ${ico}`,
      style: {
        fontSize: 8
      }
    }), im.sens);
  })()), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      color: '#e2e8f0',
      lineHeight: 1.45
    }
  }, a.titre))))), /*#__PURE__*/React.createElement("div", {
    className: "panel",
    style: {
      padding: '14px 18px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-calendar-day",
    style: {
      color: '#a78bfa'
    }
  }), /*#__PURE__*/React.createElement("b", {
    style: {
      fontSize: 13,
      color: '#fff'
    }
  }, "Calendrier \xE9conomique"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10.5,
      color: 'var(--dim)'
    }
  }, "heures locales")), jours.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      color: 'var(--muted)'
    }
  }, "Calendrier indisponible pour l'instant : la source publique limite les requ\xEAtes (HTTP 429). L'app r\xE9essaiera automatiquement, sans te bloquer.", data && data.etat && data.etat.erreurs && data.etat.erreurs.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 6,
      fontSize: 11.5,
      color: 'var(--dim)'
    }
  }, "d\xE9tail : ", data.etat.erreurs.join(' · '))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 12,
      maxHeight: 620,
      overflowY: 'auto'
    }
  }, jours.map(j => /*#__PURE__*/React.createElement("div", {
    key: j.jour
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11.5,
      color: 'var(--muted)',
      textTransform: 'capitalize',
      marginBottom: 5
    }
  }, jourLisible(j.jour)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 4
    }
  }, j.evenements.map((e, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      flexWrap: 'wrap',
      fontSize: 11.5,
      padding: '4px 7px',
      borderRadius: 6,
      background: e.impactNiveau >= 3 ? 'rgba(248,113,113,.06)' : 'transparent'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--dim)',
      minWidth: 42
    }
  }, heure(e.date)), /*#__PURE__*/React.createElement("span", {
    style: {
      color: teinteImpact(e.impactNiveau),
      minWidth: 8
    }
  }, "\u25CF"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--muted)',
      minWidth: 34
    }
  }, e.devise || e.pays || '—'), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: '1 1 140px',
      color: '#e2e8f0'
    }
  }, e.titre), e.reel && /*#__PURE__*/React.createElement("span", {
    style: {
      color: '#34d399'
    }
  }, "r\xE9el ", e.reel), !e.reel && e.prevision && /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--dim)'
    }
  }, "pr\xE9v. ", e.prevision), e.precedent && /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--dim)'
    }
  }, "pr\xE9c. ", e.precedent))))))))));
}
function Journal({
  prefill,
  onPrefillUsed,
  strategies = []
}) {
  const [trades, setTrades] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    pair: '',
    direction: 'BUY',
    entry: '',
    sl: '',
    tp: '',
    size: '',
    notes: ''
  });
  const [closing, setClosing] = useState({});
  const [picked, setPicked] = useState([]); // stratégies liées au trade
  const [originId, setOriginId] = useState(null); // analyse d'origine
  const [filter, setFilter] = useState({
    q: '',
    result: 'all'
  });
  // Contexte de marché attaché au trade : d'où vient le prix, sur quelle unité
  // de temps, et quel signal était en cours. Sans ça, les statistiques ne
  // peuvent pas dire sur QUEL marché on gagne.
  const [market, setMarket] = useState({
    timeframe: '',
    provider: '',
    providerLabel: '',
    signalStatus: '',
    signalStrength: null
  });

  // Une seule façon de dessiner une ligne de statistique : barre de réussite,
  // compte et PnL. Évite que chaque tableau réinvente la sienne.
  const StatRow = ({
    s
  }) => /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      flex: '1 1 220px',
      fontSize: 13,
      color: '#fff'
    }
  }, s.label), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 160,
      height: 8,
      background: 'rgba(148,163,184,.18)',
      borderRadius: 99,
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'block',
      height: '100%',
      width: `${s.winRate || 0}%`,
      background: (s.winRate || 0) >= 50 ? '#10b981' : '#f59e0b'
    }
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12.5,
      color: 'var(--muted)',
      minWidth: 150,
      textAlign: 'right'
    }
  }, s.wins, "/", s.trades, " \xB7 ", s.winRate === null ? '—' : s.winRate + ' %', s.pnl ? /*#__PURE__*/React.createElement(React.Fragment, null, " \xB7 PnL ", n6(s.pnl)) : null));

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
    setFilter({
      q: '',
      result: 'all'
    });
    setErr('');
    if (onPrefillUsed) onPrefillUsed();
  }, [prefill]);
  const load = async () => {
    try {
      const r = await api('/trades');
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Chargement impossible');
      setTrades(d.trades || []);
      setStats(d.stats || null);
      setErr('');
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, []);
  const create = async e => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const r = await api('/trades', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ...form,
          strategyIds: picked,
          originAnalysisId: originId,
          timeframe: market.timeframe,
          provider: market.provider,
          providerLabel: market.providerLabel,
          signalStatus: market.signalStatus,
          signalStrength: market.signalStrength
        })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Création refusée');
      setForm({
        pair: '',
        direction: 'BUY',
        entry: '',
        sl: '',
        tp: '',
        size: '',
        notes: ''
      });
      setPicked([]);
      setOriginId(null);
      setMarket({
        timeframe: '',
        provider: '',
        providerLabel: '',
        signalStatus: '',
        signalStrength: null
      });
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const doClose = async id => {
    const c = closing[id] || {};
    if (c.exit === undefined || c.exit === '') {
      setErr('Renseigne le prix de sortie pour clôturer');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const payload = {
        action: 'close',
        exit: c.exit
      };
      if (c.pnl !== undefined && c.pnl !== '') payload.pnl = c.pnl;
      const r = await api(`/trades/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Clôture refusée');
      setClosing(s => {
        const n = {
          ...s
        };
        delete n[id];
        return n;
      });
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const del = async id => {
    await api(`/trades/${id}`, {
      method: 'DELETE'
    });
    load();
  };
  const n2 = v => v === null || v === undefined ? '—' : Number(v).toFixed(2);
  const n6 = v => v === null || v === undefined ? '—' : Number(v).toFixed(v % 1 === 0 ? 0 : 4);

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
  if (loading) return /*#__PURE__*/React.createElement("div", {
    className: "panel",
    style: {
      padding: 22
    }
  }, /*#__PURE__*/React.createElement(Skeleton, {
    h: 120
  }));
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(StatutDirectPanel, null), /*#__PURE__*/React.createElement(JournalSignauxPanel, null), /*#__PURE__*/React.createElement(BacktestPanel, null), /*#__PURE__*/React.createElement("div", {
    className: "stat-grid",
    style: {
      marginBottom: 18
    }
  }, /*#__PURE__*/React.createElement(StatTile, {
    icon: "fa-receipt",
    label: "Trades enregistr\xE9s",
    value: stats?.total || 0,
    color: "#60a5fa",
    delay: 0
  }), /*#__PURE__*/React.createElement(StatTile, {
    icon: "fa-bullseye",
    label: "Taux de r\xE9ussite",
    value: stats?.winRate ?? 0,
    decimals: 1,
    suffix: " %",
    color: "#34d399",
    delay: 70
  }), /*#__PURE__*/React.createElement(StatTile, {
    icon: "fa-scale-balanced",
    label: "PnL cumul\xE9",
    value: stats?.pnlTotal ?? 0,
    decimals: 2,
    color: "#f59e0b",
    delay: 140
  }), /*#__PURE__*/React.createElement(StatTile, {
    icon: "fa-wave-square",
    label: "RR moyen",
    value: stats?.rrAvg ?? 0,
    decimals: 2,
    color: "var(--accent2)",
    delay: 210
  })), stats && (stats.wins > 0 || stats.losses > 0) && /*#__PURE__*/React.createElement("div", {
    className: "panel",
    style: {
      padding: '14px 18px',
      marginBottom: 16,
      display: 'flex',
      flexWrap: 'wrap',
      gap: 18,
      alignItems: 'center',
      fontSize: 13
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: '#34d399'
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-check",
    style: {
      marginRight: 6
    }
  }), stats.wins, " gain(s)"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: '#ef4444'
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-xmark",
    style: {
      marginRight: 6
    }
  }), stats.losses, " perte(s)"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--muted)'
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-equals",
    style: {
      marginRight: 6
    }
  }), stats.breakeven, " neutre(s)"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--muted)'
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-layer-group",
    style: {
      marginRight: 6
    }
  }), stats.open, " en cours"), stats.streak && /*#__PURE__*/React.createElement("span", {
    style: {
      color: stats.streak.type === 'win' ? '#34d399' : '#ef4444'
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-fire",
    style: {
      marginRight: 6
    }
  }), "s\xE9rie : ", stats.streak.count, " ", stats.streak.type === 'win' ? 'gain(s)' : 'perte(s)')), /*#__PURE__*/React.createElement("div", {
    className: "panel",
    style: {
      padding: '12px 14px',
      marginBottom: 16,
      display: 'flex',
      gap: 10,
      alignItems: 'center',
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-filter",
    style: {
      color: 'var(--muted)'
    }
  }), /*#__PURE__*/React.createElement("input", {
    className: "fld",
    style: {
      flex: '1 1 190px',
      minWidth: 150
    },
    placeholder: "Filtrer par paire ou note\u2026",
    value: filter.q,
    onChange: e => setFilter({
      ...filter,
      q: e.target.value
    })
  }), /*#__PURE__*/React.createElement("select", {
    className: "fld",
    "aria-label": "Filtrer les trades par r\xE9sultat",
    style: {
      width: 150
    },
    value: filter.result,
    onChange: e => setFilter({
      ...filter,
      result: e.target.value
    })
  }, /*#__PURE__*/React.createElement("option", {
    value: "all"
  }, "Tous"), /*#__PURE__*/React.createElement("option", {
    value: "open"
  }, "En cours"), /*#__PURE__*/React.createElement("option", {
    value: "win"
  }, "Gains"), /*#__PURE__*/React.createElement("option", {
    value: "loss"
  }, "Pertes"), /*#__PURE__*/React.createElement("option", {
    value: "breakeven"
  }, "Neutres")), filtered && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12.5,
      color: 'var(--muted)'
    }
  }, open.length + closed.length, " / ", trades.length), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: '1 1 auto'
    }
  }), /*#__PURE__*/React.createElement("a", {
    className: "btn ghost sm",
    href: "/api/trades/export?format=csv",
    download: true,
    title: "T\xE9l\xE9charger le journal complet en CSV (Excel)"
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-file-csv"
  }), "CSV"), /*#__PURE__*/React.createElement("a", {
    className: "btn ghost sm",
    href: "/api/trades/export?format=json",
    download: true,
    title: "T\xE9l\xE9charger le journal complet en JSON"
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-file-code"
  }), "JSON")), err && /*#__PURE__*/React.createElement("div", {
    className: "panel",
    style: {
      padding: '12px 16px',
      marginBottom: 16,
      borderColor: 'rgba(239,68,68,.45)',
      color: '#fca5a5',
      fontSize: 13
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-triangle-exclamation",
    style: {
      marginRight: 8
    }
  }), err), /*#__PURE__*/React.createElement("div", {
    className: "panel",
    style: {
      padding: 20,
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: '0 0 4px',
      fontSize: 15
    }
  }, "Nouveau trade"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '0 0 14px',
      color: 'var(--muted)',
      fontSize: 12.5
    }
  }, "Enregistre ce que tu prends r\xE9ellement. Le r\xE9sultat est d\xE9duit du prix de sortie."), /*#__PURE__*/React.createElement("form", {
    onSubmit: create,
    style: {
      display: 'grid',
      gap: 12,
      gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))'
    }
  }, /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'grid',
      gap: 5,
      fontSize: 12,
      color: 'var(--muted)'
    }
  }, "Paire", /*#__PURE__*/React.createElement("input", {
    className: "fld",
    value: form.pair,
    placeholder: "XAUUSD",
    onChange: e => setForm({
      ...form,
      pair: e.target.value.toUpperCase()
    })
  })), /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'grid',
      gap: 5,
      fontSize: 12,
      color: 'var(--muted)'
    }
  }, "Sens", /*#__PURE__*/React.createElement("select", {
    className: "fld",
    "aria-label": "Direction du trade",
    value: form.direction,
    onChange: e => setForm({
      ...form,
      direction: e.target.value
    })
  }, /*#__PURE__*/React.createElement("option", {
    value: "BUY"
  }, "BUY"), /*#__PURE__*/React.createElement("option", {
    value: "SELL"
  }, "SELL"))), /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'grid',
      gap: 5,
      fontSize: 12,
      color: 'var(--muted)'
    }
  }, "Entr\xE9e", /*#__PURE__*/React.createElement("input", {
    className: "fld",
    inputMode: "decimal",
    value: form.entry,
    placeholder: "4700",
    onChange: e => setForm({
      ...form,
      entry: e.target.value
    })
  })), /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'grid',
      gap: 5,
      fontSize: 12,
      color: 'var(--muted)'
    }
  }, "Stop loss", /*#__PURE__*/React.createElement("input", {
    className: "fld",
    inputMode: "decimal",
    value: form.sl,
    placeholder: "4690",
    onChange: e => setForm({
      ...form,
      sl: e.target.value
    })
  })), /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'grid',
      gap: 5,
      fontSize: 12,
      color: 'var(--muted)'
    }
  }, "Take profit", /*#__PURE__*/React.createElement("input", {
    className: "fld",
    inputMode: "decimal",
    value: form.tp,
    placeholder: "4720",
    onChange: e => setForm({
      ...form,
      tp: e.target.value
    })
  })), /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'grid',
      gap: 5,
      fontSize: 12,
      color: 'var(--muted)'
    }
  }, "Taille", /*#__PURE__*/React.createElement("input", {
    className: "fld",
    inputMode: "decimal",
    value: form.size,
    placeholder: "0.5",
    onChange: e => setForm({
      ...form,
      size: e.target.value
    })
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-end'
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn",
    type: "submit",
    disabled: busy,
    style: {
      width: '100%'
    }
  }, busy ? /*#__PURE__*/React.createElement(Spinner, null) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-plus"
  }), "Enregistrer")))), /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'grid',
      gap: 5,
      fontSize: 12,
      color: 'var(--muted)',
      marginTop: 12
    }
  }, "Notes", /*#__PURE__*/React.createElement("textarea", {
    className: "fld",
    rows: "2",
    value: form.notes,
    placeholder: "Contexte, raison du trade\u2026",
    onChange: e => setForm({
      ...form,
      notes: e.target.value
    })
  })), strategies.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 12
    }
  }, /*#__PURE__*/React.createElement("label", {
    style: {
      fontSize: 12,
      color: 'var(--muted)'
    }
  }, "Strat\xE9gies appliqu\xE9es", /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--dim)'
    }
  }, " \u2014 alimente \xAB R\xE9ussite par strat\xE9gie \xBB")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: 6,
      marginTop: 7,
      maxHeight: 118,
      overflowY: 'auto'
    }
  }, strategies.map(s => {
    const on = picked.includes(s.id);
    return /*#__PURE__*/React.createElement("button", {
      key: s.id,
      type: "button",
      className: "tag",
      onClick: () => setPicked(p => on ? p.filter(x => x !== s.id) : [...p, s.id]),
      style: on ? {
        background: 'rgba(37,99,235,.24)',
        borderColor: 'rgba(37,99,235,.65)',
        color: '#fff'
      } : {
        cursor: 'pointer'
      },
      title: s.title + (s.type ? ` (${s.type})` : '')
    }, on && /*#__PURE__*/React.createElement("i", {
      className: "fas fa-check",
      style: {
        marginRight: 5
      }
    }), String(s.title || '').slice(0, 38));
  })), originId && /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '8px 0 0',
      fontSize: 12,
      color: 'var(--muted)'
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-link",
    style: {
      marginRight: 6
    }
  }), "Li\xE9 \xE0 l'analyse d'origine")), (() => {
    const e0 = parseFloat(String(form.entry).replace(',', '.'));
    const s0 = parseFloat(String(form.sl).replace(',', '.'));
    const t0 = parseFloat(String(form.tp).replace(',', '.'));
    if (!isFinite(e0) || !isFinite(s0)) return null;
    const risk = Math.abs(e0 - s0);
    const rr = isFinite(t0) ? Math.abs(t0 - e0) / risk : null;
    return /*#__PURE__*/React.createElement("p", {
      style: {
        margin: '12px 0 0',
        fontSize: 12.5,
        color: 'var(--muted)'
      }
    }, "Risque par unit\xE9 : ", /*#__PURE__*/React.createElement("b", {
      style: {
        color: '#fff'
      }
    }, risk.toFixed(4)), rr !== null && /*#__PURE__*/React.createElement(React.Fragment, null, " \xB7 Ratio pr\xE9vu : ", /*#__PURE__*/React.createElement("b", {
      style: {
        color: '#fff'
      }
    }, rr.toFixed(2), "R")));
  })()), open.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "panel",
    style: {
      padding: 20,
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: '0 0 14px',
      fontSize: 15
    }
  }, "Positions en cours ", /*#__PURE__*/React.createElement("span", {
    className: "badge",
    style: {
      marginLeft: 8
    }
  }, open.length)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 10
    }
  }, open.map(t => /*#__PURE__*/React.createElement("div", {
    key: t.id,
    className: "card",
    style: {
      padding: '12px 14px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: 10,
      alignItems: 'center',
      justifyContent: 'space-between'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("b", {
    style: {
      color: '#fff'
    }
  }, t.pair), (t.timeframe || t.provider) && /*#__PURE__*/React.createElement("span", {
    className: "badge",
    style: {
      background: 'rgba(96,165,250,.1)',
      color: '#93c5fd'
    },
    title: `Marché d'origine : ${t.pair}${t.timeframe ? ' en ' + t.timeframe : ''}${t.providerLabel ? ' · ' + t.providerLabel : ''}`
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-crosshairs"
  }), [t.timeframe, t.provider].filter(Boolean).join(' · ')), /*#__PURE__*/React.createElement("span", {
    className: "badge",
    style: {
      background: t.direction === 'BUY' ? 'rgba(16,185,129,.13)' : 'rgba(239,68,68,.13)',
      color: t.direction === 'BUY' ? '#34d399' : '#f87171'
    }
  }, t.direction), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12.5,
      color: 'var(--muted)'
    }
  }, "entr\xE9e ", /*#__PURE__*/React.createElement("b", {
    style: {
      color: '#fff'
    }
  }, n6(t.entry)), t.sl !== null && /*#__PURE__*/React.createElement(React.Fragment, null, " \xB7 SL ", /*#__PURE__*/React.createElement("b", {
    style: {
      color: '#fff'
    }
  }, n6(t.sl))), t.tp !== null && /*#__PURE__*/React.createElement(React.Fragment, null, " \xB7 TP ", /*#__PURE__*/React.createElement("b", {
    style: {
      color: '#fff'
    }
  }, n6(t.tp))), t.plannedRR !== null && /*#__PURE__*/React.createElement(React.Fragment, null, " \xB7 ", t.plannedRR, "R pr\xE9vu"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      alignItems: 'center',
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("input", {
    className: "fld",
    style: {
      width: 96
    },
    inputMode: "decimal",
    placeholder: "Sortie",
    value: (closing[t.id] || {}).exit || '',
    onChange: e => setClosing(s => ({
      ...s,
      [t.id]: {
        ...(s[t.id] || {}),
        exit: e.target.value
      }
    }))
  }), /*#__PURE__*/React.createElement("input", {
    className: "fld",
    style: {
      width: 96
    },
    inputMode: "decimal",
    placeholder: "PnL (opt.)",
    value: (closing[t.id] || {}).pnl || '',
    onChange: e => setClosing(s => ({
      ...s,
      [t.id]: {
        ...(s[t.id] || {}),
        pnl: e.target.value
      }
    }))
  }), /*#__PURE__*/React.createElement("button", {
    className: "btn sm",
    onClick: () => doClose(t.id),
    disabled: busy
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-flag-checkered"
  }), "Cl\xF4turer"), /*#__PURE__*/React.createElement("button", {
    className: "btn ghost sm",
    onClick: () => del(t.id),
    title: "Supprimer"
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-trash"
  })))), t.strategyIds && t.strategyIds.length > 0 && /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '8px 0 0',
      fontSize: 12,
      color: 'var(--muted)'
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-book",
    style: {
      marginRight: 6
    }
  }), t.strategyIds.map(stratTitle).join(', ')), t.notes && /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '8px 0 0',
      fontSize: 12.5,
      color: 'var(--muted)'
    }
  }, t.notes))))), /*#__PURE__*/React.createElement("div", {
    className: "panel",
    style: {
      padding: 20,
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: '0 0 14px',
      fontSize: 15
    }
  }, "Trades cl\xF4tur\xE9s ", /*#__PURE__*/React.createElement("span", {
    className: "badge",
    style: {
      marginLeft: 8
    }
  }, closed.length)), closed.length === 0 ? /*#__PURE__*/React.createElement("p", {
    style: {
      color: 'var(--muted)',
      fontSize: 13,
      margin: 0
    }
  }, "Aucun trade cl\xF4tur\xE9. Enregistre un trade puis cl\xF4ture-le avec son prix de sortie : le taux de r\xE9ussite se construit ici.") : /*#__PURE__*/React.createElement("div", {
    style: {
      overflowX: 'auto'
    }
  }, /*#__PURE__*/React.createElement("table", {
    style: {
      width: '100%',
      borderCollapse: 'collapse',
      fontSize: 13,
      minWidth: 640
    }
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", {
    style: {
      color: 'var(--muted)',
      fontSize: 11.5,
      textTransform: 'uppercase',
      letterSpacing: '.05em'
    }
  }, /*#__PURE__*/React.createElement("th", {
    style: {
      textAlign: 'left',
      padding: '8px 10px'
    }
  }, "Paire"), /*#__PURE__*/React.createElement("th", {
    style: {
      textAlign: 'left',
      padding: '8px 10px'
    }
  }, "Sens"), /*#__PURE__*/React.createElement("th", {
    style: {
      textAlign: 'right',
      padding: '8px 10px'
    }
  }, "Entr\xE9e"), /*#__PURE__*/React.createElement("th", {
    style: {
      textAlign: 'right',
      padding: '8px 10px'
    }
  }, "Sortie"), /*#__PURE__*/React.createElement("th", {
    style: {
      textAlign: 'right',
      padding: '8px 10px'
    }
  }, "R"), /*#__PURE__*/React.createElement("th", {
    style: {
      textAlign: 'right',
      padding: '8px 10px'
    }
  }, "PnL"), /*#__PURE__*/React.createElement("th", {
    style: {
      textAlign: 'left',
      padding: '8px 10px'
    }
  }, "R\xE9sultat"), /*#__PURE__*/React.createElement("th", {
    style: {
      padding: '8px 10px'
    }
  }))), /*#__PURE__*/React.createElement("tbody", null, closed.map(t => /*#__PURE__*/React.createElement("tr", {
    key: t.id,
    style: {
      borderTop: '1px solid var(--border)'
    }
  }, /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '9px 10px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      color: '#fff',
      fontWeight: 600
    }
  }, t.pair), t.strategyIds && t.strategyIds.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: 'var(--muted)',
      marginTop: 2
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-book",
    style: {
      marginRight: 4
    }
  }), t.strategyIds.map(stratTitle).join(', ').slice(0, 44))), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '9px 10px',
      color: 'var(--muted)'
    }
  }, t.direction), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '9px 10px',
      textAlign: 'right'
    }
  }, n6(t.entry)), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '9px 10px',
      textAlign: 'right'
    }
  }, n6(t.exit)), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '9px 10px',
      textAlign: 'right',
      color: t.rr > 0 ? '#34d399' : t.rr < 0 ? '#f87171' : 'var(--muted)'
    }
  }, n2(t.rr)), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '9px 10px',
      textAlign: 'right',
      color: t.pnl > 0 ? '#34d399' : t.pnl < 0 ? '#f87171' : 'var(--muted)'
    }
  }, n6(t.pnl)), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '9px 10px'
    }
  }, /*#__PURE__*/React.createElement(ResultBadge, {
    result: t.result,
    status: t.status
  })), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '9px 10px',
      textAlign: 'right'
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn ghost sm",
    onClick: () => del(t.id),
    title: "Supprimer"
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-trash"
  }))))))))), stats && stats.byStrategy && stats.byStrategy.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "panel",
    style: {
      padding: 20
    }
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: '0 0 14px',
      fontSize: 15
    }
  }, "R\xE9ussite par strat\xE9gie"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 10
    }
  }, stats.byStrategy.map(s => /*#__PURE__*/React.createElement(StatRow, {
    key: s.key,
    s: s
  })))), stats && stats.byMarket && stats.byMarket.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "panel",
    style: {
      padding: 20
    }
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: '0 0 6px',
      fontSize: 15
    }
  }, "R\xE9ussite par march\xE9"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '0 0 14px',
      fontSize: 12,
      color: 'var(--dim)'
    }
  }, "Instrument et unit\xE9 de temps : sur QUOI la performance est r\xE9ellement r\xE9alis\xE9e. Un trade sans march\xE9 renseign\xE9 appara\xEEt sous \xAB \u2014 \xBB."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 10
    }
  }, stats.byMarket.map(s => /*#__PURE__*/React.createElement(StatRow, {
    key: s.key,
    s: s
  }))), stats.bySource && stats.bySource.length > 0 && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: '20px 0 10px',
      fontSize: 15
    }
  }, "Par source de donn\xE9es"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 10
    }
  }, stats.bySource.map(s => /*#__PURE__*/React.createElement(StatRow, {
    key: s.key,
    s: s
  }))))));
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
function TradingViewChart({
  symbole,
  tf,
  height
}) {
  if (!symbole) {
    return /*#__PURE__*/React.createElement("div", {
      className: "panel",
      style: {
        padding: 24,
        textAlign: 'center',
        color: 'var(--muted)',
        fontSize: 13
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: "fas fa-circle-info",
      style: {
        marginRight: 7
      }
    }), "Ce march\xE9 n'a pas d'\xE9quivalent TradingView.");
  }
  const intervalle = {
    '1m': '1',
    '5m': '5',
    '15m': '15',
    '30m': '30',
    '1h': '60',
    '4h': '240',
    '1d': 'D'
  }[tf] || '5';
  const src = 'https://s.tradingview.com/widgetembed/' + `?symbol=${encodeURIComponent(symbole)}` + `&interval=${intervalle}` + '&theme=dark&style=1&locale=fr&timezone=Etc%2FUTC' + '&withdateranges=1&hide_side_toolbar=0&allow_symbol_change=0&save_image=1' + '&studies=Volume%40tv-basicstudies';
  return /*#__PURE__*/React.createElement("iframe", {
    src: src,
    title: `Graphique TradingView ${symbole}`,
    style: {
      width: '100%',
      height,
      border: 0,
      borderRadius: 10,
      background: '#080c14'
    },
    allowFullScreen: true
  });
}

/**
 * Garde-fou : si un composant lève une erreur d'affichage, on montre un message
 * et un bouton de rechargement au lieu d'un écran vide — l'utilisateur ne doit
 * jamais se retrouver devant une page morte sans explication.
 */
class Garde extends React.Component {
  constructor(p) {
    super(p);
    this.state = {
      err: null
    };
  }
  static getDerivedStateFromError(e) {
    return {
      err: e
    };
  }
  componentDidCatch(e) {
    try {
      console.error('Erreur d\'affichage :', e && e.message);
    } catch (_) {}
  }
  render() {
    if (this.state.err) {
      return /*#__PURE__*/React.createElement("div", {
        className: "panel",
        style: {
          padding: 24,
          margin: '24px auto',
          maxWidth: 560,
          textAlign: 'center'
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: 26,
          color: '#fbbf24',
          marginBottom: 10
        }
      }, /*#__PURE__*/React.createElement("i", {
        className: "fas fa-triangle-exclamation"
      })), /*#__PURE__*/React.createElement("h3", {
        style: {
          margin: '0 0 8px'
        }
      }, "Un affichage a \xE9chou\xE9"), /*#__PURE__*/React.createElement("p", {
        style: {
          color: 'var(--muted)',
          fontSize: 13,
          margin: '0 0 16px'
        }
      }, String(this.state.err && this.state.err.message || 'erreur inconnue')), /*#__PURE__*/React.createElement("button", {
        className: "btn",
        onClick: () => {
          this.setState({
            err: null
          });
          window.location.reload();
        }
      }, /*#__PURE__*/React.createElement("i", {
        className: "fas fa-rotate"
      }), "Recharger l'interface"));
    }
    return this.props.children;
  }
}

/* ══════════════ ALERTES ══════════════ */

// ── Scan complet : tous les marchés, silencieux ─────────────────────────────
// La surveillance n'alerte que sur sa liste courte. Ce panneau-ci regarde tout,
// ne prévient personne, et sert à décider quoi mettre sous surveillance.
function PanneauScan() {
  const [etat, setEtat] = useState({
    dernier: null,
    erreurs: []
  });
  const [tf, setTf] = useState('15m');
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState('');
  const [choix, setChoix] = useState('');
  const [strategies, setStrategies] = useState([]);
  // Combien de stratégies le dernier scan a réellement évaluées. Le champ est un
  // TABLEAU : vide = moteur générique, simple repérage.
  const nbStrategies = etat && etat.dernier && Array.isArray(etat.dernier.strategies) ? etat.dernier.strategies.length : 0;
  const lire = async () => {
    try {
      const r = await api('/scan');
      const d = await r.json();
      setEtat(d);
    } catch (e) {
      setInfo(e.message);
    }
  };
  const lancer = async () => {
    setBusy(true);
    setInfo('');
    try {
      const r = await api('/scan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          tf,
          strategie: choix || null
        })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'scan refusé');
      setEtat({
        actif: true,
        dernier: d,
        erreurs: d.erreurs || []
      });
      setInfo(`${d.signaux} signal/signaux sur ${d.marches} marché(s) en ${(d.dureeMs / 1000).toFixed(1)} s` + (d.strategie ? ` — stratégie « ${d.strategie} »` : ' — moteur générique'));
    } catch (e) {
      setInfo(e.message);
    } finally {
      setBusy(false);
    }
  };
  // Un signal repéré ici peut passer sous surveillance en un clic : c'est le
  // seul pont entre le scan silencieux et la liste courte qui notifie.
  const ajouterAuSuivi = async x => {
    try {
      const d0 = await (await api('/alerts')).json();
      const cfg = d0.config || {};
      const marches = cfg.marches || [];
      if (marches.some(y => y.symbol === x.symbole && y.tf === x.tf)) {
        setInfo(`${x.symbole} ${x.tf} est déjà sous surveillance.`);
        return;
      }
      const r = await api('/alerts', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ...cfg,
          marches: [...marches, {
            symbol: x.symbole,
            tf: x.tf,
            provider: x.provider
          }]
        })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'ajout refusé');
      setInfo(`${x.symbole} ${x.tf} ajouté à la surveillance.`);
    } catch (e) {
      setInfo(e.message);
    }
  };
  useEffect(() => {
    lire();
    // Stratégies réellement exécutables, pour scanner AVEC leurs règles.
    fetch('/api/strategies/profiles', {
      credentials: 'same-origin'
    }).then(r => r.json()).then(d => setStrategies((d.profils || []).filter(x => x && x.executable !== false))).catch(() => setStrategies([]));
  }, []);
  const dernier = etat.dernier;
  const lignes = dernier && dernier.resultats || [];
  return /*#__PURE__*/React.createElement("div", {
    className: "panel",
    style: {
      padding: 20
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: 17,
      fontWeight: 800,
      margin: '0 0 6px'
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-radar",
    style: {
      color: '#38bdf8',
      marginRight: 9
    }
  }), "Scan du march\xE9"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '0 0 14px',
      fontSize: 12.5,
      color: 'var(--muted)'
    }
  }, "Tous les march\xE9s disponibles, ", /*#__PURE__*/React.createElement("b", null, "sans aucune notification"), ". C'est le rep\xE9rage ; la surveillance reste seule \xE0 pr\xE9venir.", ' ', /*#__PURE__*/React.createElement("b", null, "Ce panneau n'\xE9value pas tes strat\xE9gies"), " : sans strat\xE9gie choisie, il utilise le moteur g\xE9n\xE9rique (toutes les r\xE8gles r\xE9unies), qui ne valide aucune fiche en particulier et ne parcourt qu'UNE unit\xE9 de temps \xE0 la fois."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 9,
      alignItems: 'center',
      flexWrap: 'wrap',
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("select", {
    className: "fld",
    "aria-label": "Unit\xE9 du scan",
    style: {
      margin: 0,
      width: 'auto'
    },
    value: tf,
    onChange: e => setTf(e.target.value)
  }, ['5m', '15m', '1h', '4h'].map(t => /*#__PURE__*/React.createElement("option", {
    key: t,
    value: t
  }, t))), /*#__PURE__*/React.createElement("select", {
    className: "fld",
    "aria-label": "Strat\xE9gie appliqu\xE9e au scan",
    style: {
      margin: 0,
      width: 'auto',
      maxWidth: 260
    },
    value: choix,
    onChange: e => setChoix(e.target.value)
  }, /*#__PURE__*/React.createElement("option", {
    value: ""
  }, "Moteur g\xE9n\xE9rique"), strategies.map(x => /*#__PURE__*/React.createElement("option", {
    key: x.id,
    value: x.id
  }, x.titre || x.id))), /*#__PURE__*/React.createElement("button", {
    className: "btn sm",
    onClick: lancer,
    disabled: busy
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-play"
  }), busy ? 'Scan en cours…' : 'Lancer le scan'), dernier && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: 'var(--dim)'
    }
  }, new Date(dernier.at).toLocaleString('fr-FR'), " \xB7 ", (dernier.tfs || [dernier.tf]).join(' + '), " \xB7 ", dernier.marches, " march\xE9(s) \xB7 ", dernier.signaux, " signal/signaux \xB7 ", nbStrategies === 0 ? 'aucune stratégie (générique)' : nbStrategies + ' stratégie(s)')), dernier && /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 10,
      padding: '8px 11px',
      borderRadius: 8,
      fontSize: 12,
      background: nbStrategies ? 'rgba(52,211,153,.08)' : 'rgba(245,158,11,.09)',
      border: `1px solid ${nbStrategies ? 'rgba(52,211,153,.3)' : 'rgba(245,158,11,.3)'}`,
      color: nbStrategies ? '#6ee7b7' : '#fbbf24'
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: `fas ${nbStrategies ? 'fa-book' : 'fa-triangle-exclamation'}`,
    style: {
      marginRight: 7
    }
  }), nbStrategies ? /*#__PURE__*/React.createElement(React.Fragment, null, "Scan avec ", /*#__PURE__*/React.createElement("b", null, nbStrategies, " strat\xE9gie", nbStrategies > 1 ? 's' : ''), " \u2014 leurs r\xE8gles et leurs seuils. Chaque ligne est un signal DE la strat\xE9gie nomm\xE9e.") : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("b", null, "Moteur g\xE9n\xE9rique"), " \u2014 aucune strat\xE9gie n'a \xE9t\xE9 \xE9valu\xE9e. Ce r\xE9sultat est un rep\xE9rage, pas une validation. Unit\xE9s : ", (dernier.tfs || [dernier.tf]).join(', '), "."), nbStrategies > 0 && /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--dim)'
    }
  }, ' ', "\xC9valu\xE9es : ", /*#__PURE__*/React.createElement("b", null, dernier.strategies.join(', ')), ".")), info && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      color: '#93c5fd',
      marginBottom: 10
    }
  }, info), !lignes.length && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      color: 'var(--dim)'
    }
  }, "Aucun signal directionnel au dernier passage. Lance un scan pour rafra\xEEchir."), lignes.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 6
    }
  }, lignes.slice(0, 40).map((x, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      gap: 10,
      alignItems: 'center',
      fontSize: 12.5,
      paddingBottom: 6,
      borderBottom: '1px solid rgba(27,36,51,.5)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: '#fff'
    }
  }, /*#__PURE__*/React.createElement("b", {
    style: {
      color: x.direction === 'BUY' ? '#34d399' : '#f87171'
    }
  }, x.direction), ' ', x.symbole, " ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--dim)'
    }
  }, "\xB7 ", x.tf)), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--muted)'
    }
  }, "force ", Number(x.force || 0).toFixed(2), " \xB7 ", x.status || '—', " \xB7 ", x.confirmations || 0, " r\xE8gle(s)", ' ', x.strategie ? /*#__PURE__*/React.createElement("span", {
    className: "badge",
    style: {
      fontSize: 9.5,
      background: 'rgba(52,211,153,.14)',
      color: '#6ee7b7'
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-book",
    style: {
      fontSize: 8
    }
  }), x.strategie) : /*#__PURE__*/React.createElement("span", {
    className: "badge",
    style: {
      fontSize: 9.5,
      background: 'rgba(245,158,11,.14)',
      color: '#fbbf24'
    },
    title: "Rep\xE9r\xE9 par le moteur g\xE9n\xE9rique : aucune fiche de strat\xE9gie n'a \xE9t\xE9 appliqu\xE9e."
  }, "g\xE9n\xE9rique")), /*#__PURE__*/React.createElement("button", {
    className: "btn ghost sm",
    onClick: () => ajouterAuSuivi(x),
    title: "Ajouter \xE0 la liste de surveillance"
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-bell"
  }), "Surveiller")))), (etat.erreurs || []).length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 10,
      fontSize: 11.5,
      color: 'var(--dim)'
    }
  }, "Ignor\xE9s : ", etat.erreurs.slice(0, 6).join(' · ')));
}
function Alertes() {
  const [cfg, setCfg] = useState(null);
  // Stratégies de la base : la surveillance peut les appliquer, au lieu de
  // tourner en mode auto (toutes les règles) et d'ignorer la sélection.
  const [profils, setProfils] = useState([]);
  const [stratOuvert, setStratOuvert] = useState(false);
  // Les marchés proposés viennent de la même source que l'onglet Direct.
  const [meta, setMeta] = useState({
    symbols: [],
    timeframes: []
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [nouveau, setNouveau] = useState({
    symbol: 'frxXAUUSD',
    tf: '15m',
    provider: 'deriv'
  });
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
    setTgBusy(true);
    setErr('');
    setMsg('');
    setAideTg('');
    setChatsTg([]);
    try {
      const r = await api('/alerts/telegram/trouver', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          token: cfg && cfg.telegramToken || ''
        })
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      if (d.trouve) {
        setChatsTg(d.chats || []);
        setMsg(`Conversation${(d.chats || []).length > 1 ? 's' : ''} trouvée${(d.chats || []).length > 1 ? 's' : ''} : ` + (d.chats || []).map(c => `${c.nom} (${c.id})`).join(' · '));
      } else {
        setAideTg(d.aide || 'Aucune conversation trouvée.');
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setTgBusy(false);
    }
  };

  /** Envoie un vrai message Telegram : si ça arrive sur le téléphone, c'est branché. */
  const testerTelegram = async () => {
    setTgBusy(true);
    setErr('');
    setMsg('');
    try {
      const r = await api('/alerts/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          canal: 'telegram'
        })
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setMsg(d.message || 'Message envoyé : regarde ton Telegram.');
    } catch (e) {
      setErr(e.message);
    } finally {
      setTgBusy(false);
    }
  };
  const load = async () => {
    try {
      const r = await api('/alerts');
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Lecture impossible');
      setCfg(d.config || null);
    } catch (e) {
      setErr(e.message);
    }
  };
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    (async () => {
      try {
        const r = await api('/market/symbols');
        const d = await r.json();
        if (d.success) setMeta({
          symbols: d.symbols || [],
          timeframes: d.timeframes || []
        });
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
  const sauver = async patch => {
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      const r = await api('/alerts', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ...cfg,
          ...patch
        })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Enregistrement refusé');
      setCfg(d.config);
      setMsg('Réglages enregistrés.');
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const tester = async () => {
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      const r = await api('/alerts/test', {
        method: 'POST'
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Envoi impossible');
      setMsg(`Email de test envoyé à ${d.to}.`);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const controler = async () => {
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      const r = await api('/alerts/verifier', {
        method: 'POST'
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Contrôle impossible');
      setCompte(d);
      setMsg(d.envoyes ? `${d.envoyes} alerte(s) envoyée(s).` : 'Aucun signal confirmé pour l\'instant.');
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  /**
   * Notifications push : l'abonnement vit dans le navigateur (PushManager),
   * sa copie côté serveur sert à l'envoi. Sans worker actif ni clé VAPID,
   * chaque étape dit pourquoi au lieu de se taire.
   */
  const cleVersU8 = base64 => {
    const pad = '='.repeat((4 - base64.length % 4) % 4);
    const bin = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  };
  const etatPush = async () => {
    setPushInfo('');
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      setPushEtat('non-supporte');
      return;
    }
    try {
      const cfgPush = await (await api('/push/config')).json();
      if (!cfgPush.pret || !cfgPush.clePublique) {
        setPushEtat('non-configure');
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setPushEtat(sub ? 'actif' : Notification.permission === 'denied' ? 'refuse' : 'inactif');
    } catch (e) {
      setPushEtat('inconnu');
      setPushInfo(e.message);
    }
  };
  const activerPush = async () => {
    setPushBusy(true);
    setPushInfo('');
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
      const r = await api('/push/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          subscription: sub.toJSON()
        })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Enregistrement refusé');
      setPushEtat('actif');
      setMsg('Notifications push activées sur cet appareil.');
    } catch (e) {
      setPushInfo(e.message);
      await etatPush();
    } finally {
      setPushBusy(false);
    }
  };
  const desactiverPush = async () => {
    setPushBusy(true);
    setPushInfo('');
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      const endpoint = sub ? sub.endpoint : null;
      if (sub) await sub.unsubscribe();
      await api('/push/subscribe', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          endpoint
        })
      });
      setPushEtat('inactif');
    } catch (e) {
      setPushInfo(e.message);
    } finally {
      setPushBusy(false);
    }
  };
  useEffect(() => {
    etatPush();
  }, []);
  const ajouterMarche = () => {
    if (!nouveau.symbol) return;
    const m = cfg.marches || [];
    if (m.some(x => x.symbol === nouveau.symbol && x.tf === nouveau.tf && x.provider === nouveau.provider)) return;
    sauver({
      marches: [...m, {
        ...nouveau
      }]
    });
  };
  const retirerMarche = i => sauver({
    marches: (cfg.marches || []).filter((_, k) => k !== i)
  });
  if (!cfg) return /*#__PURE__*/React.createElement("div", {
    className: "panel",
    style: {
      padding: 28,
      textAlign: 'center',
      color: 'var(--muted)'
    }
  }, err ? err : 'Chargement des réglages…');
  const libelle = (sym, prov) => {
    const s = (meta.symbols || []).find(x => x.symbol === sym && x.provider === prov);
    return s ? s.tv || s.label : `${prov}:${sym}`;
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(Reveal, null, /*#__PURE__*/React.createElement("div", {
    className: "panel",
    style: {
      padding: 20
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: 17,
      fontWeight: 800,
      margin: '0 0 6px'
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-list-check",
    style: {
      color: '#60a5fa',
      marginRight: 9
    }
  }), "Strat\xE9gies appliqu\xE9es \xE0 la surveillance"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '0 0 14px',
      fontSize: 12.5,
      color: 'var(--muted)'
    }
  }, "Choisis les strat\xE9gies que la surveillance doit \xE9valuer. Chacune rend son propre signal, avec ses r\xE8gles et ses unit\xE9s de temps. Aucune s\xE9lectionn\xE9e = mode auto (toutes les r\xE8gles confondues)."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      flexWrap: 'wrap',
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn ghost sm",
    onClick: () => setStratOuvert(o => !o)
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-chevron-down"
  }), (cfg.strategies || []).length ? `${(cfg.strategies || []).length} stratégie(s) surveillée(s)` : 'Choisir les stratégies'), (cfg.strategies || []).length > 0 && /*#__PURE__*/React.createElement("button", {
    className: "btn ghost sm",
    disabled: busy,
    onClick: () => sauver({
      strategies: []
    })
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-rotate-left"
  }), " Revenir au mode auto"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11.5,
      color: 'var(--dim)'
    }
  }, profils.length, " disponible(s) dans la base")), (cfg.strategies || []).length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 6,
      flexWrap: 'wrap',
      marginBottom: 10
    }
  }, (cfg.strategies || []).map(id => {
    const p = profils.find(x => x.id === id);
    return /*#__PURE__*/React.createElement("span", {
      key: id,
      className: "tag",
      title: p ? (p.regles || []).join('+') : id,
      style: {
        borderColor: 'rgba(96,165,250,.4)',
        color: '#93c5fd'
      }
    }, (p && p.titre ? p.titre : id).slice(0, 46));
  })), stratOuvert && /*#__PURE__*/React.createElement("div", {
    style: {
      maxHeight: 300,
      overflowY: 'auto',
      padding: '10px 12px',
      borderRadius: 10,
      background: 'rgba(148,163,184,.04)',
      border: '1px solid rgba(148,163,184,.16)'
    }
  }, profils.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      color: 'var(--muted)'
    }
  }, "Aucune strat\xE9gie dans la base. Ajoute-en dans l'onglet \xAB Ajouter \xBB."), profils.map(p => {
    const coche = (cfg.strategies || []).includes(p.id);
    return /*#__PURE__*/React.createElement("label", {
      key: p.id,
      style: {
        display: 'flex',
        gap: 9,
        alignItems: 'center',
        padding: '5px 2px',
        fontSize: 12.5,
        cursor: 'pointer'
      }
    }, /*#__PURE__*/React.createElement("input", {
      type: "checkbox",
      checked: coche,
      readOnly: true,
      onClick: () => {
        const actuelles = cfg.strategies || [];
        const suivantes = coche ? actuelles.filter(x => x !== p.id) : [...actuelles, p.id];
        sauver({
          strategies: suivantes
        });
      }
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        flex: 1
      }
    }, p.titre), /*#__PURE__*/React.createElement("span", {
      className: "tag",
      style: {
        fontSize: 10
      }
    }, (p.regles || []).join('+')), (p.timeframes || []).length > 0 && /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 10,
        color: 'var(--dim)'
      }
    }, p.timeframes.join('/')));
  })))), /*#__PURE__*/React.createElement(Reveal, null, /*#__PURE__*/React.createElement("div", {
    className: "panel",
    style: {
      padding: 20
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: 17,
      fontWeight: 800,
      margin: '0 0 6px'
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-bell",
    style: {
      color: '#fbbf24',
      marginRight: 9
    }
  }), "Alertes par email"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '0 0 16px',
      fontSize: 12.5,
      color: 'var(--muted)'
    }
  }, "Un signal confirm\xE9 n'existe que si l'onglet est ouvert. Ici, l'app surveille les march\xE9s choisis et t'envoie un email au premier signal confirm\xE9 \u2014 une seule fois par signal."), msg && /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 12,
      padding: '9px 12px',
      borderRadius: 8,
      fontSize: 12.5,
      background: 'rgba(16,185,129,.1)',
      color: '#6ee7b7'
    }
  }, msg), err && /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 12,
      padding: '9px 12px',
      borderRadius: 8,
      fontSize: 12.5,
      background: 'rgba(239,68,68,.1)',
      color: '#fca5a5'
    }
  }, err), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 12,
      gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))'
    }
  }, /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'grid',
      gap: 5
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: 'var(--muted)'
    }
  }, "Surveillance"), /*#__PURE__*/React.createElement("select", {
    className: "fld",
    "aria-label": "\xC9tat de l'alerte",
    style: {
      margin: 0
    },
    value: cfg.actif ? 'on' : 'off',
    onChange: e => sauver({
      actif: e.target.value === 'on'
    })
  }, /*#__PURE__*/React.createElement("option", {
    value: "off"
  }, "d\xE9sactiv\xE9e"), /*#__PURE__*/React.createElement("option", {
    value: "on"
  }, "active"))), /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'grid',
      gap: 5
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: 'var(--muted)'
    }
  }, "Adresse de r\xE9ception"), /*#__PURE__*/React.createElement("input", {
    className: "fld",
    style: {
      margin: 0
    },
    value: cfg.email || '',
    placeholder: "ton@email.com",
    onChange: e => setCfg({
      ...cfg,
      email: e.target.value
    }),
    onBlur: () => sauver({
      email: cfg.email
    })
  })), /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'grid',
      gap: 5
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: 'var(--muted)'
    }
  }, "Force minimale : ", Math.round((cfg.forceMin || 0) * 100), " %"), /*#__PURE__*/React.createElement("input", {
    type: "range",
    min: "0",
    max: "100",
    step: "5",
    value: Math.round((cfg.forceMin || 0) * 100),
    onChange: e => setCfg({
      ...cfg,
      forceMin: Number(e.target.value) / 100
    }),
    onMouseUp: () => sauver({
      forceMin: cfg.forceMin
    })
  })), /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'grid',
      gap: 5
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: 'var(--muted)'
    }
  }, "Intervalle de contr\xF4le (s)"), /*#__PURE__*/React.createElement("input", {
    className: "fld",
    style: {
      margin: 0
    },
    type: "number",
    min: "15",
    max: "3600",
    value: cfg.intervalleSec || 60,
    onChange: e => setCfg({
      ...cfg,
      intervalleSec: Number(e.target.value)
    }),
    onBlur: () => sauver({
      intervalleSec: cfg.intervalleSec
    })
  })), /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'grid',
      gap: 5
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: 'var(--muted)'
    }
  }, "Silence entre deux rappels (min)"), /*#__PURE__*/React.createElement("input", {
    className: "fld",
    style: {
      margin: 0
    },
    type: "number",
    min: "0",
    max: "1440",
    value: cfg.cooldownMin === undefined ? 30 : cfg.cooldownMin,
    onChange: e => setCfg({
      ...cfg,
      cooldownMin: Number(e.target.value)
    }),
    onBlur: () => sauver({
      cooldownMin: cfg.cooldownMin
    })
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: 'var(--dim)'
    }
  }, "0 = aucun rappel. Un m\xEAme signal ne repart pas avant ce d\xE9lai."))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 10,
      marginTop: 16,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn",
    onClick: tester,
    disabled: busy
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-paper-plane"
  }), "Envoyer un email de test"), /*#__PURE__*/React.createElement("button", {
    className: "btn ghost",
    onClick: controler,
    disabled: busy
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-magnifying-glass-chart"
  }), "V\xE9rifier maintenant")), compte && compte.marches && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 14,
      fontSize: 12.5,
      display: 'grid',
      gap: 5
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      color: 'var(--muted)'
    }
  }, "Dernier contr\xF4le :"), compte.marches.map((m, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--muted)'
    }
  }, libelle(m.symbol, m.provider), " ", m.tf), /*#__PURE__*/React.createElement("span", {
    style: {
      color: /ALERTE/.test(m.verdict) ? '#6ee7b7' : 'var(--dim)'
    }
  }, m.verdict)))))), /*#__PURE__*/React.createElement(Reveal, null, /*#__PURE__*/React.createElement("div", {
    className: "panel",
    style: {
      padding: 20
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: 17,
      fontWeight: 800,
      margin: '0 0 6px'
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fab fa-telegram",
    style: {
      color: '#29b6f6',
      marginRight: 9
    }
  }), "Alertes Telegram"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '0 0 16px',
      fontSize: 12.5,
      color: 'var(--muted)'
    }
  }, "Le signal confirm\xE9 arrive sur ton t\xE9l\xE9phone, tout de suite. Les deux canaux (email et Telegram) fonctionnent ensemble : ce n'est pas l'un ou l'autre."), /*#__PURE__*/React.createElement("ol", {
    style: {
      margin: '0 0 16px',
      paddingLeft: 20,
      fontSize: 12.5,
      color: 'var(--muted)',
      display: 'grid',
      gap: 5
    }
  }, /*#__PURE__*/React.createElement("li", null, "Ouvre Telegram et cherche ", /*#__PURE__*/React.createElement("b", {
    style: {
      color: '#e2e8f0'
    }
  }, "@BotFather")), /*#__PURE__*/React.createElement("li", null, "Envoie-lui ", /*#__PURE__*/React.createElement("b", {
    style: {
      color: '#e2e8f0'
    }
  }, "/newbot"), " et suis ses deux questions (nom, puis identifiant finissant par \xAB bot \xBB)"), /*#__PURE__*/React.createElement("li", null, "Il te donne un ", /*#__PURE__*/React.createElement("b", {
    style: {
      color: '#e2e8f0'
    }
  }, "jeton"), " (une longue suite de chiffres et de lettres) : colle-le ci-dessous"), /*#__PURE__*/React.createElement("li", null, "Cherche ton bot par son nom et envoie-lui ", /*#__PURE__*/React.createElement("b", {
    style: {
      color: '#e2e8f0'
    }
  }, "salut"), ", puis clique sur \xAB Trouver ma conversation \xBB")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 12,
      gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))'
    }
  }, /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'grid',
      gap: 5
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: 'var(--muted)'
    }
  }, "Jeton du bot (donn\xE9 par BotFather)"), /*#__PURE__*/React.createElement("input", {
    className: "fld",
    style: {
      margin: 0
    },
    value: cfg && cfg.telegramToken || '',
    placeholder: "123456789:AAE\u2026",
    onChange: e => setCfg({
      ...cfg,
      telegramToken: e.target.value
    }),
    onBlur: () => sauver({
      telegramToken: cfg && cfg.telegramToken || ''
    })
  })), /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'grid',
      gap: 5
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: 'var(--muted)'
    }
  }, "Conversation (remplie automatiquement)"), /*#__PURE__*/React.createElement("input", {
    className: "fld",
    style: {
      margin: 0
    },
    value: cfg && cfg.telegramChat || '',
    placeholder: "trouv\xE9 par le bouton ci-dessous",
    onChange: e => setCfg({
      ...cfg,
      telegramChat: e.target.value
    }),
    onBlur: () => sauver({
      telegramChat: cfg && cfg.telegramChat || ''
    })
  }))), chatsTg.length > 1 && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 12,
      display: 'grid',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: 'var(--muted)'
    }
  }, "Plusieurs conversations : choisis la bonne"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 7,
      flexWrap: 'wrap'
    }
  }, chatsTg.map((c, i) => /*#__PURE__*/React.createElement("button", {
    key: i,
    className: "btn ghost sm",
    onClick: () => sauver({
      telegramChat: String(c.id)
    })
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-comment"
  }), c.nom, " \xB7 ", c.id)))), aideTg && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 12,
      padding: '9px 12px',
      borderRadius: 8,
      fontSize: 12.5,
      background: 'rgba(251,191,36,.1)',
      color: '#fcd34d'
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-circle-info",
    style: {
      marginRight: 7
    }
  }), aideTg), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 9,
      flexWrap: 'wrap',
      marginTop: 16
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn ghost",
    onClick: trouverTelegram,
    disabled: tgBusy || !cfg || !cfg.telegramToken
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-magnifying-glass"
  }), "Trouver ma conversation"), /*#__PURE__*/React.createElement("button", {
    className: "btn ok",
    onClick: testerTelegram,
    disabled: tgBusy || !cfg || !cfg.telegramToken || !cfg.telegramChat
  }, /*#__PURE__*/React.createElement("i", {
    className: "fab fa-telegram"
  }), "Envoyer un message d'essai"), /*#__PURE__*/React.createElement("span", {
    style: {
      alignSelf: 'center',
      fontSize: 12,
      color: cfg && cfg.telegramToken && cfg.telegramChat ? '#6ee7b7' : 'var(--dim)'
    }
  }, cfg && cfg.telegramToken && cfg.telegramChat ? 'Telegram est configuré' : 'à configurer')))), /*#__PURE__*/React.createElement(Reveal, null, /*#__PURE__*/React.createElement("div", {
    className: "panel",
    style: {
      padding: 20
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: 17,
      fontWeight: 800,
      margin: '0 0 6px'
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-bell",
    style: {
      color: '#60a5fa',
      marginRight: 9
    }
  }), "Notifications push"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '0 0 16px',
      fontSize: 12.5,
      color: 'var(--muted)'
    }
  }, "Le signal confirm\xE9 s'affiche sur ton appareil, m\xEAme si l'onglet est ferm\xE9 (le navigateur doit rester ouvert)."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 9,
      flexWrap: 'wrap',
      alignItems: 'center'
    }
  }, pushEtat !== 'actif' ? /*#__PURE__*/React.createElement("button", {
    className: "btn",
    onClick: activerPush,
    disabled: pushBusy
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-bell"
  }), "Activer les notifications") : /*#__PURE__*/React.createElement("button", {
    className: "btn ghost",
    onClick: desactiverPush,
    disabled: pushBusy
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-bell-slash"
  }), "D\xE9sactiver sur cet appareil"), /*#__PURE__*/React.createElement("button", {
    className: "btn ghost sm",
    onClick: etatPush,
    disabled: pushBusy
  }, "Actualiser l'\xE9tat"), /*#__PURE__*/React.createElement("span", {
    style: {
      alignSelf: 'center',
      fontSize: 12,
      color: pushEtat === 'actif' ? '#6ee7b7' : 'var(--dim)'
    }
  }, pushEtat === 'actif' ? 'push actif sur cet appareil' : pushEtat === 'inactif' ? 'push inactif' : pushEtat === 'refuse' ? 'notifications refusées par le navigateur' : pushEtat === 'non-supporte' ? 'navigateur incompatible' : pushEtat === 'non-configure' ? 'clés VAPID manquantes côté serveur' : 'état inconnu')), pushInfo && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 12,
      padding: '9px 12px',
      borderRadius: 8,
      fontSize: 12.5,
      background: 'rgba(251,191,36,.1)',
      color: '#fcd34d'
    }
  }, pushInfo))), /*#__PURE__*/React.createElement("div", {
    className: "panel",
    style: {
      padding: 20
    }
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: '0 0 12px',
      fontSize: 15
    }
  }, (cfg.marches || []).length, " march\xE9(s) surveill\xE9(s)"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      flexWrap: 'wrap',
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("select", {
    className: "fld",
    "aria-label": "Fournisseur du nouveau symbole",
    style: {
      margin: 0,
      width: 'auto'
    },
    value: nouveau.provider,
    onChange: e => setNouveau({
      ...nouveau,
      symbol: '',
      provider: e.target.value
    })
  }, /*#__PURE__*/React.createElement("option", {
    value: "deriv"
  }, "Deriv"), /*#__PURE__*/React.createElement("option", {
    value: "binance"
  }, "Binance")), /*#__PURE__*/React.createElement("select", {
    className: "fld",
    "aria-label": "Symbole surveill\xE9",
    style: {
      margin: 0,
      width: 'auto'
    },
    value: nouveau.symbol,
    onChange: e => setNouveau({
      ...nouveau,
      symbol: e.target.value
    })
  }, /*#__PURE__*/React.createElement("option", {
    value: ""
  }, "\u2014 march\xE9 \u2014"), (meta.symbols || []).filter(s => s.provider === nouveau.provider).map(s => /*#__PURE__*/React.createElement("option", {
    key: s.symbol,
    value: s.symbol
  }, s.tv || s.label))), /*#__PURE__*/React.createElement("select", {
    className: "fld",
    "aria-label": "Unit\xE9 de temps surveill\xE9e",
    style: {
      margin: 0,
      width: 'auto'
    },
    value: nouveau.tf,
    onChange: e => setNouveau({
      ...nouveau,
      tf: e.target.value
    })
  }, (meta.timeframes || []).map(t => /*#__PURE__*/React.createElement("option", {
    key: t,
    value: t
  }, t))), /*#__PURE__*/React.createElement("button", {
    className: "btn ghost sm",
    onClick: ajouterMarche,
    disabled: busy || !nouveau.symbol
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-plus"
  }), "Ajouter")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 7
    }
  }, (cfg.marches || []).map((m, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 10,
      paddingBottom: 7,
      borderBottom: '1px solid rgba(27,36,51,.5)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      color: '#fff'
    }
  }, libelle(m.symbol, m.provider), " ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--dim)'
    }
  }, "\xB7 ", m.tf), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--dim)',
      fontSize: 11.5
    }
  }, ' · ', (cfg.strategies || []).length || 'toutes', " strat\xE9gie(s)", (cfg.strategies || []).length === 1 ? '' : ''), (() => {
    // Dernière alerte pour ce marché : dit si le cooldown court encore.
    const d = (cfg.derniers || []).find(a => a.symbol === m.symbol && a.tf === m.tf);
    if (!d) return null;
    const reste = Math.max(0, Math.round((Number(cfg.cooldownMin === undefined ? 30 : cfg.cooldownMin) * 60_000 - (Date.now() - new Date(d.at).getTime())) / 60_000));
    return /*#__PURE__*/React.createElement("span", {
      style: {
        color: reste > 0 ? '#fbbf24' : 'var(--dim)',
        fontSize: 11.5
      }
    }, ' · ', reste > 0 ? `silence ${reste} min` : 'prêt');
  })()), /*#__PURE__*/React.createElement("button", {
    onClick: () => retirerMarche(i),
    disabled: busy,
    style: {
      background: 'none',
      border: 'none',
      color: '#f87171',
      cursor: 'pointer',
      fontSize: 12.5
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-trash"
  })))), !(cfg.marches || []).length && /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--dim)',
      fontSize: 12.5
    }
  }, "Aucun march\xE9 surveill\xE9."))), /*#__PURE__*/React.createElement(PanneauScan, null), /*#__PURE__*/React.createElement("div", {
    className: "panel",
    style: {
      padding: 20
    }
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: '0 0 12px',
      fontSize: 15
    }
  }, "Alertes envoy\xE9es"), !(cfg.derniers || []).length && /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--dim)',
      fontSize: 12.5
    }
  }, "Aucune alerte envoy\xE9e pour l'instant."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 8
    }
  }, (cfg.derniers || []).map((a, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      gap: 12,
      flexWrap: 'wrap',
      fontSize: 12.5,
      paddingBottom: 7,
      borderBottom: '1px solid rgba(27,36,51,.5)'
    }
  }, /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("b", {
    style: {
      color: a.direction === 'BUY' ? '#34d399' : '#f87171'
    }
  }, a.direction), ' ', libelle(a.symbol, a.provider), " \xB7 ", a.tf), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--muted)'
    }
  }, "force ", a.forceNiveau || '—', " (", Number(a.strength || 0).toFixed(2), "/1) \xB7 ", new Date(a.at).toLocaleString('fr-FR')))))));
}

/* ══════════════ TERMES ══════════════ */

/**
 * Le vocabulaire du moteur, chaque terme relié à l'endroit de l'interface où
 * il est calculé. Sans ça, les sigles restent opaques : on voit « BOS » ou
 * « FVG » sans savoir ce que l'application a réellement mesuré.
 */
const LEXIQUE = [{
  f: 'Structure',
  sigle: 'BOS',
  nom: 'Break of Structure',
  fr: 'rupture de structure',
  def: "Clôture au-delà du dernier sommet (ou creux) DANS le sens de la tendance : le mouvement se poursuit.",
  ou: "Règle R2 · panneaux « Structure calculée » et « éléments identifiés »"
}, {
  f: 'Structure',
  sigle: 'CHoCH',
  nom: 'Change of Character',
  fr: 'changement de caractère',
  def: "Première cassure CONTRE la tendance en place : le marché change de camp, retournement possible.",
  ou: "Règle R2 (nommée « changement de caractère » dans le verdict)"
}, {
  f: 'Structure',
  sigle: 'MSS',
  nom: 'Market Structure Shift',
  fr: 'décalage de structure',
  def: "Cassure qui invalide la structure précédente — un CHoCH suivi d'une prise de liquidité.",
  ou: "Déduit du verdict quand un CHoCH apparaît après un balayage"
}, {
  f: 'Structure',
  sigle: 'HH / HL',
  nom: 'Higher High / Higher Low',
  fr: 'sommet / creux ascendants',
  def: "Séquence qui définit une tendance haussière : chaque sommet et chaque creux monte.",
  ou: "Ligne « Récent » du panneau « Structure calculée »"
}, {
  f: 'Structure',
  sigle: 'LH / LL',
  nom: 'Lower High / Lower Low',
  fr: 'sommet / creux descendants',
  def: "Séquence qui définit une tendance baissière : chaque sommet et chaque creux descend.",
  ou: "Ligne « Récent » du panneau « Structure calculée »"
}, {
  f: 'Structure',
  sigle: 'Swing',
  nom: 'Swing high / low',
  fr: 'sommet ou creux local',
  def: "Point plus haut (ou plus bas) que les bougies voisines. Base de toute la lecture de structure.",
  ou: "Fenêtre réglable par stratégie (« Fenêtre des swings »)"
}, {
  f: 'Zones',
  sigle: 'OB',
  nom: 'Order Block',
  fr: 'bloc d’ordres',
  def: "Dernière bougie de sens opposé avant une impulsion : la zone où de gros ordres ont été passés.",
  ou: "Règle R3 · section « order blocks » de l'inventaire"
}, {
  f: 'Zones',
  sigle: 'FVG',
  nom: 'Fair Value Gap',
  fr: 'déséquilibre de prix',
  def: "Écart entre trois bougies, laissé quand le prix bouge trop vite : le marché revient souvent le combler.",
  ou: "Règle R3 · section « imbalances » de l'inventaire"
}, {
  f: 'Zones',
  sigle: 'Breaker',
  nom: 'Breaker block',
  fr: 'bloc cassé',
  def: "Order block cassé par la clôture : la zone change de camp (support devenu résistance).",
  ou: "Section « breakers » du panneau Fibonacci et de l'inventaire"
}, {
  f: 'Zones',
  sigle: 'EQH / EQL',
  nom: 'Equal Highs / Equal Lows',
  fr: 'sommets / creux égaux',
  def: "Deux sommets (ou creux) au même niveau : les stops s'y accumulent, le prix vient les chercher.",
  ou: "Section « liquidité » de l'inventaire · règle R1"
}, {
  f: 'Zones',
  sigle: 'Liquidity',
  nom: 'Liquidity pool',
  fr: 'amas de liquidité',
  def: "Niveau où se trouvent les ordres stop (au-dessus des sommets, sous les creux). Le prix y est attiré.",
  ou: "Section « liquidité » de l'inventaire"
}, {
  f: 'Prix',
  sigle: 'Premium',
  nom: 'Premium',
  fr: 'zone haute du range',
  def: "Prix au-dessus de l'équilibre (50 %) du range : on privilégie la VENTE.",
  ou: "Règle R4 · panneau « Structure calculée »"
}, {
  f: 'Prix',
  sigle: 'Discount',
  nom: 'Discount',
  fr: 'zone basse du range',
  def: "Prix sous l'équilibre (50 %) du range : on privilégie l'ACHAT.",
  ou: "Règle R4 · panneau « Structure calculée »"
}, {
  f: 'Prix',
  sigle: 'OTE',
  nom: 'Optimal Trade Entry',
  fr: 'zone d’entrée optimale',
  def: "Retracement entre 0,618 et 0,786 du dernier mouvement : la zone d'entrée privilégiée.",
  ou: "Panneau « Fibonacci & périodes de référence »"
}, {
  f: 'Prix',
  sigle: 'PDH / PDL',
  nom: 'Previous Day High / Low',
  fr: 'plus haut / bas de la veille',
  def: "Repères de la séance précédente : souvent pris puis rejoués comme supports ou résistances.",
  ou: "Panneau « Fibonacci & périodes de référence »"
}, {
  f: 'Prix',
  sigle: 'PWH / PWL',
  nom: 'Previous Week High / Low',
  fr: 'plus haut / bas de la semaine passée',
  def: "Mêmes repères, à l'échelle hebdomadaire : le contexte large.",
  ou: "Panneau « Fibonacci & périodes de référence »"
}, {
  f: 'Flux',
  sigle: 'Sweep',
  nom: 'Liquidity sweep',
  fr: 'balayage de liquidité',
  def: "Mèche au-delà d'un niveau puis clôture de l'autre côté : les stops sont pris, pas la tendance poursuivie.",
  ou: "Règle R1 · section « balayages » de l'inventaire"
}, {
  f: 'Flux',
  sigle: 'Displacement',
  nom: 'Displacement',
  fr: 'déplacement',
  def: "Bougie au corps large (au moins 1,5 × ATR) : signature d'une entrée institutionnelle.",
  ou: "Ligne « Déplacements » du panneau « Structure calculée »"
}, {
  f: 'Flux',
  sigle: 'Kill zone',
  nom: 'Kill zone',
  fr: 'plage horaire active',
  def: "Créneaux où la liquidité est prise : Londres 7 h–10 h UTC, New York 12 h–15 h UTC.",
  ou: "Panneau « Structure calculée » (session en cours)"
}, {
  f: 'Risque',
  sigle: 'ATR',
  nom: 'Average True Range',
  fr: 'amplitude moyenne',
  def: "Amplitude moyenne sur 14 bougies. Sert à dimensionner l'invalidation et les objectifs.",
  ou: "Sous le graphique · base du stop réglable par stratégie"
}, {
  f: 'Risque',
  sigle: 'R',
  nom: 'Multiple de risque',
  fr: 'risque initial',
  def: "1 R = la distance entre l'entrée et l'invalidation. Un gain de 2 R vaut deux fois le risque pris.",
  ou: "Colonne RR du journal"
}, {
  f: 'Risque',
  sigle: 'RR',
  nom: 'Risk / Reward',
  fr: 'risque / gain',
  def: "Rapport entre la distance à l'objectif et la distance à l'invalidation, prévu puis réalisé.",
  ou: "Champ « R prévu » de chaque trade du journal"
}, {
  f: 'Moteur',
  sigle: 'Confluence',
  nom: 'Multi-timeframe alignment',
  fr: 'alignement multi-unités',
  def: "Les unités de temps doivent aller dans le même sens, sinon le signal reste « à surveiller ».",
  ou: "Panneau « Alignement des unités de temps »"
}, {
  f: 'Moteur',
  sigle: 'R1..R4',
  nom: 'Les quatre familles de règles',
  fr: 'règles du moteur',
  def: "R1 balayage · R2 rupture de structure · R3 zone réactive · R4 position dans le range. Une confirmation en exige deux.",
  ou: "Sélecteur de stratégie et verdict en direct"
}];
function Termes() {
  const [filtre, setFiltre] = useState('');
  const [famille, setFamille] = useState('Toutes');
  // Termes ajoutés par l'utilisateur : ils complètent le vocabulaire du moteur.
  const [persos, setPersos] = useState([]);
  const [concepts, setConcepts] = useState([]); // base de concepts du moteur (32)
  const [edition, setEdition] = useState(null);
  const [ouvert, setOuvert] = useState(false);
  const [form, setForm] = useState({
    sigle: '',
    nom: '',
    fr: '',
    famille: 'Autre',
    def: '',
    ou: ''
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // Deux sources : le lexique personnel (modifiable) et la base de concepts du
  // moteur — celle-la meme qui est injectee dans l'analyse IA avant qu'elle conclue.
  const charger = async () => {
    try {
      const d = await (await api('/termes')).json();
      if (d.success) setPersos(d.termes || []);
    } catch (e) {/* le lexique du moteur reste disponible */}
    try {
      const d = await (await api('/concepts')).json();
      if (d.success) setConcepts(d.concepts || []);
    } catch (e) {/* les termes du moteur restent affiches */}
  };
  useEffect(() => {
    charger();
  }, []);
  const VIDE = {
    sigle: '',
    nom: '',
    fr: '',
    famille: 'Autre',
    def: '',
    ou: ''
  };
  // Familles de la base de concepts, alignees sur celles du lexique.
  const CAT_FAMILLE = {
    structure: 'Structure',
    zones: 'Zones',
    liquidite: 'Liquidité',
    prix: 'Prix',
    temps: 'Temps',
    momentum: 'Momentum',
    base: 'Base',
    gestion: 'Risque'
  };
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
  const tous = [...LEXIQUE, ...duMoteur, ...persos.map(t => ({
    f: t.famille,
    sigle: t.sigle,
    nom: t.nom,
    fr: t.fr,
    def: t.def,
    ou: t.ou || 'terme ajouté par vous',
    id: t.id,
    perso: true
  }))];
  const familles = ['Toutes', ...new Set(tous.map(t => t.f))];
  const liste = tous.filter(t => (famille === 'Toutes' || t.f === famille) && (!filtre.trim() || `${t.sigle} ${t.nom} ${t.fr} ${t.def}`.toLowerCase().includes(filtre.toLowerCase())));
  const enregistrer = async () => {
    if (!form.sigle.trim() || !form.nom.trim()) {
      setErr('Le sigle et le nom complet sont requis');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const r = await api(edition && edition.id ? '/termes/' + edition.id : '/termes', {
        method: edition && edition.id ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(form)
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Enregistrement refusé');
      setEdition(null);
      setForm(VIDE);
      setOuvert(false);
      await charger();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const supprimer = async id => {
    try {
      await api('/termes/' + id, {
        method: 'DELETE'
      });
      await charger();
    } catch (e) {}
  };
  const ouvrirEdition = t => {
    setEdition(t);
    setOuvert(true);
    setErr('');
    setForm({
      sigle: t.sigle,
      nom: t.nom,
      fr: t.fr || '',
      famille: t.f || 'Autre',
      def: t.def || '',
      ou: t.ou || ''
    });
  };
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Reveal, null, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: '0 0 6px',
      fontSize: 22
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-graduation-cap",
    style: {
      color: '#60a5fa',
      marginRight: 10
    }
  }), "Termes"), /*#__PURE__*/React.createElement("p", {
    style: {
      color: 'var(--muted)',
      fontSize: 13.5,
      margin: '0 0 16px',
      maxWidth: 760
    }
  }, "Chaque terme indique ce que le moteur calcule r\xE9ellement et o\xF9 le voir. Les ", LEXIQUE.length, " termes du moteur sont \xE9valu\xE9s sur chaque graphique avant l'analyse ; ajoutez les v\xF4tres pour compl\xE9ter ce vocabulaire.")), /*#__PURE__*/React.createElement(Reveal, {
    delay: 60
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 10,
      flexWrap: 'wrap',
      alignItems: 'center',
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("input", {
    className: "fld",
    placeholder: "Rechercher un terme\u2026",
    value: filtre,
    onChange: e => setFiltre(e.target.value),
    style: {
      maxWidth: 260
    }
  }), familles.map(f => /*#__PURE__*/React.createElement("button", {
    key: f,
    onClick: () => setFamille(f),
    className: famille === f ? 'btn sm' : 'btn ghost sm'
  }, f)), /*#__PURE__*/React.createElement("button", {
    className: "btn sm",
    style: {
      marginLeft: 'auto'
    },
    onClick: () => {
      setEdition(null);
      setForm(VIDE);
      setErr('');
      setOuvert(o => !o);
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: `fas ${ouvert ? 'fa-xmark' : 'fa-plus'}`
  }), ouvert ? 'Fermer' : 'Ajouter un terme'))), ouvert && /*#__PURE__*/React.createElement(Reveal, null, /*#__PURE__*/React.createElement("div", {
    className: "panel",
    style: {
      padding: '14px 16px',
      marginBottom: 16,
      display: 'grid',
      gap: 9,
      borderColor: 'rgba(96,165,250,.35)'
    }
  }, /*#__PURE__*/React.createElement("b", {
    style: {
      fontSize: 13
    }
  }, edition ? `Modifier « ${edition.sigle} »` : 'Nouveau terme'), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 9,
      gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))'
    }
  }, /*#__PURE__*/React.createElement("label", {
    style: {
      fontSize: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      color: 'var(--muted)',
      marginBottom: 3
    }
  }, "Sigle *"), /*#__PURE__*/React.createElement("input", {
    className: "fld",
    value: form.sigle,
    maxLength: 24,
    onChange: e => setForm(f => ({
      ...f,
      sigle: e.target.value
    })),
    placeholder: "ex. IFVG"
  })), /*#__PURE__*/React.createElement("label", {
    style: {
      fontSize: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      color: 'var(--muted)',
      marginBottom: 3
    }
  }, "Nom complet *"), /*#__PURE__*/React.createElement("input", {
    className: "fld",
    value: form.nom,
    maxLength: 80,
    onChange: e => setForm(f => ({
      ...f,
      nom: e.target.value
    })),
    placeholder: "ex. Inverse Fair Value Gap"
  })), /*#__PURE__*/React.createElement("label", {
    style: {
      fontSize: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      color: 'var(--muted)',
      marginBottom: 3
    }
  }, "Nom fran\xE7ais"), /*#__PURE__*/React.createElement("input", {
    className: "fld",
    value: form.fr,
    maxLength: 60,
    onChange: e => setForm(f => ({
      ...f,
      fr: e.target.value
    })),
    placeholder: "ex. d\xE9s\xE9quilibre invers\xE9"
  })), /*#__PURE__*/React.createElement("label", {
    style: {
      fontSize: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      color: 'var(--muted)',
      marginBottom: 3
    }
  }, "Famille"), /*#__PURE__*/React.createElement("select", {
    className: "fld",
    "aria-label": "Famille de connaissance",
    value: form.famille,
    onChange: e => setForm(f => ({
      ...f,
      famille: e.target.value
    }))
  }, ['Structure', 'Zones', 'Prix', 'Flux', 'Risque', 'Moteur', 'Autre'].map(x => /*#__PURE__*/React.createElement("option", {
    key: x,
    value: x
  }, x))))), /*#__PURE__*/React.createElement("label", {
    style: {
      fontSize: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      color: 'var(--muted)',
      marginBottom: 3
    }
  }, "D\xE9finition"), /*#__PURE__*/React.createElement("textarea", {
    className: "fld",
    rows: 3,
    value: form.def,
    maxLength: 600,
    onChange: e => setForm(f => ({
      ...f,
      def: e.target.value
    })),
    placeholder: "Ce que ce terme signifie, et comment le reconna\xEEtre sur un graphique."
  })), /*#__PURE__*/React.createElement("label", {
    style: {
      fontSize: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      color: 'var(--muted)',
      marginBottom: 3
    }
  }, "O\xF9 le voir dans l'application"), /*#__PURE__*/React.createElement("input", {
    className: "fld",
    value: form.ou,
    maxLength: 200,
    onChange: e => setForm(f => ({
      ...f,
      ou: e.target.value
    })),
    placeholder: "ex. zone rep\xE9r\xE9e \xE0 la main sur le graphique"
  })), err && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: '#f87171'
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-circle-exclamation",
    style: {
      marginRight: 6
    }
  }), err), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn sm",
    onClick: enregistrer,
    disabled: busy
  }, busy ? '…' : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-check"
  }), " ", edition ? 'Enregistrer' : 'Ajouter')), /*#__PURE__*/React.createElement("button", {
    className: "btn ghost sm",
    onClick: () => {
      setOuvert(false);
      setEdition(null);
      setForm(VIDE);
      setErr('');
    }
  }, "Annuler")))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 10,
      gridTemplateColumns: 'repeat(auto-fit,minmax(330px,1fr))'
    }
  }, liste.map(t => /*#__PURE__*/React.createElement(Reveal, {
    key: t.id || t.sigle,
    delay: 40
  }, /*#__PURE__*/React.createElement("div", {
    className: "panel",
    style: {
      padding: '14px 16px',
      height: '100%'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'baseline',
      gap: 8,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("b", {
    style: {
      fontSize: 15,
      color: '#93c5fd'
    }
  }, t.sigle), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12.5,
      color: '#e2e8f0'
    }
  }, t.nom), /*#__PURE__*/React.createElement("span", {
    className: "tag",
    style: {
      fontSize: 10.5
    }
  }, t.f), t.perso && /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: 'auto',
      display: 'flex',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => ouvrirEdition(t),
    title: "Modifier",
    style: {
      background: 'none',
      border: 'none',
      color: '#60a5fa',
      cursor: 'pointer',
      fontSize: 12
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-pen"
  })), /*#__PURE__*/React.createElement("button", {
    onClick: () => supprimer(t.id),
    title: "Supprimer",
    style: {
      background: 'none',
      border: 'none',
      color: '#f87171',
      cursor: 'pointer',
      fontSize: 12
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-trash"
  })))), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: 'var(--dim)',
      margin: '3px 0 7px'
    }
  }, t.fr), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '0 0 8px',
      fontSize: 13,
      color: 'var(--muted)',
      lineHeight: 1.6
    }
  }, t.def), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11.5,
      color: t.perso ? '#93c5fd' : '#34d399'
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: `fas ${t.perso ? 'fa-user' : 'fa-location-dot'}`,
    style: {
      marginRight: 5
    }
  }), t.ou))))), !liste.length && /*#__PURE__*/React.createElement("p", {
    style: {
      color: 'var(--dim)',
      fontSize: 13
    }
  }, "Aucun terme ne correspond \xE0 \xAB ", filtre, " \xBB."));
}

/* ══════════════ DASHBOARD ══════════════ */

/* Outils : donne une page aux modules backend orphelins (calendrier,
   volume, corrélations, COT, taux, patterns, ML, order flow, anomalies,
   comptes, exports, backtest). Chaque panneau charge à la demande. */
const OUTILS_GET = [{
  id: 'dashboard',
  label: 'Tableau de bord',
  icon: 'fa-gauge-high',
  url: '/dashboard'
}, {
  id: 'volume-profile',
  label: 'Volume Profile',
  icon: 'fa-chart-column',
  url: '/volume-profile',
  params: ['symbol', 'tf']
}, {
  id: 'currency-strength',
  label: 'Force devises',
  icon: 'fa-money-bill-trend-up',
  url: '/currency-strength'
}, {
  id: 'london-breakout',
  label: 'London Breakout',
  icon: 'fa-arrow-right-from-bracket',
  url: '/london-breakout',
  params: ['symbol', 'tf']
}, {
  id: 'divergences',
  label: 'Divergences',
  icon: 'fa-code-branch',
  url: '/divergences',
  params: ['symbol', 'tf']
}, {
  id: 'dynamic-risk',
  label: 'Risque dynamique',
  icon: 'fa-sliders',
  url: '/dynamic-risk',
  params: ['symbol', 'tf']
}, {
  id: 'cot',
  label: 'COT Report',
  icon: 'fa-building-columns',
  url: '/cot',
  params: ['symbol']
}, {
  id: 'interest-rates',
  label: 'Taux d’intérêt',
  icon: 'fa-percent',
  url: '/interest-rates'
}, {
  id: 'patterns',
  label: 'Patterns',
  icon: 'fa-shapes',
  url: '/patterns',
  params: ['symbol', 'tf']
}, {
  id: 'signal-scoring',
  label: 'Score ML',
  icon: 'fa-brain',
  url: '/signal-scoring'
}, {
  id: 'order-flow',
  label: 'Order Flow',
  icon: 'fa-arrow-right-arrow-left',
  url: '/order-flow',
  params: ['symbol', 'tf']
}, {
  id: 'anomalies',
  label: 'Anomalies',
  icon: 'fa-triangle-exclamation',
  url: '/anomalies',
  params: ['symbol', 'tf']
},
// Analyse complète : rejoue le moteur sur tout l'historique et rend un tableau
// par famille de concepts ou par stratégie — avec DSR, PBO et hors échantillon.
{
  id: 'analyse-concepts',
  label: 'Tous les concepts',
  icon: 'fa-layer-group',
  url: '/analyse',
  params: ['symbol', 'tf'],
  group: 'concept'
}, {
  id: 'analyse-strategies',
  label: 'Toutes les stratégies',
  icon: 'fa-sitemap',
  url: '/analyse',
  params: ['symbol', 'tf'],
  group: 'strategie'
}];

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
    setChargement(true);
    setErreur('');
    try {
      const [m, r] = await Promise.all([api('/modele'), api('/risque')]);
      const dm = await m.json().catch(() => ({}));
      const dr = await r.json().catch(() => ({}));
      if (dm?.success === false) throw new Error(dm.error || 'modèle indisponible');
      setModele(dm?.success ? dm : null);
      setRisque(dr?.success ? dr : null);
      if (!dm?.success && !dr?.success) throw new Error(dm?.error || dr?.error || 'réponse vide');
    } catch (e) {
      setErreur(e.message);
    } finally {
      setChargement(false);
    }
  };
  useEffect(() => {
    charger();
  }, []);
  const bloc = (titre, icone, children) => /*#__PURE__*/React.createElement("div", {
    className: "panel",
    style: {
      padding: '14px 16px',
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 9,
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: `fas ${icone}`,
    style: {
      color: '#60a5fa'
    }
  }), /*#__PURE__*/React.createElement("b", {
    style: {
      fontSize: 13,
      color: '#fff'
    }
  }, titre)), children);
  const ligne = (label, valeur, teinte) => /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      gap: 12,
      padding: '4px 0',
      fontSize: 12.5
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--muted)'
    }
  }, label), /*#__PURE__*/React.createElement("span", {
    style: {
      color: teinte || 'var(--txt)',
      fontWeight: 600
    }
  }, valeur));
  if (chargement) return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 20,
      color: 'var(--muted)'
    }
  }, "Chargement de l'\xE9tat du syst\xE8me\u2026");
  if (erreur) return /*#__PURE__*/React.createElement("div", {
    className: "panel",
    style: {
      padding: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      color: '#f87171',
      fontSize: 13,
      marginBottom: 8
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-triangle-exclamation",
    style: {
      marginRight: 8
    }
  }), erreur), /*#__PURE__*/React.createElement("button", {
    className: "btn-ghost",
    onClick: charger,
    style: {
      fontSize: 12
    }
  }, "R\xE9essayer"));
  const m = modele?.modele || {};
  const cal = modele?.calibration;
  const et = risque?.etat || {};
  const pl = et.plafonds || {};
  const sim = risque?.simulation || {};
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "panel",
    style: {
      padding: '12px 16px',
      marginBottom: 14,
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-shield-halved",
    style: {
      color: '#c4b5fd'
    }
  }), /*#__PURE__*/React.createElement("b", {
    style: {
      fontSize: 13,
      color: '#fff'
    }
  }, "Syst\xE8me"), /*#__PURE__*/React.createElement("span", {
    className: "badge",
    style: {
      fontSize: 10,
      background: 'rgba(167,139,250,.13)',
      color: '#c4b5fd'
    }
  }, "mod\xE8le v", m.version || '?'), m.marches && /*#__PURE__*/React.createElement("span", {
    className: "badge",
    style: {
      fontSize: 10,
      background: 'rgba(96,165,250,.13)',
      color: '#93c5fd'
    }
  }, m.marches.join(' · ')), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: '1 1 auto'
    }
  }), /*#__PURE__*/React.createElement("button", {
    className: "btn-ghost",
    onClick: charger,
    style: {
      fontSize: 11.5
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-rotate",
    style: {
      marginRight: 6
    }
  }), "rafra\xEEchir")), modele && bloc('Modèle — R attendu', 'fa-brain', /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 24,
      flexWrap: 'wrap',
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 190
    }
  }, ligne('Arbres', m.arbres ?? '—'), ligne('Features mesurées', m.features ?? '—'), ligne('Seuil appliqué', `${modele.seuilApplique} R`), ligne('Seuil du décile', `${modele.seuilTop10} R`)), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: '1 1 260px',
      fontSize: 11.5,
      color: 'var(--dim)',
      lineHeight: 1.5
    }
  }, "Le mod\xE8le note chaque signal en R attendu, \xE0 partir de 6 mois d'historique. Il ne remplace pas les r\xE8gles : il refuse ce dont l'esp\xE9rance est n\xE9gative et laisse le reste au jugement. Un seuil \xE0 0 ne refuse que le n\xE9gatif ; le d\xE9cile est la s\xE9lection la plus stricte valid\xE9e.")), !cal && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: 'var(--muted)',
      padding: '8px 10px',
      borderRadius: 8,
      background: 'rgba(148,163,184,.05)'
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-hourglass-half",
    style: {
      marginRight: 7
    }
  }), "Pas encore assez de trades not\xE9s pour mesurer la calibration (20 minimum). C'est normal au d\xE9marrage : la promesse du mod\xE8le se v\xE9rifie sur les trades tranch\xE9s, pas sur son pass\xE9 d'entra\xEEnement."), cal && /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      marginBottom: 8,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "badge",
    style: {
      fontSize: 10,
      background: cal.monotone ? 'rgba(34,211,138,.14)' : 'rgba(242,84,91,.14)',
      color: cal.monotone ? '#34d399' : '#f87171'
    }
  }, cal.monotone ? 'le modèle trie' : 'le modèle ne trie plus'), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11.5,
      color: 'var(--muted)'
    }
  }, cal.trades, " trade(s) not\xE9(s) \xB7 biais moyen ", cal.biaisMoyen, " R")), /*#__PURE__*/React.createElement("div", {
    style: {
      overflowX: 'auto'
    }
  }, /*#__PURE__*/React.createElement("table", {
    style: {
      width: '100%',
      borderCollapse: 'collapse',
      fontSize: 11.5
    }
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", {
    style: {
      color: 'var(--dim)',
      textAlign: 'left'
    }
  }, /*#__PURE__*/React.createElement("th", {
    style: {
      padding: '4px 8px',
      fontWeight: 500
    }
  }, "tranche"), /*#__PURE__*/React.createElement("th", {
    style: {
      padding: '4px 8px',
      fontWeight: 500
    }
  }, "n"), /*#__PURE__*/React.createElement("th", {
    style: {
      padding: '4px 8px',
      fontWeight: 500
    }
  }, "R annonc\xE9"), /*#__PURE__*/React.createElement("th", {
    style: {
      padding: '4px 8px',
      fontWeight: 500
    }
  }, "R r\xE9el"), /*#__PURE__*/React.createElement("th", {
    style: {
      padding: '4px 8px',
      fontWeight: 500
    }
  }, "biais"), /*#__PURE__*/React.createElement("th", {
    style: {
      padding: '4px 8px',
      fontWeight: 500
    }
  }, "r\xE9ussite"))), /*#__PURE__*/React.createElement("tbody", null, cal.tranches.map(t => /*#__PURE__*/React.createElement("tr", {
    key: t.rang,
    style: {
      borderTop: '1px solid rgba(148,163,184,.12)'
    }
  }, /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '4px 8px',
      color: 'var(--muted)'
    }
  }, t.rang), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '4px 8px'
    }
  }, t.n), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '4px 8px',
      color: '#93c5fd'
    }
  }, t.rAttenduMoyen), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '4px 8px',
      color: t.rReelMoyen >= 0 ? '#34d399' : '#f87171'
    }
  }, t.rReelMoyen), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '4px 8px',
      color: 'var(--dim)'
    }
  }, t.biais), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '4px 8px',
      color: 'var(--dim)'
    }
  }, t.tauxReussite ?? '—', " %")))))), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: 'var(--dim)',
      marginTop: 6
    }
  }, cal.lecture)))), risque && bloc('Risque — compte simulé', 'fa-scale-balanced', /*#__PURE__*/React.createElement("div", null, et.positionsOuvertes > (pl.maxSimultanes || 0) && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: '#fbbf24',
      padding: '8px 10px',
      borderRadius: 8,
      background: 'rgba(245,158,11,.08)',
      border: '1px solid rgba(245,158,11,.25)',
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-lock",
    style: {
      marginRight: 7
    }
  }), "Livre au-del\xE0 du plafond : ", et.positionsOuvertes, " positions ouvertes pour", ' ', pl.maxSimultanes, " autoris\xE9es. ", /*#__PURE__*/React.createElement("b", null, "Toute nouvelle prise est bloqu\xE9e"), ' ', "jusqu'\xE0 ce que des positions se cl\xF4turent (60 bougies maximum). C'est le garde-fou qui fonctionne, pas une panne."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 26,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 220
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: 'var(--dim)',
      marginBottom: 2
    }
  }, "Performance simul\xE9e \u2014 plafonds appliqu\xE9s"), ligne('Capital', `${sim.capital} (${sim.gainPct >= 0 ? '+' : ''}${sim.gainPct} %)`, sim.gainPct >= 0 ? '#34d399' : '#f87171'), ligne('Drawdown max', `${sim.drawdownPct} %`, '#fbbf24'), ligne('Trades pris', `${sim.prises} / ${sim.tradesJournal}`), ligne('Refusés par les plafonds', sim.refusees, '#fbbf24')), /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 200
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: 'var(--dim)',
      marginBottom: 2
    }
  }, "Livre courant \u2014 maintenant"), ligne('Positions ouvertes', `${et.positionsOuvertes ?? 0} / ${pl.maxSimultanes ?? '—'}`), ligne('Risque engagé', `${et.risqueEngage} (${et.risqueEngagePct} %)`), ligne('Exposition', `${et.expositionTotale} · levier ${et.levier}×`), ligne('Perte du jour', `${et.perteJourPct} %`, et.perteJourPct >= (pl.maxPerteJourPct || 0) ? '#f87171' : 'var(--txt)')), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: '1 1 240px',
      fontSize: 11.5,
      color: 'var(--dim)',
      lineHeight: 1.5
    }
  }, "La taille se d\xE9duit du risque, pas l'inverse : un stop large donne une petite position. Les plafonds (perte du jour, positions simultan\xE9es, risque par march\xE9, levier) bloquent AVANT la prise, avec le chiffre qui explique le refus. Aucun ordre n'est pass\xE9 : c'est la simulation de ce que le journal aurait donn\xE9.", sim.naif && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 8,
      color: '#fbbf24'
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-circle-info",
    style: {
      marginRight: 6
    }
  }), "Sans plafonds, le m\xEAme journal afficherait ", sim.naif.gainPct >= 0 ? '+' : '', sim.naif.gainPct, " % \u2014 ce chiffre n'est pas atteignable : il compte des trades que le compte n'aurait pas pris."))), et.risqueParMarche && Object.keys(et.risqueParMarche).length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 10,
      fontSize: 11.5
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      color: 'var(--dim)',
      marginBottom: 4
    }
  }, "Risque engag\xE9 par march\xE9"), Object.entries(et.risqueParMarche).map(([sym, val]) => /*#__PURE__*/React.createElement("div", {
    key: sym,
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      padding: '3px 0',
      borderTop: '1px solid rgba(148,163,184,.1)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--muted)'
    }
  }, sym), /*#__PURE__*/React.createElement("span", null, val)))))));
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
    return () => {
      vivant = false;
    };
  }, []);
  const appliquerPreset = async nom => {
    try {
      setMessagePreset('Application…');
      const r = await api('/risque/preset', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          nom
        })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.success) throw new Error(d.error || 'HTTP ' + r.status);
      setPresetChoisi(d);
      setMessagePreset(`Appliqué : ${d.titre} — ${d.configuration.risquePct} % par trade · ` + `${d.configuration.maxSimultanes} positions`);
    } catch (e) {
      setMessagePreset('Échec : ' + e.message);
    }
  };
  const chargerComptes = async () => {
    try {
      const r = await api('/accounts');
      const d = await r.json();
      if (d?.success) setComptes(d.comptes || d.accounts || []);
    } catch {}
  };
  useEffect(() => {
    chargerComptes();
  }, []);
  const appeler = async (url, options) => {
    setChargement(true);
    setErreur('');
    setData(null);
    try {
      const r = await api(url, options);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || 'HTTP ' + r.status);
      setData(d);
    } catch (e) {
      setErreur(e.message);
    } finally {
      setChargement(false);
    }
  };
  const charger = async () => {
    const o = OUTILS_GET.find(x => x.id === outil);
    if (!o) return;
    const q = new URLSearchParams();
    if ((o.params || []).includes('symbol')) q.set('symbol', symbol);
    if ((o.params || []).includes('tf')) q.set('tf', tf);
    // L'analyse coûte cher (tout l'historique) : on borne et on le dit.
    if (o.group) {
      q.set('group', o.group);
      q.set('bougies', '2500');
      q.set('pas', '4');
      if (sourcesOutil !== 'toutes') {
        q.set('sources', sourcesOutil === 'motifs' ? 'motif,structure' : 'motif');
      }
      if (filtreTendance === 'tendance') q.set('regime', '1');
    }
    appeler(o.url + (q.toString() ? '?' + q.toString() : ''));
  };
  const lancerBacktest = () => appeler('/backtest', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      symbol,
      tf,
      riskPct: 1,
      initialCapital: 10000
    })
  });
  const creerCompte = async () => {
    if (!nomCompte.trim()) return;
    try {
      const r = await api('/accounts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          nom: nomCompte.trim(),
          capital: Number(capitalCompte) || 10000
        })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || 'HTTP ' + r.status);
      setNomCompte('');
      chargerComptes();
    } catch (e) {
      setErreur(e.message);
    }
  };
  const supprimerCompte = async id => {
    try {
      await api(`/accounts/${encodeURIComponent(id)}`, {
        method: 'DELETE'
      });
      chargerComptes();
    } catch (e) {
      setErreur(e.message);
    }
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "panel",
    style: {
      padding: 18
    }
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: '0 0 10px'
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-toolbox"
  }), " Modules d'analyse"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      flexWrap: 'wrap',
      alignItems: 'end'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "lbl"
  }, "Module"), /*#__PURE__*/React.createElement("select", {
    className: "fld",
    "aria-label": "Outil \xE0 ex\xE9cuter",
    value: outil,
    onChange: e => {
      setOutil(e.target.value);
      setData(null);
      setErreur('');
    }
  }, OUTILS_GET.map(o => /*#__PURE__*/React.createElement("option", {
    key: o.id,
    value: o.id
  }, o.label)))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "lbl"
  }, "Symbole"), /*#__PURE__*/React.createElement("input", {
    className: "fld",
    "aria-label": "Symbole analys\xE9",
    value: symbol,
    onChange: e => setSymbol(e.target.value.toUpperCase()),
    style: {
      width: 130
    }
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "lbl"
  }, "Unit\xE9"), /*#__PURE__*/React.createElement("select", {
    className: "fld",
    "aria-label": "Unit\xE9 de temps de l'outil",
    value: tf,
    onChange: e => setTf(e.target.value)
  }, ['1m', '5m', '15m', '1h', '4h', '1d'].map(t => /*#__PURE__*/React.createElement("option", {
    key: t,
    value: t
  }, t)))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "lbl"
  }, "Sources"), /*#__PURE__*/React.createElement("select", {
    className: "fld",
    "aria-label": "Sources de signaux analys\xE9es",
    value: sourcesOutil,
    onChange: e => setSourcesOutil(e.target.value)
  }, /*#__PURE__*/React.createElement("option", {
    value: "toutes"
  }, "Toutes"), /*#__PURE__*/React.createElement("option", {
    value: "motifs"
  }, "Sans les strat\xE9gies"), /*#__PURE__*/React.createElement("option", {
    value: "motifs-structure"
  }, "Motifs + structure"))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "lbl"
  }, "Tendance"), /*#__PURE__*/React.createElement("select", {
    className: "fld",
    "aria-label": "Filtre de tendance",
    value: filtreTendance,
    onChange: e => setFiltreTendance(e.target.value)
  }, /*#__PURE__*/React.createElement("option", {
    value: "aucun"
  }, "Aucun filtre"), /*#__PURE__*/React.createElement("option", {
    value: "tendance"
  }, "Suivre la tendance"))), /*#__PURE__*/React.createElement("button", {
    className: "btn",
    onClick: charger,
    disabled: chargement
  }, chargement ? 'Chargement…' : 'Charger'), /*#__PURE__*/React.createElement("button", {
    className: "btn ghost",
    onClick: lancerBacktest,
    disabled: chargement
  }, "Backtest")), erreur && /*#__PURE__*/React.createElement("div", {
    style: {
      color: 'var(--bad)',
      marginTop: 10,
      fontSize: 13
    }
  }, erreur), data && Array.isArray(data.lignes) && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 14,
      flexWrap: 'wrap',
      alignItems: 'baseline',
      fontSize: 12.5,
      color: 'var(--muted)'
    }
  }, /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("b", {
    style: {
      color: 'var(--txt)'
    }
  }, data.symbol), " ", data.tf), /*#__PURE__*/React.createElement("span", null, data.bougies, " bougies \xB7 ", data.trades, " trades"), /*#__PURE__*/React.createElement("span", null, data.lignes.length, " famille(s)"), /*#__PURE__*/React.createElement("span", null, "esp\xE9rance ", /*#__PURE__*/React.createElement("b", {
    style: {
      color: data.esperance >= 0 ? 'var(--ok)' : 'var(--bad)'
    }
  }, data.esperance >= 0 ? '+' : '', data.esperance, " R")), /*#__PURE__*/React.createElement("span", null, "total ", /*#__PURE__*/React.createElement("b", null, data.totalR, " R")), /*#__PURE__*/React.createElement("span", null, "PBO ", /*#__PURE__*/React.createElement("b", {
    style: {
      color: data.pbo > 0.5 ? 'var(--bad)' : 'var(--ok)'
    }
  }, data.pbo === null ? 'n/a' : (data.pbo * 100).toFixed(1) + ' %')), /*#__PURE__*/React.createElement("span", null, "essais ", data.essais), data.frais && data.frais.prudent && /*#__PURE__*/React.createElement("span", {
    style: {
      color: '#fbbf24'
    }
  }, "frais inclus : spread ", data.frais.spread, " + glissement ", data.frais.glissement), data.parSource && Object.entries(data.parSource).map(([src, v]) => /*#__PURE__*/React.createElement("span", {
    key: src,
    style: {
      color: v.r / v.total >= 0 ? 'var(--ok)' : 'var(--bad)'
    }
  }, src, " ", (v.r / v.total).toFixed(3), " R sur ", v.total)), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--dim)'
    }
  }, data.source)), data.synthetique && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 8,
      fontSize: 11.5,
      padding: '7px 10px',
      borderRadius: 7,
      background: 'rgba(239,68,68,.08)',
      border: '1px solid rgba(239,68,68,.35)',
      color: '#fca5a5'
    }
  }, /*#__PURE__*/React.createElement("b", null, "Instrument synth\xE9tique."), " ", data.avertissement), /*#__PURE__*/React.createElement("div", {
    tabIndex: 0,
    role: "region",
    "aria-label": "Analyse par famille",
    style: {
      marginTop: 10,
      maxHeight: 420,
      overflow: 'auto'
    }
  }, /*#__PURE__*/React.createElement("table", {
    style: {
      width: '100%',
      borderCollapse: 'collapse',
      fontSize: 12
    }
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", {
    style: {
      color: 'var(--muted)',
      textAlign: 'right'
    }
  }, /*#__PURE__*/React.createElement("th", {
    style: {
      textAlign: 'left',
      padding: '6px 8px'
    }
  }, "Famille"), /*#__PURE__*/React.createElement("th", null, "trades"), /*#__PURE__*/React.createElement("th", null, "total R"), /*#__PURE__*/React.createElement("th", null, "esp\xE9rance"), /*#__PURE__*/React.createElement("th", null, "1re moiti\xE9"), /*#__PURE__*/React.createElement("th", null, "2e moiti\xE9"), /*#__PURE__*/React.createElement("th", null, "Sharpe"), /*#__PURE__*/React.createElement("th", null, "PSR"), /*#__PURE__*/React.createElement("th", null, "survit"))), /*#__PURE__*/React.createElement("tbody", null, data.lignes.map(l => /*#__PURE__*/React.createElement("tr", {
    key: l.nom,
    style: {
      borderTop: '1px solid var(--border)'
    }
  }, /*#__PURE__*/React.createElement("td", {
    style: {
      textAlign: 'left',
      padding: '6px 8px'
    }
  }, l.nom), /*#__PURE__*/React.createElement("td", {
    style: {
      textAlign: 'right'
    }
  }, l.n), /*#__PURE__*/React.createElement("td", {
    style: {
      textAlign: 'right'
    }
  }, l.totalR), /*#__PURE__*/React.createElement("td", {
    style: {
      textAlign: 'right',
      color: l.esperance >= 0 ? 'var(--ok)' : 'var(--bad)'
    }
  }, l.esperance >= 0 ? '+' : '', l.esperance), /*#__PURE__*/React.createElement("td", {
    style: {
      textAlign: 'right',
      color: (l.is ?? 0) >= 0 ? 'var(--muted)' : 'var(--bad)'
    }
  }, l.is ?? '—'), /*#__PURE__*/React.createElement("td", {
    style: {
      textAlign: 'right',
      color: (l.oos ?? 0) >= 0 ? 'var(--muted)' : 'var(--bad)'
    }
  }, l.oos ?? '—'), /*#__PURE__*/React.createElement("td", {
    style: {
      textAlign: 'right'
    }
  }, l.sharpe), /*#__PURE__*/React.createElement("td", {
    style: {
      textAlign: 'right'
    }
  }, l.psr ?? '—'), /*#__PURE__*/React.createElement("td", {
    style: {
      textAlign: 'center'
    }
  }, l.survit ? /*#__PURE__*/React.createElement("span", {
    className: "badge",
    style: {
      background: 'rgba(16,185,129,.15)',
      color: 'var(--ok)'
    }
  }, "oui") : /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--dim)'
    }
  }, "non"))))))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      marginTop: 10,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("a", {
    className: "btn ghost sm",
    href: `/api/export/analyse.csv?symbol=${encodeURIComponent(data.symbol)}&tf=${data.tf}&group=${data.group}&bougies=2500&pas=4`
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-file-csv"
  }), " CSV de cette analyse"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11.5,
      color: 'var(--dim)',
      alignSelf: 'center'
    }
  }, "\xAB survit \xBB = PSR au-dessus du seuil de s\xE9lection, donc l'avantage ne s'explique pas par le nombre d'essais. \xAB 1re / 2e moiti\xE9 \xBB = r\xE9gularit\xE9 dans le temps."))), data && data.statut && /*#__PURE__*/React.createElement("div", {
    className: "panel",
    style: {
      marginTop: 12,
      padding: 16
    }
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: '0 0 8px',
      fontSize: 14
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-brain",
    style: {
      marginRight: 8,
      color: '#a78bfa'
    }
  }), "Scoring ML \u2014 ", data.statut === 'entraîné' ? 'modèle entraîné' : 'aucun modèle entraîné'), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 6,
      fontSize: 12.5
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      color: 'var(--muted)'
    }
  }, "Trades cl\xF4tur\xE9s : ", /*#__PURE__*/React.createElement("b", {
    style: {
      color: '#fff'
    }
  }, data.tradesClotures), ' ', "\xB7 minimum requis : ", /*#__PURE__*/React.createElement("b", {
    style: {
      color: '#fff'
    }
  }, data.minimumRequis), ' ', "(5 trades par param\xE8tre \xD7 6)"), data.avertissement && /*#__PURE__*/React.createElement("div", {
    style: {
      color: '#fbbf24',
      padding: '7px 10px',
      borderRadius: 7,
      background: 'rgba(245,158,11,.09)',
      border: '1px solid rgba(245,158,11,.3)'
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-triangle-exclamation",
    style: {
      marginRight: 7
    }
  }), data.avertissement), /*#__PURE__*/React.createElement("div", {
    style: {
      color: 'var(--muted)'
    }
  }, "Mesure hors \xE9chantillon :", ' ', data.horsEchantillon && data.horsEchantillon.valide ? /*#__PURE__*/React.createElement("b", {
    style: {
      color: '#6ee7b7'
    }
  }, Math.round(data.horsEchantillon.metrics.accuracy * 100), " % d'exactitude sur ", data.horsEchantillon.test, " trades jamais vus", ' ', "(F1 ", data.horsEchantillon.metrics.f1, ")") : /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--dim)'
    }
  }, "non calculable \u2014 ", data.horsEchantillon ? data.horsEchantillon.raison : 'données insuffisantes')), data.appliqueAuxDecisions === false && /*#__PURE__*/React.createElement("div", {
    style: {
      color: 'var(--dim)',
      fontSize: 11.5
    }
  }, "Ce score ne pond\xE8re encore aucune d\xE9cision : il est mesur\xE9, pas appliqu\xE9."))), data && !Array.isArray(data.lignes) && /*#__PURE__*/React.createElement("pre", {
    style: {
      marginTop: 12,
      maxHeight: 420,
      overflow: 'auto'
    }
  }, JSON.stringify(data, null, 2))), /*#__PURE__*/React.createElement("div", {
    className: "panel",
    style: {
      padding: 18
    }
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: '0 0 4px'
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-sliders"
  }), " R\xE9glages mesur\xE9s"), /*#__PURE__*/React.createElement("div", {
    style: {
      color: 'var(--dim)',
      fontSize: 12,
      marginBottom: 12
    }
  }, "8 indices + or, argent, cuivre, coton, caf\xE9 \xB7 quotidien \xB7 frais et glissement inclus"), presets.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      color: 'var(--muted)',
      fontSize: 13
    }
  }, "Chargement\u2026"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 10,
      gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))'
    }
  }, presets.map(p => /*#__PURE__*/React.createElement("div", {
    key: p.nom,
    style: {
      border: '1px solid var(--border)',
      borderRadius: 10,
      padding: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 600,
      fontSize: 13,
      marginBottom: 4
    }
  }, p.titre), /*#__PURE__*/React.createElement("div", {
    style: {
      color: 'var(--dim)',
      fontSize: 12,
      marginBottom: 8
    }
  }, p.mesure), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 6,
      flexWrap: 'wrap',
      alignItems: 'center',
      marginBottom: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "tag"
  }, p.risquePct, " % / trade"), /*#__PURE__*/React.createElement("span", {
    className: "tag"
  }, p.maxSimultanes, " positions"), p.regime && /*#__PURE__*/React.createElement("span", {
    className: "tag"
  }, "filtre de tendance"), p.sources && /*#__PURE__*/React.createElement("span", {
    className: "tag"
  }, p.sources.join(' + '))), /*#__PURE__*/React.createElement("button", {
    className: "btn",
    onClick: () => appliquerPreset(p.nom)
  }, "Appliquer")))), messagePreset && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 10,
      fontSize: 12,
      color: messagePreset.startsWith('Échec') ? 'var(--bad)' : 'var(--ok)'
    }
  }, messagePreset), presetChoisi && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 6,
      fontSize: 12,
      color: 'var(--dim)'
    }
  }, "Sources \xE0 passer au backtest : ", /*#__PURE__*/React.createElement("b", null, presetChoisi.sources ? presetChoisi.sources.join(', ') : 'toutes'), ' · ', "filtre de tendance : ", /*#__PURE__*/React.createElement("b", null, presetChoisi.regime ? 'actif' : 'inactif'))), /*#__PURE__*/React.createElement("div", {
    className: "panel",
    style: {
      padding: 18
    }
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: '0 0 10px'
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-wallet"
  }), " Comptes"), comptes.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      color: 'var(--muted)',
      fontSize: 13
    }
  }, "Aucun compte."), comptes.map(c => /*#__PURE__*/React.createElement("div", {
    key: c.id,
    style: {
      display: 'flex',
      gap: 8,
      alignItems: 'center',
      padding: '6px 0',
      borderBottom: '1px solid var(--border)'
    }
  }, /*#__PURE__*/React.createElement("strong", null, c.nom), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--muted)',
      fontSize: 13
    }
  }, c.capital, " ", c.devise || 'USD'), /*#__PURE__*/React.createElement("button", {
    className: "btn ghost sm",
    onClick: () => supprimerCompte(c.id)
  }, "Supprimer"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      marginTop: 10,
      flexWrap: 'wrap',
      alignItems: 'end'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "lbl"
  }, "Nom"), /*#__PURE__*/React.createElement("input", {
    className: "fld",
    value: nomCompte,
    onChange: e => setNomCompte(e.target.value),
    placeholder: "Compte d\xE9mo"
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "lbl"
  }, "Capital"), /*#__PURE__*/React.createElement("input", {
    className: "fld",
    value: capitalCompte,
    onChange: e => setCapitalCompte(e.target.value),
    style: {
      width: 120
    }
  })), /*#__PURE__*/React.createElement("button", {
    className: "btn ghost",
    onClick: creerCompte
  }, "Cr\xE9er"))), /*#__PURE__*/React.createElement("div", {
    className: "panel",
    style: {
      padding: 18
    }
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: '0 0 10px'
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-download"
  }), " Exports"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("a", {
    className: "btn ghost sm",
    href: "/api/export/pdf"
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-file-lines"
  }), " Rapport HTML"), /*#__PURE__*/React.createElement("a", {
    className: "btn ghost sm",
    href: "/api/export/csv"
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-file-csv"
  }), " Journal CSV (mes trades)"), /*#__PURE__*/React.createElement("a", {
    className: "btn ghost sm",
    href: "/api/export/csv?source=signaux"
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-microchip"
  }), " Signaux CSV (moteur)")), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '10px 0 0',
      fontSize: 11.5,
      color: 'var(--dim)'
    }
  }, "\xAB Mes trades \xBB = ce que vous avez saisi. \xAB Signaux \xBB = ce que le moteur a d\xE9tect\xE9, avec une ligne par signal et une colonne par mesure (24 colonnes).")));
}

/* ══════════════ PILOTE IA — chat qui pilote le système ══════════════ */
// Une seule page de conversation, avec des bulles, qui exécute réellement les
// commandes du chat-crud : lecture (trades, stratégies, scénarios, paramètres,
// mémoire, apprentissage, état), et écriture (créer, modifier, activer,
// désactiver, supprimer) avec confirmation « oui/non » avant toute action
// destructive. Rien n'est simulé ici : chaque bulle vient de /api/chat.

const PILOTE_RACCOURCIS = [{
  l: "État du système",
  t: "montre l'état du système"
}, {
  l: 'Trades',
  t: 'montre les trades'
}, {
  l: 'Stratégies',
  t: 'montre les stratégies'
}, {
  l: 'Scénarios',
  t: 'montre les scénarios en attente'
}, {
  l: 'Paramètres',
  t: 'montre les paramètres'
}, {
  l: 'Mémoire',
  t: "qu'est-ce que tu sais"
}, {
  l: 'Apprentissage',
  t: "qu'est-ce que tu as appris cette semaine ?"
}, {
  l: 'Aide',
  t: 'aide'
}];
const piloteHeure = iso => {
  const d = iso ? new Date(iso) : new Date();
  return d.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit'
  });
};
function Pilote() {
  const [messages, setMessages] = useState([]);
  const [saisie, setSaisie] = useState('');
  const [busy, setBusy] = useState(false);
  const [etat, setEtat] = useState('connexion'); // connexion | en ligne | hors ligne
  const [erreur, setErreur] = useState('');
  const filRef = useRef(null);
  const champRef = useRef(null);
  const descendre = () => {
    const el = filRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };
  useEffect(() => {
    let vivant = true;
    (async () => {
      try {
        const r = await api('/chat/historique?limite=80');
        if (r.status === 401) {
          if (vivant) setEtat('hors ligne');
          return;
        }
        const d = await r.json();
        if (!vivant) return;
        if (!d.messages || !d.messages.length) {
          setMessages([{
            role: 'assistant',
            texte: "Bonjour. Je pilote le système : je lis l'état, les trades, les stratégies, " + 'les scénarios, les paramètres, la mémoire et l\'apprentissage — et je peux créer, ' + 'modifier, activer, désactiver ou supprimer, après confirmation.\n' + 'Tape « aide » pour la liste des commandes.',
            heure: piloteHeure()
          }]);
        } else {
          setMessages(d.messages.map(m => ({
            role: m.role,
            texte: m.texte,
            heure: piloteHeure(m.creeAt),
            action: m.action
          })));
        }
        setEtat('en ligne');
      } catch (e) {
        if (vivant) setEtat('hors ligne');
      }
    })();
    return () => {
      vivant = false;
    };
  }, []);
  useEffect(descendre, [messages, busy]);
  const envoyer = async texte => {
    const t = String(texte || '').trim();
    if (!t || busy) return;
    setErreur('');
    setSaisie('');
    setMessages(m => [...m, {
      role: 'user',
      texte: t,
      heure: piloteHeure()
    }]);
    setBusy(true);
    try {
      const r = await api('/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: t
        })
      });
      const d = await r.json();
      const reponse = d.texte || d.resultat && d.resultat.texte || d.error || (d.success ? 'Action exécutée.' : 'Réponse vide.');
      setMessages(m => [...m, {
        role: 'assistant',
        texte: reponse,
        heure: piloteHeure(),
        action: d.action
      }]);
      // Une écriture a réussi : les autres onglets doivent relire leurs données.
      if (d.success && d.action && !/Confirmer \? \(oui\/non\)/i.test(reponse)) {
        window.dispatchEvent(new Event('5trade-refresh'));
      }
      setEtat('en ligne');
    } catch (e) {
      setMessages(m => [...m, {
        role: 'assistant',
        texte: 'Erreur réseau : ' + e.message,
        heure: piloteHeure()
      }]);
      setEtat('hors ligne');
    } finally {
      setBusy(false);
      if (champRef.current) champRef.current.focus();
    }
  };
  const effacer = async () => {
    if (busy) return;
    if (!window.confirm('Effacer tout l’historique de conversation ?')) return;
    try {
      await api('/chat/historique', {
        method: 'DELETE'
      });
      setMessages([{
        role: 'assistant',
        texte: 'Historique effacé.',
        heure: piloteHeure()
      }]);
      setErreur('');
    } catch (e) {
      setErreur('Effacement impossible : ' + e.message);
    }
  };
  const point = etat === 'en ligne' ? 'var(--ok)' : etat === 'hors ligne' ? 'var(--bad)' : 'var(--warn)';
  return /*#__PURE__*/React.createElement("div", {
    className: "panel",
    style: {
      padding: 0,
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '14px 18px',
      borderBottom: '1px solid var(--border)',
      background: 'var(--panel2)',
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 34,
      height: 34,
      borderRadius: 10,
      background: 'var(--accent)',
      color: '#fff',
      display: 'grid',
      placeItems: 'center',
      fontWeight: 800,
      fontSize: 14
    }
  }, "5"), /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 650,
      letterSpacing: '-.01em'
    }
  }, "Pilote IA"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: 'var(--muted)'
    }
  }, "Supervision \xB7 diagnostic \xB7 administration \u2014 commandes en langage naturel")), /*#__PURE__*/React.createElement("div", {
    style: {
      marginLeft: 'auto',
      display: 'flex',
      alignItems: 'center',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 7,
      fontSize: 12,
      color: 'var(--muted)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 7,
      height: 7,
      borderRadius: '50%',
      background: point
    }
  }), etat), /*#__PURE__*/React.createElement("button", {
    className: "btn ghost sm",
    onClick: effacer,
    disabled: busy
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-eraser"
  }), "Effacer"))), /*#__PURE__*/React.createElement("div", {
    ref: filRef,
    "aria-live": "polite",
    style: {
      flex: 1,
      minHeight: 380,
      maxHeight: 'calc(100vh - 330px)',
      overflowY: 'auto',
      padding: '20px 18px 10px',
      background: 'var(--bg)'
    }
  }, messages.map((m, i) => {
    const moi = m.role === 'user';
    const confirmation = !moi && /Confirmer \? \(oui\/non\)/i.test(m.texte || '');
    return /*#__PURE__*/React.createElement("div", {
      key: i,
      style: {
        display: 'flex',
        gap: 10,
        marginBottom: 14,
        flexDirection: moi ? 'row-reverse' : 'row',
        alignItems: 'flex-start'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        width: 28,
        height: 28,
        borderRadius: 8,
        flex: '0 0 auto',
        display: 'grid',
        placeItems: 'center',
        fontSize: 12,
        fontWeight: 700,
        background: moi ? 'var(--accent)' : 'var(--panel2)',
        color: moi ? '#fff' : 'var(--muted)',
        border: moi ? '1px solid transparent' : '1px solid var(--border)'
      }
    }, moi ? 'M' : '5'), /*#__PURE__*/React.createElement("div", {
      style: {
        maxWidth: 'min(720px, 80%)'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        padding: '11px 14px',
        borderRadius: 14,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        fontSize: 14,
        lineHeight: 1.5,
        background: moi ? 'var(--accent)' : 'var(--panel2)',
        color: moi ? '#fff' : 'var(--txt)',
        border: moi ? '1px solid transparent' : '1px solid var(--border)',
        borderBottomRightRadius: moi ? 5 : 14,
        borderBottomLeftRadius: moi ? 14 : 5
      }
    }, m.texte), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: 'var(--dim)',
        marginTop: 5,
        textAlign: moi ? 'right' : 'left'
      }
    }, m.heure, m.action && m.action.verbe && /*#__PURE__*/React.createElement("span", {
      style: {
        marginLeft: 8,
        opacity: .85
      }
    }, "\xB7 ", m.action.verbe, m.action.sujet ? ` ${m.action.sujet}` : '')), confirmation && /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: 8,
        marginTop: 8
      }
    }, /*#__PURE__*/React.createElement("button", {
      className: "btn sm",
      onClick: () => envoyer('oui'),
      disabled: busy
    }, /*#__PURE__*/React.createElement("i", {
      className: "fas fa-check"
    }), "Oui"), /*#__PURE__*/React.createElement("button", {
      className: "btn ghost sm",
      onClick: () => envoyer('non'),
      disabled: busy
    }, /*#__PURE__*/React.createElement("i", {
      className: "fas fa-xmark"
    }), "Non"))));
  }), busy && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 10,
      marginBottom: 14,
      alignItems: 'flex-start'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 28,
      height: 28,
      borderRadius: 8,
      flex: '0 0 auto',
      display: 'grid',
      placeItems: 'center',
      fontSize: 12,
      fontWeight: 700,
      background: 'var(--panel2)',
      color: 'var(--muted)',
      border: '1px solid var(--border)'
    }
  }, "5"), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '14px 16px',
      borderRadius: 14,
      background: 'var(--panel2)',
      border: '1px solid var(--border)',
      color: 'var(--muted)',
      fontSize: 13
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-circle-notch fa-spin"
  }), " analyse\u2026"))), /*#__PURE__*/React.createElement("div", {
    style: {
      borderTop: '1px solid var(--border)',
      background: 'var(--panel)',
      padding: '10px 18px 14px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      flexWrap: 'wrap',
      marginBottom: 10
    }
  }, PILOTE_RACCOURCIS.map((r, i) => /*#__PURE__*/React.createElement("button", {
    key: i,
    className: "btn ghost sm",
    style: {
      padding: '5px 11px',
      fontSize: 12
    },
    onClick: () => envoyer(r.t),
    disabled: busy
  }, r.l))), erreur && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: 'var(--bad)',
      marginBottom: 8
    }
  }, erreur), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 10,
      alignItems: 'flex-end'
    }
  }, /*#__PURE__*/React.createElement("textarea", {
    ref: champRef,
    className: "fld",
    rows: 1,
    value: saisie,
    placeholder: "\xC9cris une commande\u2026 (\xAB montre les sc\xE9narios \xBB, \xAB d\xE9sactive strategy_trend \xBB)",
    style: {
      flex: 1,
      minHeight: 46,
      maxHeight: 150,
      resize: 'none',
      margin: 0
    },
    onChange: e => setSaisie(e.target.value),
    onKeyDown: e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        envoyer(saisie);
      }
    }
  }), /*#__PURE__*/React.createElement("button", {
    className: "btn",
    onClick: () => envoyer(saisie),
    disabled: busy || !saisie.trim(),
    style: {
      minHeight: 46
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: `fas ${busy ? 'fa-circle-notch fa-spin' : 'fa-paper-plane'}`
  }), "Envoyer")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      gap: 10,
      marginTop: 8,
      fontSize: 11.5,
      color: 'var(--dim)'
    }
  }, /*#__PURE__*/React.createElement("span", null, "Entr\xE9e pour envoyer \xB7 Maj+Entr\xE9e pour un retour \xE0 la ligne"), /*#__PURE__*/React.createElement("span", null, messages.length, " message", messages.length > 1 ? 's' : ''))));
}
function Dashboard({
  user,
  onLogout
}) {
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
      const [k, h, st] = await Promise.all([api('/knowledge').then(r => r.ok ? r.json() : null), api('/history').then(r => r.ok ? r.json() : null), api('/stats').then(r => r.ok ? r.json() : null)]);
      if (k?.success) setStrategies(k.strategies);
      if (h?.success) setHistory(h.history);
      if (st?.success) setStats(st);
    } catch {} finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  // Raccourcis clavier (theme.js) : nav (1-5), rafraîchir (R), fermer (Échap).
  // Seuls les onglets existants sont acceptés.
  useEffect(() => {
    const onNav = e => {
      if (NAV.some(n => n.id === e.detail)) {
        setTab(e.detail);
        setPlusOuvert(false);
      }
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
  const del = async id => {
    await api(`/knowledge/${id}`, {
      method: 'DELETE'
    });
    load();
  };

  // Report d'un plan d'analyse vers le journal : on bascule d'onglet et on
  // transmet le contexte. `_t` force un nouvel objet pour que l'effet du
  // Journal se redéclenche même si on clique deux fois sur le même plan.
  const [prefill, setPrefill] = useState(null);
  const sendToJournal = data => {
    setPrefill({
      ...data,
      _t: Date.now()
    });
    setTab('journal');
  };

  // Onglets toujours visibles sur mobile, et ceux ranges dans « Plus ».
  const NAV_PRINCIPAL = ['live', 'analyze', 'strategies', 'journal'];
  const NAV_SECONDAIRE = ['pilote', 'add', 'history', 'news', 'termes', 'alerts', 'outils', 'systeme'];
  const NAV = [{
    id: 'live',
    label: 'Direct',
    icon: 'fa-satellite-dish'
  }, {
    id: 'analyze',
    label: 'Analyse',
    icon: 'fa-crosshairs'
  },
  // Le pilote conversationnel est une entrée de premier niveau : c'est le seul
  // endroit où l'on pilote réellement le système (CRUD complet) sans chercher
  // un bouton dans six onglets.
  {
    id: 'pilote',
    label: 'Pilote IA',
    icon: 'fa-comments'
  }, {
    id: 'add',
    label: 'Ajouter',
    icon: 'fa-circle-plus'
  }, {
    id: 'strategies',
    label: 'Stratégies',
    icon: 'fa-book'
  }, {
    id: 'journal',
    label: 'Journal',
    icon: 'fa-receipt'
  },
  // Les news sont une entrée de premier niveau : un système de trading qui
  // ignore le calendrier économique trade dans le vide.
  {
    id: 'news',
    label: 'News',
    icon: 'fa-newspaper'
  }, {
    id: 'history',
    label: 'Historique',
    icon: 'fa-clock-rotate-left'
  }, {
    id: 'termes',
    label: 'Termes',
    icon: 'fa-graduation-cap'
  }, {
    id: 'alerts',
    label: 'Alertes',
    icon: 'fa-bell'
  }, {
    id: 'outils',
    label: 'Outils',
    icon: 'fa-toolbox'
  },
  // Le modèle et le risque sont deux entrées de premier niveau du produit :
  // ce sont les seules qui disent si un signal vaut quelque chose et de quelle
  // taille le prendre.
  {
    id: 'systeme',
    label: 'Système',
    icon: 'fa-shield-halved'
  }];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      minHeight: '100vh'
    },
    className: "pad-mobile"
  }, /*#__PURE__*/React.createElement("header", {
    style: {
      position: 'sticky',
      top: 0,
      zIndex: 40,
      borderBottom: '1px solid var(--border)',
      background: 'rgba(9,13,20,.82)',
      backdropFilter: 'blur(16px)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "hdr",
    style: {
      maxWidth: 1240,
      margin: '0 auto',
      padding: '12px 20px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 14,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 14
    }
  }, /*#__PURE__*/React.createElement("a", {
    className: "logo-5trade",
    href: "/",
    title: "5trade \u2014 Accueil"
  }, /*#__PURE__*/React.createElement("span", null, "5trade")), /*#__PURE__*/React.createElement("span", {
    className: "badge",
    style: {
      background: 'rgba(16,185,129,.12)',
      color: '#34d399'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "dot-live"
  }), "en ligne"), /*#__PURE__*/React.createElement("span", {
    className: "badge",
    style: {
      background: 'rgba(148,163,184,.1)',
      color: 'var(--dim)'
    },
    title: "Version de l'interface. Si elle ne correspond pas \xE0 la derni\xE8re livr\xE9e, rechargez avec Ctrl+Maj+R."
  }, UI_VERSION), stats && /*#__PURE__*/React.createElement("span", {
    className: "badge",
    style: {
      background: 'rgba(148,163,184,.1)',
      color: 'var(--muted)'
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-database"
  }), stats.total, " strat\xE9gies")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12.5,
      color: 'var(--muted)'
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-user-astronaut",
    style: {
      marginRight: 6
    }
  }), user.username, user.handle && /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--dim)'
    }
  }, " \xB7 ", user.handle)), /*#__PURE__*/React.createElement("button", {
    className: "btn ghost sm",
    onClick: onLogout
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-right-from-bracket"
  }), "D\xE9connexion")))), /*#__PURE__*/React.createElement("main", {
    className: "wrap"
  }, /*#__PURE__*/React.createElement("div", {
    className: "nav",
    style: {
      marginBottom: 20
    }
  }, NAV.map(n => /*#__PURE__*/React.createElement("button", {
    key: n.id,
    className: `nav-item ${tab === n.id ? 'on' : ''}`,
    onClick: () => setTab(n.id)
  }, /*#__PURE__*/React.createElement("i", {
    className: `fas ${n.icon}`
  }), n.label))), loading ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "stat-grid"
  }, [0, 1, 2].map(i => /*#__PURE__*/React.createElement("div", {
    key: i,
    className: "panel",
    style: {
      padding: 18
    }
  }, /*#__PURE__*/React.createElement(Skeleton, {
    h: 11,
    w: "52%"
  }), /*#__PURE__*/React.createElement(Skeleton, {
    h: 28,
    w: "40%",
    style: {
      marginTop: 10
    }
  })))), /*#__PURE__*/React.createElement("div", {
    className: "panel",
    style: {
      padding: 22
    }
  }, /*#__PURE__*/React.createElement(Skeleton, {
    h: 16,
    w: "34%"
  }), /*#__PURE__*/React.createElement(Skeleton, {
    h: 44,
    style: {
      marginTop: 16
    }
  }), /*#__PURE__*/React.createElement(Skeleton, {
    h: 120,
    style: {
      marginTop: 12
    }
  }))) : /*#__PURE__*/React.createElement(React.Fragment, null, tab === 'analyze' && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "stat-grid",
    style: {
      marginBottom: 18
    }
  }, /*#__PURE__*/React.createElement(StatTile, {
    icon: "fa-database",
    label: "Strat\xE9gies",
    value: stats?.total || 0,
    color: "#60a5fa",
    delay: 0
  }), /*#__PURE__*/React.createElement(StatTile, {
    icon: "fa-globe",
    label: "Scrap\xE9es du web",
    value: (stats?.bySource?.search || 0) + (stats?.bySource?.scrape || 0),
    color: "var(--accent2)",
    delay: 70
  }), /*#__PURE__*/React.createElement(StatTile, {
    icon: "fa-clock-rotate-left",
    label: "Analyses",
    value: history.length,
    color: "#34d399",
    delay: 140
  })), /*#__PURE__*/React.createElement(Analyzer, {
    onDone: setResult
  }), result && /*#__PURE__*/React.createElement(Result, {
    result: result,
    onToJournal: sendToJournal
  })), /*#__PURE__*/React.createElement(Garde, null, tab === 'live' && /*#__PURE__*/React.createElement(LiveMarket, {
    onToJournal: sendToJournal
  }), tab === 'pilote' && /*#__PURE__*/React.createElement(Pilote, null), tab === 'add' && /*#__PURE__*/React.createElement(AddKnowledge, {
    refresh: load
  }), tab === 'strategies' && /*#__PURE__*/React.createElement(Strategies, {
    strategies: strategies,
    onDelete: del,
    onSaved: load
  }), tab === 'journal' && /*#__PURE__*/React.createElement(Journal, {
    prefill: prefill,
    onPrefillUsed: () => setPrefill(null),
    strategies: strategies
  }), tab === 'history' && /*#__PURE__*/React.createElement(History, {
    history: history
  }), tab === 'termes' && /*#__PURE__*/React.createElement(Termes, null), tab === 'news' && /*#__PURE__*/React.createElement(NewsPage, null), tab === 'alerts' && /*#__PURE__*/React.createElement(Alertes, null), tab === 'outils' && /*#__PURE__*/React.createElement(Outils, null), tab === 'systeme' && /*#__PURE__*/React.createElement(Systeme, null)))), /*#__PURE__*/React.createElement("nav", {
    className: "mobile-nav"
  }, NAV.filter(n => NAV_PRINCIPAL.includes(n.id)).map(n => /*#__PURE__*/React.createElement("button", {
    key: n.id,
    className: `mnav-btn ${tab === n.id ? 'on' : ''}`,
    onClick: () => {
      setTab(n.id);
      setPlusOuvert(false);
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: `fas ${n.icon}`,
    style: {
      fontSize: 16
    }
  }), n.label)), /*#__PURE__*/React.createElement("button", {
    className: `mnav-btn ${plusOuvert || NAV_SECONDAIRE.includes(tab) ? 'on' : ''}`,
    onClick: () => setPlusOuvert(o => !o)
  }, /*#__PURE__*/React.createElement("i", {
    className: `fas ${plusOuvert ? 'fa-xmark' : 'fa-ellipsis'}`,
    style: {
      fontSize: 16
    }
  }), plusOuvert ? 'Fermer' : 'Plus')), plusOuvert && /*#__PURE__*/React.createElement("div", {
    className: "mobile-plus"
  }, NAV.filter(n => NAV_SECONDAIRE.includes(n.id)).map(n => /*#__PURE__*/React.createElement("button", {
    key: n.id,
    className: tab === n.id ? 'on' : '',
    onClick: () => {
      setTab(n.id);
      setPlusOuvert(false);
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: `fas ${n.icon}`
  }), n.label))));
}

/* ══════════════ APP ══════════════ */

function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  useEffect(() => {
    api('/me').then(r => r.ok ? r.json() : null).then(d => {
      if (d?.user) setUser(d.user);
    }).catch(() => {}).finally(() => setChecking(false));
  }, []);
  const logout = async () => {
    try {
      await api('/logout', {
        method: 'POST'
      });
    } catch {}
    setUser(null);
  };
  if (checking) {
    return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
      style: {
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 20
      }
    }, /*#__PURE__*/React.createElement(Loader3D, {
      size: 56
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--muted)',
        fontSize: 13
      }
    }, "Chargement de 5trade\u2026"))));
  }
  return /*#__PURE__*/React.createElement(React.Fragment, null, user ? /*#__PURE__*/React.createElement(Dashboard, {
    user: user,
    onLogout: logout
  }) : /*#__PURE__*/React.createElement(Auth, {
    onLogin: setUser
  }));
}
ReactDOM.createRoot(document.getElementById('root')).render(/*#__PURE__*/React.createElement(App, null));
