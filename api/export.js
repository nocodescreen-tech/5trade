/**
 * 5trade — export du journal de trades.
 *
 * CSV conforme RFC 4180 : guillemets doublés, champs contenant virgule,
 * guillemet ou retour à la ligne échappés. Un export qui casse dès qu'une note
 * contient une virgule serait pire que pas d'export du tout.
 */

const COLUMNS = [
  { key: 'id',              label: 'id' },
  { key: 'openedAt',        label: 'ouvert_le' },
  { key: 'closedAt',        label: 'cloture_le' },
  { key: 'pair',            label: 'paire' },
  { key: 'direction',       label: 'sens' },
  { key: 'status',          label: 'statut' },
  { key: 'entry',           label: 'entree' },
  { key: 'sl',              label: 'stop_loss' },
  { key: 'tp',              label: 'take_profit' },
  { key: 'size',            label: 'taille' },
  { key: 'risk',            label: 'risque' },
  { key: 'reward',          label: 'gain_potentiel' },
  { key: 'plannedRR',       label: 'rr_prevu' },
  { key: 'exit',            label: 'sortie' },
  { key: 'result',          label: 'resultat' },
  { key: 'rr',              label: 'rr_realise' },
  { key: 'pnl',             label: 'pnl' },
  { key: 'strategyIds',     label: 'strategies' },
  { key: 'originAnalysisId', label: 'analyse_origine' },
  { key: 'notes',           label: 'notes' }
];

const cell = v => {
  if (v === null || v === undefined) return '';
  const s = Array.isArray(v) ? v.join('|') : String(v);
  return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Sérialise une liste de trades en CSV (séparateur virgule, fin de ligne CRLF). */
function toCsv(trades) {
  const lines = [COLUMNS.map(c => c.label).join(',')];
  for (const t of trades || []) {
    lines.push(COLUMNS.map(c => cell(t[c.key])).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

module.exports = { toCsv, COLUMNS, cell };
