// Réapplique le passage au JSX précompilé sur index.html.
// Idempotent : peut tourner plusieurs fois, ne casse rien si déjà appliqué.
const fs = require('fs');
const path = require('path');

const DIR = __dirname;   // relatif au fichier : fonctionne sur toute machine
const HTML = path.join(DIR, 'index.html');
let html = fs.readFileSync(HTML, 'utf8');
const avant = html.length;
let actions = [];

// 1. Babel ne doit plus être chargé du tout
const tagBabel = /\s*<script src="\/vendor\/babel\.min\.js"><\/script>/;
if (tagBabel.test(html)) {
  html = html.replace(tagBabel, '\n  <!-- JSX précompilé (build.js) : plus de Babel dans le navigateur. -->');
  actions.push('babel retiré');
}

// 2. le preset runtime n'a plus lieu d'être
const preset = /<script>\s*\/\/ Runtime React "classic"[\s\S]*?Babel\.registerPreset[\s\S]*?<\/script>\s*/;
if (preset.test(html)) {
  html = html.replace(preset, '');
  actions.push('preset retiré');
}

// 3. reactbits : JSX compilé
if (html.includes('src="reactbits.jsx"')) {
  html = html.replace(
    /<script type="text\/babel" data-presets="react-classic" src="reactbits\.jsx"><\/script>/,
    '<script src="build/reactbits.js?v=2"></script>',
  );
  actions.push('reactbits compilé');
}

// 4. application : JSX compilé (le bloc inline disparaît)
const debut = html.indexOf('<script type="text/babel" data-presets="react-classic">');
if (debut !== -1) {
  const fin = html.lastIndexOf('</script>');
  if (fin > debut) {
    html = html.slice(0, debut) + '<script src="build/app.js?v=2"></script>' + html.slice(fin + '</script>'.length);
    actions.push('application compilée');
  }
}

if (html.includes('text/babel')) throw new Error('il reste du JSX brut : rien écrit');

if (actions.length) {
  fs.writeFileSync(HTML, html, 'utf8');
}
console.log(JSON.stringify({
  actions: actions.length ? actions : ['déjà à jour'],
  koAvant: Math.round(avant / 1024),
  koApres: Math.round(html.length / 1024),
}, null, 1));
