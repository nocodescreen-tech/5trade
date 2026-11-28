/**
 * Chat CRUD — Commandes MÉMOIRE.
 * Verbes : MONTRE (croyances, faits, exceptions), CRÉE (exception), SUPPRIME (exception).
 */

const Memoire = require('../../memoire');
const { extraireException } = require('../parseur');

async function etat(sujet, ctx) {
  const texte = await NarrateurEtat();
  return { texte };
}

async function NarrateurEtat() {
  const Narrateur = require('../../apprentissage/narrateur');
  return await Narrateur.expliquerEtat();
}

async function lister(sujet, ctx) {
  // Distinguer croyances / faits / exceptions / préférences
  if (/pr[ée]f[ée]rence|consigne|r[èe]gle\s+utilisateur/i.test(sujet)) {
    const items = await Memoire.preferences.lister({ activesSeulement: false });
    return { items };
  }
  if (/croyance/i.test(sujet)) {
    const items = await Memoire.croyances.lister({ limit: 20 });
    return { items };
  }
  if (/exception|r[èe]gle/i.test(sujet)) {
    const items = await Memoire.exceptions.lister({ activesSeulement: false });
    return { items };
  }
  // défaut : faits
  const instrument = (sujet.match(/(EURUSD|GBPUSD|USDJPY|XAUUSD)/i) || [])[1];
  const items = await Memoire.faits.lister({ instrument: instrument ? instrument.toUpperCase() : null, limit: 20 });
  return { items };
}

async function apprendre(sujet, ctx) {
  if (!sujet || typeof sujet !== 'string' || !sujet.trim()) {
    return { erreur: 'Qu\'est-ce que tu souhaites que j\'apprenne ?' };
  }

  const texte = sujet.trim();
  // Catégorie selon le sujet
  let categorie = 'consigne';
  if (/forex|crypto|session|cl[ôo]ture|ouvert|ferm[ée]|week-?end|horaire|dimanche|vendredi|samedi/i.test(texte)) {
    categorie = 'session';
  } else if (/risque|drawdown|levier|capital|perte|stop/i.test(texte)) {
    categorie = 'risque';
  } else if (/strat[ée]gie|setup|smc|fvg|ob|signal/i.test(texte)) {
    categorie = 'strategie';
  }

  // Générer une clé stable lisible
  const slug = texte.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .slice(0, 40)
    .replace(/^_+|_+$/g, '');
  const cle = `${categorie}_${slug || Date.now()}`;

  const res = await Memoire.preferences.enregistrer({
    cle,
    contenu: texte,
    categorie,
    source: ctx?.utilisateur || ctx?.user || 'utilisateur'
  });

  if (!res.ok) {
    return { erreur: 'enregistrement échoué', raison: res.raison };
  }

  // Détecter l'impact direct sur le DecisionEngine
  const contraintesDetectees = typeof Memoire.preferences.analyserContraintes === 'function'
    ? Memoire.preferences.analyserContraintes([{ contenu: texte, active: true }])
    : null;
  let impactMoteur = '';
  if (contraintesDetectees) {
    const impacts = [];
    if (contraintesDetectees.symbolesInterdits && contraintesDetectees.symbolesInterdits.size > 0) {
      impacts.push(`blocage automatique des signaux sur ${Array.from(contraintesDetectees.symbolesInterdits).join(', ')}`);
    }
    if (contraintesDetectees.joursInterdits && contraintesDetectees.joursInterdits.length > 0) {
      const noms = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
      impacts.push(`interdiction d'exécution le ${contraintesDetectees.joursInterdits.map(j => noms[j]).join(', ')}`);
    }
    if (contraintesDetectees.risqueMaxPct !== null) {
      impacts.push(`plafond de risque demandé : ${contraintesDetectees.risqueMaxPct} % (application au sizing non vérifiée)`);
    }
    if (impacts.length > 0) {
      impactMoteur = `\n• Contraintes détectées : ${impacts.join(' · ')}.`;
    }
  }

  // Si c'est une règle de timing/restriction ("ne pas trader...", "jamais trader...")
  // on crée également une exception active si possible
  const exc = extraireException(texte);
  let detailException = '';
  if (exc) {
    const rExc = await Memoire.exceptions.creer(exc);
    if (rExc.ok) detailException = `\n• Exception technique configurée (#${rExc.id}).`;
  }

  return {
    ok: true,
    id: cle,
    categorie,
    texte: `C'est enregistré durablement dans ma mémoire permanente !\n` +
      `• Consigne active : « ${texte} »\n` +
      `• Catégorie : ${categorie}\n` +
      `• Clé de référence : ${cle}.${impactMoteur}${detailException}\n` +
      `Mémoire globale de cette instance. Seules les contraintes reconnues et intégrées au moteur sont exécutables ; une note libre ne crée pas de tâche automatique.`
  };
}

async function creerException(sujet, ctx) {
  const exc = extraireException(sujet);
  if (!exc) {
    return {
      erreur: 'syntaxe : « crée une exception : ne pas trader EURUSD vendredi après 16h »',
      raison: 'je n\'ai pas reconnu l\'instrument, le jour ou l\'heure'
    };
  }
  const r = await Memoire.exceptions.creer(exc);
  if (!r.ok) return { erreur: 'création échouée', raison: r.raison };
  return { ok: true, id: r.id, raison: `exception créée : ${exc.titre}` };
}

async function supprimerException(sujet, ctx) {
  const m = sujet.match(/exception\s+([\w_-]+)/i);
  if (!m) return { erreur: 'quelle exception ?' };
  const id = m[1];
  await Memoire.exceptions.desactiver(id);
  return { ok: true, id, raison: 'exception désactivée' };
}

module.exports = { etat, lister, creerException, supprimerException, apprendre };
