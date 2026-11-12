/**
 * Sonde de rendu — émule un vrai viewport mobile via le protocole DevTools.
 *
 * Pourquoi : Edge sur Windows impose une largeur de fenêtre minimale de 492 px.
 * `--window-size=390` produit une capture de 390 px mais un viewport de 492 px,
 * donc une carte qui déborde à droite... qui ne déborde pas. Cette sonde donne
 * la VRAIE largeur, et mesure le débordement horizontal au lieu de l'estimer.
 *
 * Usage : node sonde-rendu.js <url> <largeur> <hauteur> <sortie.png>
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
// `ws` vit dans api/node_modules : on le résout par chemin pour que la sonde
// fonctionne depuis n'importe quel répertoire courant.
const WebSocket = require(path.join(__dirname, '..', 'api', 'node_modules', 'ws'));

const [, , url, larg, haut, sortie, cookie] = process.argv;   // cookie optionnel : nom=valeur
const W = Number(larg || 390), H = Number(haut || 844);
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9331;
const PROFIL = path.join(require('os').tmpdir(), 'edge-sonde-' + Date.now());

const attendre = ms => new Promise(r => setTimeout(r, ms));

function cdp(methode, params = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ id: cdp.n = (cdp.n || 0) + 1, method: methode, params });
    const id = cdp.n;
    const onMsg = raw => {
      const m = JSON.parse(raw);
      if (m.id === id) {
        ws.removeListener('message', onMsg);
        m.error ? reject(new Error(methode + ' : ' + m.error.message)) : resolve(m.result);
      }
    };
    ws.on('message', onMsg);
    ws.send(data);
  });
}

let ws;
(async () => {
  const edge = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFIL, 'about:blank'
  ], { stdio: 'ignore' });

  // Attente du port de débogage
  let cibles = null;
  for (let i = 0; i < 40 && !cibles; i++) {
    await attendre(250);
    cibles = await new Promise(res => {
      http.get(`http://127.0.0.1:${PORT}/json/list`, r => {
        let b = ''; r.on('data', d => b += d); r.on('end', () => { try { res(JSON.parse(b)); } catch { res(null); } });
      }).on('error', () => res(null));
    });
  }
  if (!cibles || !cibles.length) throw new Error('Edge n\'a pas exposé le protocole DevTools');

  ws = new WebSocket(cibles.find(c => c.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });

  await cdp('Page.enable');
  await cdp('Network.enable');

  // Cookie de session optionnel : permet de rendre les écrans authentifiés.
  if (cookie && cookie.includes('=')) {
    const i = cookie.indexOf('=');
    await cdp('Network.setCookie', {
      name: cookie.slice(0, i), value: cookie.slice(i + 1),
      domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Strict'
    });
  }
  await cdp('Emulation.setDeviceMetricsOverride', {
    width: W, height: H, deviceScaleFactor: 1, mobile: W < 600
  });
  await cdp('Page.navigate', { url });

  // On attend le CONTENU, pas un délai : Babel compile dans le navigateur et la
  // durée varie. Un délai fixe produit une capture de l'écran de chargement.
  let pret = false;
  for (let i = 0; i < 60 && !pret; i++) {
    await attendre(500);
    const r = await cdp('Runtime.evaluate', {
      expression: `!!document.querySelector('.auth-card, .seg, header, .wrap')`,
      returnByValue: true
    });
    pret = r.result && r.result.value === true;
  }
  if (!pret) console.warn("ATTENTION : contenu non détecté en 30 s, capture de l'état courant");

  // Les écrans de données affichent d'abord des squelettes : on attend leur
  // disparition, sinon on capture un écran vide et on juge un faux état.
  let charge = false;
  for (let i = 0; i < 60 && !charge; i++) {
    const r = await cdp('Runtime.evaluate', {
      expression: `document.querySelectorAll('.skel').length`, returnByValue: true
    });
    charge = r.result && r.result.value === 0;
    if (!charge) await attendre(500);
  }
  if (!charge) console.warn('ATTENTION : squelettes encore présents après 30 s');
  await attendre(800);    // laisse les animations d'entrée se poser

  // Mesure réelle : le document déborde-t-il ?
  const mesure = await cdp('Runtime.evaluate', {
    expression: `(() => {
      const d = document.documentElement;
      const large = Math.max(d.scrollWidth, document.body.scrollWidth);
      const trop = [...document.querySelectorAll('body *')]
        .filter(el => el.getBoundingClientRect().right > d.clientWidth + 1)
        .slice(0, 5)
        .map(el => (el.className && String(el.className).slice(0, 40)) || el.tagName);
      return JSON.stringify({
        innerWidth: window.innerWidth,
        clientWidth: d.clientWidth,
        scrollWidth: large,
        debordement: large - d.clientWidth,
        elementsTrop: trop
      });
    })()`, returnByValue: true
  });

  const png = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(sortie, Buffer.from(png.data, 'base64'));

  console.log('viewport :', mesure.result.value);
  console.log('capture  :', sortie, fs.statSync(sortie).size, 'octets');

  ws.close();
  edge.kill();
  process.exit(0);
})().catch(e => { console.error('ERREUR', e.message); try { ws && ws.close(); } catch {} process.exit(1); });
