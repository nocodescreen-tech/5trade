/**
 * 5trade — GESTION : séances et killzones (source unique).
 *
 * Deux vérités coexistaient dans le dépôt :
 *   - `engine/structure.js` annonçait Londres 7 h–10 h UTC et New York 12 h–15 h ;
 *   - `apprentissage/rejoueur-journalier.js` simulait 8 h–11 h et 13 h–16 h.
 * Un système qui apprend sur des heures différentes de celles qu'il trade apprend
 * sur un autre marché. Les fenêtres vivent donc ici, et nulle part ailleurs.
 *
 * Fenêtres retenues (celles de la structure, les seules cohérentes avec l'open
 * de Londres 08:00 local et de New York 08:00 local) :
 *   Asie    23:00 → 02:00 UTC
 *   Londres 07:00 → 10:00 UTC
 *   NY      12:00 → 15:00 UTC
 *
 * `autorise()` ne décide pas à la place du moteur : elle rend un refus MOTIVÉ.
 * Un refus sans motif ne se mesure pas, donc ne s'apprend pas.
 */

const KILLZONES = [
  { id: 'asia', label: 'Asie', from: 23, to: 2, note: 'range dominant, spreads plus larges' },
  { id: 'london', label: 'Londres', from: 7, to: 10, note: 'expansion de volatilité' },
  { id: 'ny', label: 'New York', from: 12, to: 15, note: 'recouvrement Londres/NY, meilleure liquidité' }
];

function heureUtc(ts) {
  const d = ts instanceof Date ? ts : new Date(Number(ts));
  return Number.isFinite(d.getTime()) ? d.getUTCHours() : null;
}

function dansZone(zone, h) {
  if (!zone || !Number.isFinite(h)) return false;
  return zone.from <= zone.to
    ? h >= zone.from && h < zone.to
    : h >= zone.from || h < zone.to;      // fenêtre qui passe minuit
}

/** Identifiant de la killzone à cet instant, ou null hors séance. */
function pour(ts) {
  const h = heureUtc(ts);
  if (!Number.isFinite(h)) return null;
  const z = KILLZONES.find(k => dansZone(k, h));
  return z ? z.id : null;
}

function zone(id) {
  return KILLZONES.find(k => k.id === id) || null;
}

function libelle(id) {
  const z = zone(id);
  return z ? `${z.label} (${String(z.from).padStart(2, '0')} h–${String(z.to).padStart(2, '0')} h UTC)` : 'hors killzone';
}

/**
 * La killzone est-elle ouverte au trading selon les seuils appris ?
 *
 * `seuils['killzones.<id>.actif'] = false` la coupe. La règle Asie est
 * conditionnelle au régime : `killzones.asia.actif_en_range = false` la coupe
 * uniquement quand le marché est en range (c'est le cas mesuré en rejeu : l'Asie
 * en range enchaînait les invalidations).
 *
 * @returns {{ok:boolean, id:string|null, raison:string}}
 */
function autorise(ts, seuils = {}, options = {}) {
  const id = pour(ts);
  if (!id) return { ok: false, id: null, raison: 'hors killzone' };

  const cle = `killzones.${id}.actif`;
  if (seuils[cle] === false) {
    return { ok: false, id, raison: `${libelle(id)} désactivée par les seuils (${cle}=false)` };
  }

  // Le détecteur de régime rend « ranging » ; le cahier des charges parle de
  // « range ». Les deux doivent couper l'Asie, sinon la règle ne s'applique
  // jamais — et une règle qui ne s'applique jamais ne se mesure pas.
  const regime = String(options.regime || '').toLowerCase();
  if (id === 'asia' && (regime === 'range' || regime === 'ranging')
      && seuils['killzones.asia.actif_en_range'] === false) {
    return { ok: false, id, raison: `${libelle(id)} en range désactivée par les seuils` };
  }

  return { ok: true, id, raison: `${libelle(id)} ouverte` };
}

module.exports = { KILLZONES, pour, zone, libelle, autorise, dansZone, heureUtc };
