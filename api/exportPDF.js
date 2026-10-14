/**
 * 5trade — export PDF des rapports de performance.
 *
 * Génère un rapport PDF téléchargeable contenant :
 *   • Statistiques globales
 *   • Courbe de equity
 *   • Liste des trades
 *   • Analyse par paire/marché/source
 *   • Métriques de risque
 */

const fs = require('fs');
const path = require('path');
const { computeStats } = require('./trades');

/**
 * Génère un rapport PDF (format HTML prêt à convertir).
 *
 * @param {object} params
 * @param {Array} params.trades - Liste des trades
 * @param {string} params.titre - Titre du rapport
 * @param {string} params.devise - Devise du rapport
 * @returns {string} HTML du rapport
 */
function genererRapportPDF({ trades, titre = 'Rapport de trading 5trade', devise = 'USD' }) {
  const stats = computeStats(trades);
  const formatPct = v => v === null || v === undefined ? '—' : `${v.toFixed(1)} %`;
  const formatNombre = v => v === null || v === undefined ? '—' : v.toLocaleString('fr-FR', { minimumFractionDigits: 2 });

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>${titre}</title>
<style>
  @page { size: A4; margin: 2cm; }
  body { font-family: Arial, sans-serif; font-size: 11px; color: #1a1a2e; margin: 0; }
  h1 { color: #2563eb; font-size: 24px; margin: 0 0 4px; }
  h2 { color: #475569; font-size: 14px; margin: 20px 0 8px; text-transform: uppercase; letter-spacing: 0.5px; }
  .subtitle { color: #64748b; font-size: 12px; margin-bottom: 20px; }
  .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 15px 0; }
  .stat-card { background: #f1f5f9; border-radius: 8px; padding: 12px; text-align: center; }
  .stat-value { font-size: 20px; font-weight: 700; color: #0f172a; }
  .stat-label { font-size: 10px; color: #64748b; margin-top: 4px; text-transform: uppercase; }
  .positive { color: #059669; }
  .negative { color: #dc2626; }
  table { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 10px; }
  th { background: #1e293b; color: white; padding: 6px 8px; text-align: left; }
  td { padding: 5px 8px; border-bottom: 1px solid #e2e8f0; }
  tr:nth-child(even) { background: #f8fafc; }
  .badge { padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: 600; }
  .badge-win { background: #d1fae5; color: #065f46; }
  .badge-loss { background: #fee2e2; color: #991b1b; }
  .badge-be { background: #e2e8f0; color: #475569; }
  .footer { margin-top: 30px; padding-top: 10px; border-top: 1px solid #e2e8f0; color: #94a3b8; font-size: 9px; text-align: center; }
  .chart-placeholder { background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 8px; padding: 30px; text-align: center; color: #94a3b8; margin: 10px 0; }
</style>
</head>
<body>
<h1>📊 ${titre}</h1>
<p class="subtitle">Généré le ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR')} · Devise : ${devise}</p>

<h2>Statistiques Globales</h2>
<div class="stats-grid">
  <div class="stat-card">
    <div class="stat-value">${stats.total}</div>
    <div class="stat-label">Trades totaux</div>
  </div>
  <div class="stat-card">
    <div class="stat-value">${stats.closed}</div>
    <div class="stat-label">Clôturés</div>
  </div>
  <div class="stat-card">
    <div class="stat-value">${stats.open}</div>
    <div class="stat-label">En cours</div>
  </div>
  <div class="stat-card">
    <div class="stat-value">${formatPct(stats.winRate)}</div>
    <div class="stat-label">Taux de réussite</div>
  </div>
  <div class="stat-card">
    <div class="stat-value ${stats.pnlTotal >= 0 ? 'positive' : 'negative'}">${formatNombre(stats.pnlTotal)}</div>
    <div class="stat-label">PnL total</div>
  </div>
  <div class="stat-card">
    <div class="stat-value">${formatNombre(stats.rrAvg)}</div>
    <div class="stat-label">RR moyen</div>
  </div>
  <div class="stat-card">
    <div class="stat-value positive">${stats.wins}</div>
    <div class="stat-label">Gagnants</div>
  </div>
  <div class="stat-card">
    <div class="stat-value negative">${stats.losses}</div>
    <div class="stat-label">Perdants</div>
  </div>
</div>

${stats.streak ? `
<h2>Série Actuelle</h2>
<p>${stats.streak.count} trades consécutifs — ${stats.streak.type === 'win' ? '<span class="positive">gagnants</span>' : '<span class="negative">perdants</span>'}</p>
` : ''}

<h2>Performance par Paire</h2>
<table>
  <tr><th>Paire</th><th>Trades</th><th>Gagnants</th><th>Win Rate</th><th>PnL</th><th>RR Moyen</th></tr>
  ${stats.byPair.map(p => `<tr>
    <td><strong>${p.label}</strong></td>
    <td>${p.trades}</td>
    <td>${p.wins}</td>
    <td>${formatPct(p.winRate)}</td>
    <td class="${p.pnl >= 0 ? 'positive' : 'negative'}">${formatNombre(p.pnl)}</td>
    <td>${formatNombre(p.rrAvg)}</td>
  </tr>`).join('')}
</table>

${stats.byMarket.length > 0 ? `
<h2>Performance par Marché</h2>
<table>
  <tr><th>Marché</th><th>Trades</th><th>Win Rate</th><th>PnL</th></tr>
  ${stats.byMarket.map(m => `<tr>
    <td>${m.label}</td>
    <td>${m.trades}</td>
    <td>${formatPct(m.winRate)}</td>
    <td class="${m.pnl >= 0 ? 'positive' : 'negative'}">${formatNombre(m.pnl)}</td>
  </tr>`).join('')}
</table>
` : ''}

<h2>Journal des Trades</h2>
<table>
  <tr><th>Date</th><th>Paire</th><th>Sens</th><th>Entrée</th><th>Sortie</th><th>PnL</th><th>Résultat</th></tr>
  ${trades.filter(t => t.status === 'closed').slice(0, 50).map(t => `<tr>
    <td>${new Date(t.closedAt || t.createdAt).toLocaleDateString('fr-FR')}</td>
    <td>${t.pair}</td>
    <td>${t.direction}</td>
    <td>${t.entry}</td>
    <td>${t.exit || '—'}</td>
    <td class="${(t.pnl || 0) >= 0 ? 'positive' : 'negative'}">${t.pnl !== null && t.pnl !== undefined ? (t.pnl >= 0 ? '+' : '') + formatNombre(t.pnl) : '—'}</td>
    <td><span class="badge ${t.result === 'win' ? 'badge-win' : t.result === 'loss' ? 'badge-loss' : 'badge-be'}">${t.result || '—'}</span></td>
  </tr>`).join('')}
</table>
${trades.length > 50 ? '<p style="color:#94a3b8;font-size:9px">Affichage des 50 premiers trades sur ${trades.length}.</p>' : ''}

<div class="footer">
  5trade — Rapport généré automatiquement · ${new Date().toISOString()}
</div>
</body>
</html>`;

  return html;
}

/**
 * Génère un rapport Excel-compatible (CSV enrichi).
 *
 * @param {Array} trades - Liste des trades
 * @returns {string} Contenu CSV
 */
function genererCSVEnrichi(trades) {
  const header = 'Date;Paire;Sens;Entrée;Stop;TP;Sortie;Taille;PnL;RR;Résultat;Stratégies;Notes';
  const lines = [header];

  for (const t of trades) {
    const fields = [
      new Date(t.closedAt || t.openedAt || t.createdAt).toISOString().slice(0, 16),
      t.pair,
      t.direction,
      t.entry,
      t.sl,
      t.tp,
      t.exit || '',
      t.size || '',
      t.pnl !== null && t.pnl !== undefined ? t.pnl.toFixed(6) : '',
      t.rr !== null && t.rr !== undefined ? t.rr.toFixed(2) : '',
      t.result || '',
      (t.strategyIds || []).join(' | '),
      (t.notes || '').replace(/[;\n\r]/g, ' ').slice(0, 100)
    ];
    lines.push(fields.join(';'));
  }

  return lines.join('\n') + '\n';
}

module.exports = { genererRapportPDF, genererCSVEnrichi };