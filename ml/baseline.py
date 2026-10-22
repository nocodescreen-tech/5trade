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


def spec_features(lignes):
    """
    Décrit COMMENT fabriquer chaque colonne, au lieu de la fabriquer.

    Raison : le serveur Node doit calculer exactement les mêmes features que
    l'entraînement. Deux implémentations écrites à la main divergent tôt ou
    tard, en silence. Ici la liste est produite UNE fois, exportée avec le
    modèle, et Node se contente d'appliquer chaque ligne de la spec. Un test de
    parité vérifie ensuite, sur de vraies lignes, que les deux donnent le même
    vecteur.

    Genres : direct (champ scalaire), cond_ok / cond_val / cond_ratio
    (condition repérée par son nom), dummy (indicatrice d'égalité).
    """
    # Les noms de conditions dépendent des données : ils viennent du jeu lui-même.
    noms_conditions = []
    vus = set()
    for r in lignes:
        for c in r.get("conditions") or []:
            if c.get("nom") and c["nom"] not in vus:
                vus.add(c["nom"])
                noms_conditions.append(c["nom"])

    spec = [
        {"col": "force", "genre": "direct", "champ": "force", "defaut": 0.0},
        {"col": "force_avant", "genre": "direct", "champ": "forceAvant", "defaut": 0.0},
        {"col": "ajustement", "genre": "direct", "champ": "ajustement", "defaut": 0.0},
        {"col": "conditions_ok", "genre": "direct", "champ": "conditionsOk", "defaut": 0},
        {"col": "conditions_total", "genre": "compte", "champ": "conditions"},
        {"col": "sens_long", "genre": "egal", "chemin": "sens", "valeur": "long"},
        {"col": "risque_pct_prix", "genre": "chemin_num", "chemin": "niveaux.risquePctPrix", "defaut": 0.0},
        {"col": "rr", "genre": "chemin_num", "chemin": "niveaux.rr", "defaut": 0.0},
        {"col": "atr_rel", "genre": "atr_relatif"},
        {"col": "ajust_structure", "genre": "chemin_num", "chemin": "structure.ajustement", "defaut": 0.0},
        {"col": "favorables", "genre": "chemin_num", "chemin": "structure.favorables", "defaut": 0},
        {"col": "defavorables", "genre": "chemin_num", "chemin": "structure.defavorables", "defaut": 0},
        {"col": "nb_zones", "genre": "chemin_num", "chemin": "carte.zones", "defaut": 0},
        {"col": "nb_liquidites", "genre": "chemin_num", "chemin": "carte.liquidites", "defaut": 0},
        {"col": "nb_balayages", "genre": "chemin_num", "chemin": "carte.balayages", "defaut": 0},
        {"col": "nb_deplacements", "genre": "chemin_num", "chemin": "carte.deplacements", "defaut": 0},
    ]
    for champ, chemin in (("symbole", "symbol"), ("tf", "tf"),
                          ("tendance", "carte.tendance"), ("position", "carte.positionZone"),
                          ("alignement", "structure.alignement"), ("source", "source"),
                          ("session", "carte.session"), ("killzone", "carte.killZone"),
                          ("id", "id")):
        spec.append({"col": f"{champ}=", "genre": "dummies", "chemin": chemin, "prefixe": f"{champ}="})

    for nom in noms_conditions:
        spec.append({"col": f"ok:{nom}", "genre": "cond_ok", "nom": nom})
        spec.append({"col": f"val:{nom}", "genre": "cond_val", "nom": nom})
        spec.append({"col": f"ratio:{nom}", "genre": "cond_ratio", "nom": nom})
    return spec


def _chemin(objet, chemin, defaut=None):
    courant = objet
    for morceau in chemin.split("."):
        if not isinstance(courant, dict) or morceau not in courant:
            return defaut
        courant = courant[morceau]
    return defaut if courant is None else courant


def _nombre(txt):
    if txt is None:
        return None
    if isinstance(txt, (int, float)) and not isinstance(txt, bool):
        return float(txt)
    m = re.search(r"-?\d+(?:[.,]\d+)?", str(txt).replace("\u202f", ""))
    return float(m.group(0).replace(",", ".")) if m else None


def construire_matrices(lignes, spec=None):
    """
    Construit X à partir de la spec. Rend (X, spec, colonnes).

    Utilise par l'entraînement ET par l'export : la spec part avec le modèle, et
    `api/modele.js` applique la même liste. C'est ce qui rend la parité
    vérifiable au lieu d'être espérée.
    """
    spec = spec or spec_features(lignes)

    # Les indicatrices ont besoin de connaître les modalités présentes.
    modalites = []
    for item in spec:
        if item["genre"] == "dummies":
            valeurs = []
            for r in lignes:
                v = _chemin(r, item["chemin"])
                if isinstance(v, str) and v and v not in valeurs:
                    valeurs.append(v)
                elif isinstance(v, (int, float)) and not isinstance(v, bool):
                    valeurs.append(str(v))
            for v in sorted(set(str(x) for x in valeurs)):
                modalites.append({"col": f"{item['prefixe']}{v}", "genre": "dummy",
                                  "chemin": item["chemin"], "valeur": v})

    toutes = [i for i in spec if i["genre"] != "dummies"] + modalites
    # Les indicatrices de modalités viennent juste après leur famille : l'ordre
    # n'a pas d'importance pour le modèle, mais il doit être STABLE et identique
    # des deux côtés, donc il est figé ici et exporté tel quel.

    def valeur(item, r):
        g = item["genre"]
        if g == "direct":
            v = r.get(item["champ"])
            return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else float(item["defaut"])
        if g == "compte":
            v = r.get(item["champ"])
            return float(len(v)) if isinstance(v, list) else 0.0
        if g == "egal":
            return 1.0 if _chemin(r, item["chemin"]) == item["valeur"] else 0.0
        if g == "dummy":
            v = _chemin(r, item["chemin"])
            return 1.0 if v is not None and str(v) == item["valeur"] else 0.0
        if g == "chemin_num":
            v = _chemin(r, item["chemin"])
            return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else float(item["defaut"])
        if g == "atr_rel":
            atr = _chemin(r, "carte.atr", 0.0) or 0.0
            prix = _chemin(r, "carte.prix", 1.0) or 1.0
            return float(atr) / float(prix)
        if g in ("cond_ok", "cond_val", "cond_ratio"):
            c = next((x for x in (r.get("conditions") or []) if x.get("nom") == item["nom"]), None)
            if not c:
                return 0.0
            if g == "cond_ok":
                return 1.0 if c.get("ok") else 0.0
            v = c.get("valeur")
            num = float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None
            if g == "cond_val":
                return num if num is not None else 0.0
            seuil = _nombre(c.get("seuil"))
            if num is None or not seuil:
                return 0.0
            return num / seuil
        return 0.0

    colonnes = [i["col"] for i in toutes]
    X = np.array([[valeur(item, r) for item in toutes] for r in lignes], dtype=float)
    return X, toutes, colonnes


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

    X, spec, colonnes = construire_matrices(lignes)
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
