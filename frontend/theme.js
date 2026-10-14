/**
 * 5trade — thème + raccourcis clavier.
 *
 * DÉCISION : l'application est verrouillée en thème SOMBRE.
 * Le thème clair rendait une partie de l'interface illisible (couleurs
 * codées en dur pour le sombre dans des centaines d'endroits) : plutôt
 * qu'un thème à moitié cassé, il n'y en a qu'un seul qui marche.
 * Un vrai thème clair demanderait de revoir toutes les couleurs — chantier
 * séparé, pas un interrupteur.
 *
 * L'API est conservée (appliquer/basculer/actuel) pour ne rien casser chez
 * les appelants, mais tout appel mène au sombre.
 *
 * Raccourcis restants :
 *   1..5  → onglets principaux
 *   r     → rafraîchir les données
 *   ?     → aide
 *   Échap → fermer / annuler
 */
(function () {
  const CLE = '5trade-theme';

  const ThemeManager = {
    /** Thème actuellement appliqué : toujours 'sombre'. */
    actuel() {
      return 'sombre';
    },

    /** Applique le thème sombre et le mémorise (tout autre choix est ignoré). */
    appliquer() {
      document.documentElement.removeAttribute('data-theme');
      try { localStorage.setItem(CLE, 'sombre'); } catch {}
      try { localStorage.removeItem('theme'); } catch {}
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', '#070a11');
      window.dispatchEvent(new CustomEvent('5trade-theme', { detail: 'sombre' }));
      return 'sombre';
    },

    /** Bascule désactivée : renvoie 'sombre' sans rien changer. */
    basculer() {
      return ThemeManager.appliquer();
    },

    /** Force le sombre au démarrage (répare les navigateurs restés en clair). */
    init() {
      ThemeManager.appliquer();
    }
  };

  // Applique avant le premier rendu React pour éviter un clignotement.
  ThemeManager.init();

  // ─── Raccourcis clavier ────────────────────────────────────────
  const Raccourcis = (() => {
    const actions = new Map();
    let actif = true;

    const dansUnChamp = () =>
      ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement && document.activeElement.tagName);

    function enregistrer(combo, action, description) {
      actions.set(combo.toLowerCase(), { action, description });
    }

    function gerer(e) {
      if (!actif || dansUnChamp()) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;   // on laisse le navigateur
      const combo = e.key.toLowerCase();
      const r = actions.get(combo);
      if (!r) return;
      e.preventDefault();
      r.action(e);
    }

    enregistrer('1', () => window.dispatchEvent(new CustomEvent('5trade-nav', { detail: 'live' })), 'Onglet Direct');
    enregistrer('2', () => window.dispatchEvent(new CustomEvent('5trade-nav', { detail: 'analyze' })), 'Onglet Analyse');
    enregistrer('3', () => window.dispatchEvent(new CustomEvent('5trade-nav', { detail: 'strategies' })), 'Onglet Stratégies');
    enregistrer('4', () => window.dispatchEvent(new CustomEvent('5trade-nav', { detail: 'journal' })), 'Onglet Journal');
    enregistrer('5', () => window.dispatchEvent(new CustomEvent('5trade-nav', { detail: 'alerts' })), 'Onglet Alertes');
    enregistrer('r', () => window.dispatchEvent(new CustomEvent('5trade-refresh')), 'Rafraîchir les données');
    enregistrer('escape', () => window.dispatchEvent(new CustomEvent('5trade-escape')), 'Fermer / annuler');

    document.addEventListener('keydown', gerer);

    return {
      enregistrer,
      lister: () => [...actions.entries()].map(([combo, i]) => ({ combo, description: i.description })),
      activer: () => { actif = true; },
      desactiver: () => { actif = false; }
    };
  })();

  window.ThemeManager = ThemeManager;
  window.Raccourcis = Raccourcis;
})();
