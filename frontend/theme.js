/**
 * 5trade — thème clair/sombre + raccourcis clavier.
 *
 * Le thème n'est qu'un attribut `data-theme` sur <html> : toutes les couleurs
 * sont des variables CSS définies dans index.html. Basculer, c'est changer
 * l'attribut — aucun rechargement, aucun aller-retour serveur.
 *
 *   1..5  → onglets principaux
 *   t     → thème clair / sombre
 *   r     → rafraîchir les données
 *   ?     → aide
 *   Échap → fermer / annuler
 */
(function () {
  const CLE = '5trade-theme';

  const ThemeManager = {
    /** Thème actuellement appliqué. */
    actuel() {
      return document.documentElement.getAttribute('data-theme') || 'sombre';
    },

    /** Applique un thème et le mémorise. */
    appliquer(theme) {
      const t = theme === 'clair' ? 'clair' : 'sombre';
      document.documentElement.setAttribute('data-theme', t);
      try { localStorage.setItem(CLE, t); } catch {}
      // Le theme-color du navigateur suit le thème (barre d'adresse mobile).
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', t === 'clair' ? '#f8fafc' : '#070a11');
      window.dispatchEvent(new CustomEvent('5trade-theme', { detail: t }));
      return t;
    },

    /** Bascule clair ↔ sombre et renvoie le nouveau thème. */
    basculer() {
      return ThemeManager.appliquer(ThemeManager.actuel() === 'sombre' ? 'clair' : 'sombre');
    },

    /** Applique le thème memorisé (ou celui du système) au démarrage. */
    init() {
      let t = null;
      try { t = localStorage.getItem(CLE); } catch {}
      if (!t) {
        t = window.matchMedia('(prefers-color-scheme: light)').matches ? 'clair' : 'sombre';
      }
      ThemeManager.appliquer(t);
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
    enregistrer('5', () => window.dispatchEvent(new CustomEvent('5trade-nav', { detail: 'dashboard' })), 'Onglet Dashboard');
    enregistrer('t', () => {
      const t = ThemeManager.basculer();
      window.dispatchEvent(new CustomEvent('5trade-theme', { detail: t }));
    }, 'Basculer thème clair / sombre');
    enregistrer('r', () => window.dispatchEvent(new CustomEvent('5trade-refresh')), 'Rafraîchir les données');
    enregistrer('?', () => window.dispatchEvent(new CustomEvent('5trade-help')), 'Afficher les raccourcis');
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