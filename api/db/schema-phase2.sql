-- 5trade — schéma phase 2 (registre de stratégies, preuves, signaux, backtests)
--
-- RÈGLE ABSOLUE : ce fichier est ADDITIF. Uniquement des CREATE ... IF NOT EXISTS.
-- Aucun DROP, aucun ALTER sur les tables existantes (kv, strategies, trades), aucune
-- donnée touchée. Il peut être rejoué autant de fois que nécessaire.
--
-- Objectif : pouvoir répondre après coup à « pourquoi ce signal a-t-il été produit
-- à cet instant ? » — version exacte des règles, conditions vérifiées, données de
-- référence, paramètres.

-- ── Instruments : ce que le moteur sait réellement du contrat ────────────────
-- Les spécifications viennent du fournisseur. Une valeur NULL signifie « inconnue »,
-- jamais « zéro » : le moteur doit refuser de dimensionner sans tick value.
CREATE TABLE IF NOT EXISTS instruments (
  symbole         text PRIMARY KEY,
  classe          text NOT NULL CHECK (classe IN ('forex','indices','metaux','energies','crypto','synthetique','inconnu')),
  devise_base     text,
  devise_cote     text,
  fournisseur     text,
  tick_size       numeric,
  tick_value      numeric,
  taille_contrat  numeric,
  spread_typique  numeric,
  devise_compte   text,
  continu         boolean,
  source          text NOT NULL DEFAULT 'symbole' CHECK (source IN ('symbole','metadonnees','manuel')),
  maj_le          timestamptz NOT NULL DEFAULT now()
);

-- ── Instantanés de marché : régime + volatilité à un instant donné ──────────
CREATE TABLE IF NOT EXISTS market_profiles (
  id            bigserial PRIMARY KEY,
  symbole       text NOT NULL,
  timeframe     text NOT NULL,
  regime        text NOT NULL,
  confiance     numeric NOT NULL CHECK (confiance >= 0 AND confiance <= 1),
  mesures       jsonb NOT NULL DEFAULT '{}'::jsonb,
  sessions      text[] NOT NULL DEFAULT '{}',
  at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_market_profiles_symbole ON market_profiles (symbole, timeframe, at DESC);

-- ── Fiches de stratégie, versionnées ────────────────────────────────────────
-- Une fiche publiée ne se modifie pas : on insère une nouvelle version. Le hash
-- permet de prouver que la fiche utilisée est celle qui a été validée.
CREATE TABLE IF NOT EXISTS strategy_versions (
  strategie_id  text NOT NULL,
  version       text NOT NULL CHECK (version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  fiche         jsonb NOT NULL,
  hash          text NOT NULL,
  etat          text NOT NULL DEFAULT 'brouillon' CHECK (etat IN ('brouillon','testee','validee','retiree')),
  cree_le       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (strategie_id, version)
);

-- ── Une évaluation = une exécution de stratégie sur un instrument ───────────
CREATE TABLE IF NOT EXISTS strategy_evaluations (
  id             bigserial PRIMARY KEY,
  strategie_id   text NOT NULL,
  version        text NOT NULL,
  symbole        text NOT NULL,
  timeframe      text NOT NULL,
  regime         text,
  statut         text NOT NULL CHECK (statut IN ('VALID','WAITING','INVALID','NO_DATA')),
  direction      text CHECK (direction IN ('BUY','SELL',NULL)),
  conditions     jsonb NOT NULL DEFAULT '{}'::jsonb,
  manquantes     text[] NOT NULL DEFAULT '{}',
  score          numeric,
  duree_ms       integer,
  at             timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (strategie_id, version) REFERENCES strategy_versions (strategie_id, version) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_evaluations_strategie ON strategy_evaluations (strategie_id, version, at DESC);
CREATE INDEX IF NOT EXISTS idx_evaluations_symbole ON strategy_evaluations (symbole, timeframe, at DESC);

-- ── Signaux publiés : un seul par évaluation ────────────────────────────────
CREATE TABLE IF NOT EXISTS signals (
  id             bigserial PRIMARY KEY,
  evaluation_id  bigint NOT NULL UNIQUE REFERENCES strategy_evaluations (id) ON DELETE RESTRICT,
  strategie_id   text NOT NULL,
  version        text NOT NULL,
  symbole        text NOT NULL,
  timeframe      text NOT NULL,
  direction      text NOT NULL CHECK (direction IN ('BUY','SELL')),
  entree         numeric,
  stop           numeric,
  objectifs      numeric[] NOT NULL DEFAULT '{}',
  rr             numeric,
  statut         text NOT NULL DEFAULT 'PUBLISHED'
                 CHECK (statut IN ('ANALYZING','WAITING','CONFIRMED','PUBLISHED','ACTIVE','TP1','TP2','SL','EXPIRED','CANCELLED')),
  at             timestamptz NOT NULL DEFAULT now(),
  expire_le      timestamptz
);
CREATE INDEX IF NOT EXISTS idx_signals_ouvert ON signals (symbole, timeframe, statut);

-- ── Preuves : la condition, et ce qui l'a remplie ───────────────────────────
-- C'est cette table qui permet de dire « MSS non confirmé » au lieu de « signal
-- bloqué » sans explication.
CREATE TABLE IF NOT EXISTS signal_evidence (
  id          bigserial PRIMARY KEY,
  signal_id   bigint REFERENCES signals (id) ON DELETE CASCADE,
  evaluation_id bigint REFERENCES strategy_evaluations (id) ON DELETE CASCADE,
  condition   text NOT NULL,
  obligatoire boolean NOT NULL DEFAULT false,
  remplie     boolean NOT NULL,
  valeur      jsonb,
  detail      text,
  CHECK (signal_id IS NOT NULL OR evaluation_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_evidence_signal ON signal_evidence (signal_id);
CREATE INDEX IF NOT EXISTS idx_evidence_evaluation ON signal_evidence (evaluation_id);

-- ── Backtests : résultats par stratégie, version, instrument, période ───────
CREATE TABLE IF NOT EXISTS backtest_results (
  id            bigserial PRIMARY KEY,
  strategie_id  text NOT NULL,
  version       text NOT NULL,
  symbole       text NOT NULL,
  timeframe     text NOT NULL,
  periode_debut timestamptz NOT NULL,
  periode_fin   timestamptz NOT NULL,
  trades        integer NOT NULL DEFAULT 0,
  metriques     jsonb NOT NULL DEFAULT '{}'::jsonb,
  couts_inclus  boolean NOT NULL DEFAULT false,
  echantillon_hors boolean NOT NULL DEFAULT false,
  at            timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (strategie_id, version) REFERENCES strategy_versions (strategie_id, version) ON DELETE RESTRICT,
  CHECK (periode_fin > periode_debut)
);
CREATE INDEX IF NOT EXISTS idx_backtest_strategie ON backtest_results (strategie_id, version, symbole);

-- ── Bougies historiques : la matière première de toute calibration ──────────
-- Sans plusieurs mois de bougies, aucun réglage de seuil n'est autre chose qu'un
-- ajustement sur trois jours. Une ligne = une bougie CLÔTURÉE d'un fournisseur.
-- Clé primaire (symbole, timeframe, t) : réingérer le même historique ne crée
-- aucun doublon, il complète les trous.
CREATE TABLE IF NOT EXISTS candles (
  symbole     text NOT NULL,
  timeframe   text NOT NULL,
  t           bigint NOT NULL,
  o           numeric NOT NULL,
  h           numeric NOT NULL,
  l           numeric NOT NULL,
  c           numeric NOT NULL,
  v           numeric,
  fournisseur text,
  ingere_le   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (symbole, timeframe, t),
  CHECK (h >= l),
  CHECK (c >= l AND c <= h),
  CHECK (o >= l AND o <= h)
);
CREATE INDEX IF NOT EXISTS idx_candles_serie ON candles (symbole, timeframe, t DESC);

-- ── Journal d'audit : qui a fait quoi, quand ────────────────────────────────
-- Les actions sensibles (connexion, changement de configuration, sauvegarde,
-- restauration, enregistrement de stratégie) doivent laisser une trace même
-- quand tout va bien : c'est la seule façon de reconstituer un incident.
-- Aucun secret n'y est écrit (jamais de mot de passe, jeton ou clé).
CREATE TABLE IF NOT EXISTS audit_log (
  id         bigserial PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  acteur     text,
  action     text NOT NULL,
  cible      text,
  detail     jsonb,
  ip         text,
  succes     boolean NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log (at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log (action, at DESC);
