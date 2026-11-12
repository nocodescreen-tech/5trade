#!/usr/bin/env node
/**
 * 5TRADE — compilation du frontend.
 *
 * Pourquoi ce fichier existe : le JSX était envoyé brut au navigateur et
 * transformé à chaque chargement par Babel Standalone (2,9 Mo) — 9 secondes de
 * blocage avant le premier rendu sur un poste rapide, bien davantage sur mobile.
 * On compile une fois ici, et le navigateur ne reçoit que du JavaScript prêt.
 *
 * Usage : node build.js        (depuis frontend/)
 *
 * Entrées  : src/app.jsx (application), reactbits.jsx (composants)
 * Sorties  : build/app.js, build/reactbits.js
 * Babel vient de vendor/babel.min.js : aucune dépendance à installer.
 */
const fs = require('fs');
const path = require('path');
const Babel = require('./vendor/babel.min.js');

const ICI = __dirname;
const SRC = path.join(ICI, 'src');
const OUT = path.join(ICI, 'build');

const CIBLES = [
  { entree: path.join(SRC, 'app.jsx'), sortie: path.join(OUT, 'app.js') },
  { entree: path.join(ICI, 'reactbits.jsx'), sortie: path.join(OUT, 'reactbits.js') },
];

function compiler(entree, sortie) {
  const source = fs.readFileSync(entree, 'utf8');
  const { code } = Babel.transform(source, {
    // React est chargé en global par index.html : on reste en runtime classique
    // (React.createElement), exactement ce que faisait `data-presets="react-classic"`.
    presets: [['react', { runtime: 'classic' }]],
    compact: false,
    comments: true,
    babelrc: false,
    configFile: false,
    filename: path.basename(entree),
  });

  fs.mkdirSync(path.dirname(sortie), { recursive: true });
  fs.writeFileSync(sortie, `${code}\n`, 'utf8');

  const ko = (n) => `${Math.round(n / 1024)} Ko`;
  return {
    entree: path.basename(entree),
    sortie: path.basename(sortie),
    avant: ko(fs.statSync(entree).size),
    apres: ko(fs.statSync(sortie).size),
  };
}

if (!fs.existsSync(path.join(SRC, 'app.jsx'))) {
  console.error('src/app.jsx introuvable — la source de l’application doit être dans src/.');
  process.exit(1);
}

console.log('Compilation du frontend 5trade');
for (const c of CIBLES) {
  if (!fs.existsSync(c.entree)) {
    console.error(`  source absente : ${c.entree}`);
    process.exit(1);
  }
  const r = compiler(c.entree, c.sortie);
  console.log(`  ${r.entree.padEnd(16)} -> build/${r.sortie.padEnd(14)} ${r.avant} -> ${r.apres}`);
}

console.log('\nTerminé. index.html charge build/app.js et build/reactbits.js — plus de Babel dans le navigateur.');
