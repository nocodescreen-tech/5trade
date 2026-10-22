"""
5trade — BASELINE HONNÊTE.

But : répondre à UNE question, sans embellissement — les features que le moteur
mesure contiennent-elles un signal exploitable pour prévoir l'issue d'un trade ?

Trois règles, et elles décident de tout :

1. VALIDATION WALK-FORWARD PURGÉE. On entraîne sur le passé, on teste sur la
   suite, jamais l'inverse. Une purge est appliquée entre train et test : un
   trade qui dure 60 bougies partage son futur avec les trades voisins, donc
   les laisser des deux côtés ferait fuiter l'information. Sans purge, un modèle
   « excellent » n'a rien appris.

2. LA BARRE EST CHIFFRÉE. Le moteur seul sort ~35 % de réussite et +0,13 R par
   trade. Un modèle qui ne bat pas ça ne sert à rien, même avec un bel AUC.

3. LES FRAIS SONT RETIRÉS. Le R du jeu de données est brut (spread à zéro à la
   génération). On applique ici le coût par marché pour ne pas refaire l'erreur
   qu'on vient de corriger : un R qui ignore le spread n'est pas un gain.

Ce script ne fait AUCUN apprentissage profond : régression logistique, et un
gradient boosting en second. Sur quelques milliers de lignes, un réseau de
neurones n'apprendrait que du bruit.

Usage :
    .venv/Scripts/python baseline.py ../data/dataset/deriv-R_75-5m.jsonl [...]
"""

import json
import re
import sys
from pathlib import Path

import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

TF_MINUTES = {"1m": 1, "5m": 5, "15m": 15, "1h": 60, "4h": 240, "1d": 1440}
EMBARGO_BOUGIES = 60          # horizon maximal suivi par le journal

# Coût par trade, en unités de prix (les mêmes valeurs que data/frais.json).
# Le R brut du jeu de données ne les contient pas encore : on les retire ici.
SPREADS = {
    "frxXAUUSD": 0.30, "BTCUSDT": 0.01, "ETHUSDT": 0.05, "R_75": 0.80,
    "R_10": 0.25, "BOOM500": 0.50, "1HZ100V": 0.50, "frxXAGUSD": 0.03,
}
COMMISSIONS = {"BTCUSDT": 0.001, "ETHUSDT": 0.001}   # fraction du notionnel


def charger(chemins):
    lignes = []
    for chemin in chemins:
        p = Path(chemin)
        for ligne in p.read_text(encoding="utf-8").splitlines():
            if ligne.strip():
                lignes.append(json.loads(ligne))
    lignes.sort(key=lambda r: (r["at"], r["symbol"]))
    return lignes


def nombre_depuis_texte(txt):
    if txt is None:
        return None
    if isinstance(txt, (int, float)):
        return float(txt)
    m = re.search(r"-?\d+(?:[.,]\d+)?", str(txt).replace("\u202f", ""))
    return float(m.group(0).replace(",", ".")) if m else None


def construire_matrices(lignes):
    """Features numériques + indicatrices. Aucune donnée de l'issue n'entre ici."""
    noms_conditions = []
    vus = set()
    for r in lignes:
        for c in r.get("conditions") or []:
            if c.get("nom") and c["nom"] not in vus:
                vus.add(c["nom"])
                noms_conditions.append(c["nom"])

    def valeur_numerique(c):
        v = c.get("valeur")
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            return float(v)
        return None

    lignes_x = []
    for r in lignes:
        f = {}
        f["force"] = r.get("force") or 0.0
        f["force_avant"] = r.get("forceAvant") or 0.0
        f["ajustement"] = r.get("ajustement") or 0.0
        f["conditions_ok"] = r.get("conditionsOk") or 0
        f["conditions_total"] = len(r.get("conditions") or [])
        f["sens_long"] = 1.0 if r.get("sens") == "long" else 0.0
        niv = r.get("niveaux") or {}
        f["risque_pct_prix"] = niv.get("risquePctPrix") or 0.0
        f["rr"] = niv.get("rr") or 0.0
        carte = r.get("carte") or {}
        st = r.get("structure") or {}
        f["atr_rel"] = (carte.get("atr") or 0.0) / (carte.get("prix") or 1.0)
        f["ajust_structure"] = st.get("ajustement") or 0.0
        f["favorables"] = st.get("favorables") or 0
        f["defavorables"] = st.get("defavorables") or 0
        f["nb_zones"] = carte.get("zones") or 0
        f["nb_liquidites"] = carte.get("liquidites") or 0
        f["nb_balayages"] = carte.get("balayages") or 0
        f["nb_deplacements"] = carte.get("deplacements") or 0

        for cle, champ in (
            ("tendance", carte.get("tendance")),
            ("position", carte.get("positionZone")),
            ("alignement", st.get("alignement")),
            ("source", r.get("source")),
            ("session", carte.get("session")),
            ("killzone", carte.get("killZone")),
            ("id", r.get("id")),
        ):
            f[f"{cle}={champ}"] = 1.0

        par_nom = {c.get("nom"): c for c in (r.get("conditions") or [])}
        for nom in noms_conditions:
            c = par_nom.get(nom)
            if not c:
                continue
            f[f"ok:{nom}"] = 1.0 if c.get("ok") else 0.0
            v = valeur_numerique(c)
            if v is not None:
                f[f"val:{nom}"] = v
                seuil = nombre_depuis_texte(c.get("seuil"))
                if seuil:
                    # Écart RELATIF au seuil : c'est ce qui distingue « 34 pour un
                    # seuil de 48 » de « 47 pour un seuil de 48 », que la valeur
                    # brute seule ne dit pas.
                    f[f"ratio:{nom}"] = v / seuil if seuil else 0.0
        lignes_x.append(f)

    colonnes = sorted({k for f in lignes_x for k in f})
    X = np.array([[f.get(c, 0.0) for c in colonnes] for f in lignes_x], dtype=float)
    return X, colonnes


def cout_en_r(r):
    """Coût du trade exprimé en R (spread + commission, sur le risque)."""
    niv = r.get("niveaux") or {}
    risque = float(niv.get("risque") or 0)
    entree = float(niv.get("entree") or 0)
    if risque <= 0 or entree <= 0:
        return 0.0
    spread = SPREADS.get(r.get("symbol"), 0.0)
    commission = COMMISSIONS.get(r.get("symbol"), 0.0) * entree * 2
    return (spread + commission) / risque


def main(chemins):
    lignes = charger(chemins)
    if not lignes:
        print("aucune ligne : lancer dataset.js d'abord")
        return 1

    X, colonnes = construire_matrices(lignes)
    y = np.array([1 if r.get("gagne") else 0 for r in lignes], dtype=int)
    r_brut = np.array([float((r.get("issue") or {}).get("r") or 0.0) for r in lignes])
    couts = np.array([cout_en_r(r) for r in lignes])
    r_net = r_brut - couts
    at = np.array([r["at"] for r in lignes], dtype=np.int64)
    tf_min = TF_MINUTES.get(lignes[0].get("tf"), 5)
    embargo_ms = EMBARGO_BOUGIES * tf_min * 60_000

    print(f"lignes            : {len(lignes)}")
    print(f"features          : {X.shape[1]} colonnes")
    print(f"taux de base      : {y.mean() * 100:.1f} % de trades gagnants")
    print(f"R brut / trade    : {r_brut.mean():+.3f}")
    print(f"coût / trade      : {couts.mean():.3f} R")
    print(f"R net / trade     : {r_net.mean():+.3f}")
    print()

    # ── Walk-forward chronologique, avec purge ──────────────────────────────
    # 5 blocs : on entraîne sur tout ce qui précède, on teste sur le bloc.
    # Les lignes de train trop proches du début du test sont retirées (embargo).
    ordre = np.argsort(at)
    X, y, r_brut, r_net, at = X[ordre], y[ordre], r_brut[ordre], r_net[ordre], at[ordre]
    n = len(y)
    bornes = [int(n * k / 6) for k in range(1, 7)]

    modeles = {
        "logistique": lambda: make_pipeline(StandardScaler(), LogisticRegression(max_iter=2000, C=1.0)),
        "gradient boosting": lambda: HistGradientBoostingClassifier(
            max_depth=4, max_iter=200, learning_rate=0.06, min_samples_leaf=40,
            l2_regularization=1.0, random_state=0),
    }

    resultats = {}
    for nom, fabrique in modeles.items():
        aucs, briers, preds, verites = [], [], [], []
        ecarts = []
        for i in range(len(bornes) - 1):
            debut_test, fin_test = bornes[i], bornes[i + 1]
            if debut_test < 200:
                continue
            t_debut = at[debut_test]
            masque_train = at[:debut_test] < (t_debut - embargo_ms)
            idx_train = np.where(masque_train)[0]
            if len(idx_train) < 200 or len(np.unique(y[idx_train])) < 2:
                continue
            m = fabrique()
            m.fit(X[idx_train], y[idx_train])
            p = m.predict_proba(X[debut_test:fin_test])[:, 1]
            yt = y[debut_test:fin_test]
            preds.append(p)
            verites.append(yt)
            if len(np.unique(yt)) > 1:
                aucs.append(roc_auc_score(yt, p))
            briers.append(brier_score_loss(yt, p))
            # Économie du bloc : le modèle ne prend que ce qu'il juge favorable.
            for seuil in (0.5, 0.6):
                pris = p >= seuil
                if pris.sum() >= 5:
                    ecarts.append((seuil, int(pris.sum()), float(r_net[debut_test:fin_test][pris].mean())))

        if not preds:
            print(f"{nom:18} : aucun pli exploitable")
            continue
        p_all = np.concatenate(preds)
        y_all = np.concatenate(verites)
        resultats[nom] = {"auc": float(np.mean(aucs)) if aucs else None,
                          "brier": float(np.mean(briers)), "p": p_all, "y": y_all, "ecarts": ecarts}

        print(f"── {nom}")
        print(f"   AUC moyen (plis)      : {np.mean(aucs):.3f}" if aucs else "   AUC : n/a")
        print(f"   score de Brier        : {np.mean(briers):.4f}  (plus bas = mieux ; 0,25 = hasard)")
        print("   calibration (prédit → réel) :")
        for lo, hi in ((0.0, 0.2), (0.2, 0.35), (0.35, 0.5), (0.5, 0.65), (0.65, 1.0)):
            m = (p_all >= lo) & (p_all < hi)
            if m.sum() >= 30:
                print(f"      {lo:.2f}-{hi:.2f} : prédit {p_all[m].mean() * 100:5.1f} %  "
                      f"réel {y_all[m].mean() * 100:5.1f} %  n={int(m.sum())}")
        for seuil in (0.5, 0.6):
            lignes_e = [e for e in ecarts if e[0] == seuil]
            if lignes_e:
                pris = sum(e[1] for e in lignes_e)
                r = float(np.mean([e[2] for e in lignes_e]))
                print(f"   seuil {seuil} : {pris} trades pris, R net moyen {r:+.3f}")
        print()

    # ── Référence : ne rien filtrer du tout ────────────────────────────────
    print(f"── référence (aucun modèle) : {n} trades, R net moyen {r_net.mean():+.3f}, "
          f"réussite {y.mean() * 100:.1f} %")

    # ── Le R ATTENDU, qui est la vraie cible ───────────────────────────────
    # Prédire « gagne / perd » optimise le TAUX DE RÉUSSITE, pas le résultat.
    # Mesuré : les trades que le classifieur préfère ont un petit objectif —
    # donc un gain fréquent mais minuscule, et le R moyen des trades retenus
    # devient négatif alors que le taux monte.
    #
    # Trois formulations sont comparées, parce que le R est une cible TRÈS
    # asymétrique (perte bornée à −1, gain jusqu'à +4) :
    #  a) moindres carrés        : la plus simple, mais dominée par les gros gains
    #  b) erreur absolue         : prédit la MÉDIANE, insensible aux extrêmes
    #  c) classes puis espérance : P(tp2/tp1/be/perte) × R moyen de chaque classe,
    #     ce qui respecte la structure de paiement au lieu de la moyenner
    def classe_de(resultat):
        if resultat == 'tp2': return 'tp2'
        if resultat == 'tp1': return 'tp1'
        if resultat == 'be': return 'be'
        return 'perte'

    y_cls = np.array([classe_de((r.get('issue') or {}).get('resultat')) for r in lignes])

    approches = {
        "R (moindres carrés)": lambda: HistGradientBoostingRegressor(
            max_depth=3, max_iter=200, learning_rate=0.05, min_samples_leaf=50,
            l2_regularization=1.0, loss="squared_error", random_state=0),
        "R (erreur absolue)": lambda: HistGradientBoostingRegressor(
            max_depth=3, max_iter=200, learning_rate=0.05, min_samples_leaf=50,
            l2_regularization=1.0, loss="absolute_error", random_state=0),
        "R attendu par classes": None,      # traitement séparé ci-dessous
    }

    print("\n── Viser le R (au lieu du taux de réussite)")
    print(f"   référence : {n} trades, R net moyen {r_net.mean():+.3f}")
    print("   (gain = R net du top 10 % MOINS le R net du pli, quantile calculé DANS le pli)")

    for nom, fabrique in approches.items():
        gains = []
        for i in range(len(bornes) - 1):
            debut_test, fin_test = bornes[i], bornes[i + 1]
            if debut_test < 200:
                continue
            t_debut = at[debut_test]
            idx_train = np.where(at[:debut_test] < (t_debut - embargo_ms))[0]
            if len(idx_train) < 300:
                continue
            Xtr, Xte = X[idx_train], X[debut_test:fin_test]
            rtr, rte = r_net[idx_train], r_net[debut_test:fin_test]
            if len(rte) < 50:
                continue

            if fabrique is None:
                # (c) classes puis espérance de gain
                clf = HistGradientBoostingClassifier(
                    max_depth=3, max_iter=200, learning_rate=0.05,
                    min_samples_leaf=50, l2_regularization=1.0, random_state=0)
                clf.fit(Xtr, y_cls[idx_train])
                probas = clf.predict_proba(Xte)
                etiquettes = list(clf.classes_)
                moyennes = np.array([
                    rtr[y_cls[idx_train] == c].mean() if (y_cls[idx_train] == c).any() else 0.0
                    for c in etiquettes
                ])
                pred = probas @ moyennes
            else:
                m = fabrique()
                m.fit(Xtr, rtr)
                pred = m.predict(Xte)

            seuil_q = np.quantile(pred, 0.90)
            sel = pred >= seuil_q
            if sel.sum() >= 10:
                gains.append(float(rte[sel].mean() - rte.mean()))

        if not gains:
            print(f"   {nom:24} : aucun pli exploitable")
            continue
        positifs = sum(1 for g in gains if g > 0)
        moyenne = float(np.mean(gains))
        verdict = "STABLE" if positifs >= len(gains) - 1 and moyenne > 0.03 else "instable"
        print(f"   {nom:24} : plis " + ", ".join(f"{g:+.3f}" for g in gains)
              + f"  → {positifs}/{len(gains)} positifs, moyenne {moyenne:+.3f}  [{verdict}]")
    print()
    meilleur = max((v["auc"] for v in resultats.values() if v["auc"]), default=None)
    if meilleur is not None:
        print(f"\nmeilleur AUC : {meilleur:.3f} — "
              f"{'au-dessus du hasard' if meilleur > 0.52 else 'proche du hasard : PAS de signal exploitable ici'}")
    return 0


if __name__ == "__main__":
    args = sys.argv[1:] or ["../data/dataset/deriv-R_75-5m.jsonl"]
    sys.exit(main(args))
