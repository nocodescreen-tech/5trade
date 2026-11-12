/**
 * Market Intelligence — classification d'instrument.
 *
 * Le nom du symbole ne suffit pas : « US30 » désigne un indice chez un broker et
 * autre chose ailleurs, « frxXAUUSD » porte un préfixe de courtier, « BTCUSDT »
 * n'est pas une paire de devises. Ce module classe ce qu'il peut prouver, et
 * déclare « inconnu » le reste — il n'invente jamais un profil.
 *
 * Aucune dépendance : utilisable par le moteur, les routes et les tests.
 */

/** Familles reconnues. `synthetique` n'est pas un marché : c'est une fabrication. */
const CLASSES = {
  forex: { libelle: 'Forex', devises: true, continu: false },
  indices: { libelle: 'Indices', devises: false, continu: false },
  metaux: { libelle: 'Métaux', devises: false, continu: false },
  energies: { libelle: 'Énergies', devises: false, continu: false },
  crypto: { libelle: 'Crypto', devises: false, continu: true },
  synthetique: { libelle: 'Indice synthétique', devises: false, continu: true },
  inconnu: { libelle: 'Inconnu', devises: false, continu: false }
};

const DEVISES = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'AUD', 'NZD', 'CAD', 'CNH', 'MXN', 'ZAR', 'TRY', 'SEK', 'NOK', 'SGD', 'HKD'];

// Indices : noms de contrat chez les courtiers et les fournisseurs.
const INDICES = [
  'US30', 'DJI', 'DOW', 'NAS100', 'NASDAQ', 'US100', 'USTEC', 'SPX500', 'SP500', 'US500',
  'GER40', 'DE40', 'DAX', 'UK100', 'FTSE', 'FRA40', 'CAC', 'JP225', 'NIKKEI', 'HK50',
  'AUS200', 'EU50', 'STOXX', 'RUSSELL', 'US2000'
];

const METAUX = ['XAU', 'XAG', 'XPT', 'XPD', 'GOLD', 'SILVER', 'PLATINUM'];
// XTI/XBR : les contrats pétrole de Deriv (XTIUSD, XBRUSD) ne s'écrivent pas WTI/BRENT.
const ENERGIES = ['WTI', 'BRENT', 'XTI', 'XBR', 'USOIL', 'UKOIL', 'NATGAS', 'NGAS', 'CL', 'NG', 'GASOLINE', 'HEATOIL'];
const CRYPTO = ['BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'DOGE', 'BNB', 'LTC', 'DOT', 'AVAX', 'MATIC', 'LINK', 'TRX', 'TON'];

/** Indices synthétiques Deriv : R_10..R_100, BOOM/CRASH/STEP, 1HZ… */
const SYNTHETIQUE = /^(R\d+|BOOM\d*|CRASH\d*|STEP\w*|JD\d+|STPRNG\d*|1HZ\d+\w*)$/;

const net = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const sansPrefixeCourtier = s => s.replace(/^(FRX|CFI|FX|OTC|IDX|CASH|SPOT)/, '');

/**
 * @param {string} symbol
 * @param {object} [meta] métadonnées du fournisseur : {type, base, quote, description}
 * @returns {{symbole, classe, libelle, deviseBase, deviseCote, synthetique,
 *            continu, reconnu, source, raisons:string[]}}
 */
function classifier(symbol, meta = {}) {
  const brut = net(symbol);
  const raisons = [];
  const fin = (classe, extra = {}) => ({
    symbole: String(symbol || ''),
    classe,
    libelle: CLASSES[classe].libelle,
    synthetique: classe === 'synthetique',
    continu: CLASSES[classe].continu,
    reconnu: classe !== 'inconnu',
    source: extra.source || 'symbole',
    raisons: [...raisons, ...(extra.raisons || [])],
    ...extra.champs
  });

  if (!brut) return fin('inconnu', { raisons: ['symbole vide'], source: 'aucune' });

  // 1. IDENTITÉ DU CONTRAT AVANT TOUT. Un indice synthétique Deriv accompagné
  // de métadonnées génériques « index » était classé « indice réel » : les
  // métadonnées primaient sur le nom du contrat. Le nom d'un produit synthétique
  // (R_75, BOOM1000, 1HZ…) est une identité, pas une indication.
  if (SYNTHETIQUE.test(brut)) {
    const typeMeta0 = net(meta.type);
    if (typeMeta0 && !/^(INDEX|INDICES|SYNTHETIC|SYNTHETIQUE)$/.test(typeMeta0)) {
      return fin('inconnu', { raisons: [
        `contradiction : nom de synthétique (${brut}) mais type fournisseur « ${meta.type} »`,
        'aucune classification fiable : on ne tranche pas'
      ], source: 'contradiction' });
    }
    raisons.push("nom d'indice synthétique Deriv (prix généré par le courtier)");
    return fin('synthetique');
  }

  // 2. PROXYS : un exchange cote EURUSDT, pas EURUSD. Ce n'est pas le contrat
  // Forex — le confondre fait analyser une autre série avec les règles du Forex.
  const PROXYS = {
    EURUSDT: { classe: 'crypto', de: 'EURUSD', contrat: 'USDT' },
    GBPUSDT: { classe: 'crypto', de: 'GBPUSD', contrat: 'USDT' },
    PAXGUSDT: { classe: 'metaux', de: 'XAUUSD', contrat: 'PAXG tokenisé' },
    XAUTUSDT: { classe: 'metaux', de: 'XAUUSD', contrat: 'XAUT tokenisé' }
  };
  if (PROXYS[brut]) {
    const px = PROXYS[brut];
    raisons.push(`proxy de ${px.de} (${px.contrat}) : série différente, non interchangeable`);
    return fin(px.classe, { source: 'proxy', champs: { proxy: true, proxyDe: px.de } });
  }

  // 3. Métadonnées du fournisseur (après l'identité du contrat).
  const typeMeta = net(meta.type);
  if (/^(CRYPTO|CRYPTOCURRENCY)$/.test(typeMeta)) {
    raisons.push('type fournisseur : crypto');
    return fin('crypto', { source: 'metadonnees' });
  }
  if (/^(INDEX|INDICES)$/.test(typeMeta)) {
    raisons.push('type fournisseur : indice');
    return fin('indices', { source: 'metadonnees' });
  }
  if (/^(FOREX|CURRENCY)$/.test(typeMeta)) {
    raisons.push('type fournisseur : forex');
    return fin('forex', { source: 'metadonnees' });
  }

  // 2. Indices synthétiques : aucune devise, prix fabriqué par le courtier.
  if (SYNTHETIQUE.test(brut)) {
    raisons.push('nom d\'indice synthétique Deriv (prix généré par le courtier)');
    return fin('synthetique');
  }

  const s = sansPrefixeCourtier(brut);
  if (s !== brut) raisons.push('préfixe de courtier retiré');

  // 3. Énergies et métaux : reconnaissables avant toute paire de devises.
  const energie = ENERGIES.find(e => s.startsWith(e));
  if (energie) return fin('energies', { champs: { contrat: energie } });

  const metal = METAUX.find(m => s.startsWith(m));
  if (metal) {
    const reste = s.slice(metal.length);
    const devise = DEVISES.find(d => reste.startsWith(d)) || null;
    raisons.push(`métal ${metal}${devise ? ` coté en ${devise}` : ''}`);
    return fin('metaux', { champs: { deviseCote: devise } });
  }

  // 4. Crypto : BTC, ETH… éventuellement suivi d'une devise de cotation.
  const crypto = CRYPTO.find(c => s.startsWith(c));
  if (crypto) {
    const reste = s.slice(crypto.length);
    const quote = reste.startsWith('USDT') ? 'USD' : (DEVISES.find(d => reste.startsWith(d)) || null);
    raisons.push(`crypto ${crypto}${quote ? ` cotée en ${quote}` : ''}`);
    return fin('crypto', { champs: { deviseCote: quote } });
  }

  // 5. Indices : le nom du contrat peut être suivi d'un suffixe (.cash, .spot).
  const indice = INDICES.find(i => s.startsWith(i));
  if (indice) {
    raisons.push(`contrat d'indice ${indice}`);
    return fin('indices', { champs: { contrat: indice } });
  }

  // 6. Forex : deux codes devise de 3 lettres, dans l'ordre.
  const paires = [];
  let reste = s;
  const codes = [...DEVISES].sort((a, b) => b.length - a.length);
  while (reste.length >= 3) {
    const code = codes.find(c => reste.startsWith(c));
    if (!code) break;
    paires.push(code);
    reste = reste.slice(code.length);
  }
  // Correspondance EXACTE : deux codes et RIEN d'autre. Avant, `EURUSDX`
  // était accepté comme EUR/USD (le X résiduel était ignoré) et `EURUSDT`
  // aussi — deux façons d'analyser un instrument qui n'existe pas chez le
  // fournisseur avec les règles d'un autre.
  if (paires.length === 2 && reste === '') {
    if (paires[0] === paires[1]) {
      return fin('inconnu', { raisons: [`devise de base et de cotation identiques (${paires[0]})`], source: 'incoherence' });
    }
    raisons.push(`paire de devises ${paires[0]}/${paires[1]}`);
    return fin('forex', { champs: { deviseBase: paires[0], deviseCote: paires[1] } });
  }
  if (paires.length >= 2 && reste !== '') {
    return fin('inconnu', { raisons: [
      `symbole « ${brut} » : deux devises puis « ${reste} » — paire non exacte, classification refusée`
    ], source: 'incoherence' });
  }

  // Métadonnées de paire : si le fournisseur les donne, elles doivent concorder.
  const baseMeta = net(meta.base), quoteMeta = net(meta.quote);
  if (baseMeta && quoteMeta) {
    if (paires.length === 2 && (paires[0] !== baseMeta || paires[1] !== quoteMeta)) {
      return fin('inconnu', { raisons: [
        `contradiction : symbole ${paires[0]}/${paires[1]} mais métadonnées ${baseMeta}/${quoteMeta}`
      ], source: 'contradiction' });
    }
    raisons.push(`métadonnées de paire ${baseMeta}/${quoteMeta}`);
    return fin('forex', { champs: { deviseBase: baseMeta, deviseCote: quoteMeta } });
  }

  // 7. Rien de prouvable : on le dit, on ne devine pas.
  raisons.push('aucune famille identifiable : profil non établi (le moteur ne doit pas inventer ses spécifications)');
  return fin('inconnu');
}

module.exports = { classifier, CLASSES };
