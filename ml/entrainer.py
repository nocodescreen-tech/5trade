"""
5trade — ENTRAÎNEMENT FINAL ET EXPORT PORTABLE.

Produit deux fichiers versionnés, que le serveur Node utilise SANS Python :

  models/modele-r.json          l'ensemble d'arbres + la spec des features
  models/echantillon-parite.json  quelques vraies lignes + la prédiction attendue

Pourquoi exporter plutôt que lancer un service Python : le direct doit rester
local, hors ligne, sans process supplémentaire à surveiller. Un arbre de
décision se sérialise exactement — vérifié : l'écart entre la prédiction sklearn
et la reconstruction manuelle est **0,000**.

Formule retenue (mesurée, pas supposée) :
  prédiction = base + SOMME des valeurs de feuilles
Le learning rate est déjà incorporé dans les feuilles par sklearn : le
réappliquer diviserait la prédiction par 10. C'est l'erreur qui a coûté la
première sonde.

Usage :
  .venv/Scripts/python.exe entrainer.py ../data/dataset/deriv-R_75-5m.jsonl ../data/dataset/deriv-frxXAUUSD-5m.jsonl
"""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import mean_absolute_error

import baseline as B

MODELES = Path(__file__).resolve().parent.parent / "models"
MAX_ITER = 200
PROFONDEUR = 3
TAUX = 0.05
FEUILLE_MIN = 50
L2 = 1.0


def exporter(modele, spec, colonnes, meta):
    """Sérialise l'ensemble d'arbres. Une feuille porte sa valeur, un noeud son test."""
    base = [float(x) for x in np.ravel(modele._baseline_prediction)]
    arbres = []
    for iteration in modele._predictors:
        for t in iteration:
            noeuds = []
            for n in t.nodes:
                v = n["value"]
                valeur = float(v) if not hasattr(v, "__len__") else float(np.ravel(v)[0])
                noeuds.append({
                    "feuille": bool(n["is_leaf"]),
                    "valeur": round(valeur, 10),
                    # feature_idx vaut -1 sur une feuille ; on l'expose tel quel
                    # pour que Node n'ait pas à le deviner.
                    "f": int(n["feature_idx"]),
                    "seuil": float(n["num_threshold"]),
                    "g": int(n["left"]),
                    "d": int(n["right"]),
                    # Une valeur manquante part à gauche par défaut chez sklearn.
                    "manquantGauche": bool(n["missing_go_to_left"])
                })
            arbres.append(noeuds)
    return {
        "version": 1,
        "cree": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "formule": "base + somme(feuilles)",
        "base": base,
        "arbres": arbres,
        "features": colonnes,
        "spec": spec,
        "meta": meta
    }


def predire_manuel(modele_json, x):
    """Rejoue le modèle SANS sklearn : c'est exactement ce que fait api/modele.js."""
    s = modele_json["base"][0]
    for noeuds in modele_json["arbres"]:
        i = 0
        while True:
            n = noeuds[i]
            if n["feuille"]:
                s += n["valeur"]
                break
            v = x[n["f"]]
            if v != v:                                  # NaN
                i = n["g"] if n["manquantGauche"] else n["d"]
            else:
                i = n["g"] if v <= n["seuil"] else n["d"]
    return s


def main(chemins):
    lignes = B.charger(chemins)
    if len(lignes) < 2000:
        print(f"trop peu de lignes ({len(lignes)}) : construire les jeux de données d'abord")
        return 1

    X, spec, colonnes = B.construire_matrices(lignes)
    r_net = np.array([
        float((r.get("issue") or {}).get("r") or 0.0) - B.cout_en_r(r) for r in lignes
    ])
    at = np.array([r["at"] for r in lignes], dtype=np.int64)
    ordre = np.argsort(at)
    X, r_net = X[ordre], r_net[ordre]

    # On garde les 15 % LES PLUS RÉCENTS pour mesurer, jamais pour entraîner.
    coupe = int(len(r_net) * 0.85)
    Xtr, Xte = X[:coupe], X[coupe:]
    ytr, yte = r_net[:coupe], r_net[coupe:]

    modele = HistGradientBoostingRegressor(
        max_depth=PROFONDEUR, max_iter=MAX_ITER, learning_rate=TAUX,
        min_samples_leaf=FEUILLE_MIN, l2_regularization=L2,
        loss="squared_error", random_state=0)
    modele.fit(Xtr, ytr)

    p_sk = modele.predict(Xte)
    mae = float(mean_absolute_error(yte, p_sk))
    base_test = float(yte.mean())
    seuil = float(np.quantile(p_sk, 0.90))
    pris = p_sk >= seuil
    gain = float(yte[pris].mean() - base_test)

    marches = sorted({r["symbol"] for r in lignes})
    # Seuil recommandé = celui du décile supérieur observé sur la partie TEST.
    # C'est la configuration validée en walk-forward (top 10 % : 5 plis sur 5
    # positifs). Il n'est PAS appliqué par défaut : refuser 90 % des signaux est
    # une décision de produit, pas une évidence technique.
    seuil_top10 = float(np.quantile(p_sk, 0.90))
    meta = {
        "marches": marches,
        "lignes": len(lignes),
        "entrainement": coupe,
        "test": len(yte),
        "du": int(at.min()),
        "au": int(at.max()),
        "r_net_moyen_brut": round(base_test, 4),
        "r_net_moyen_top10": round(float(yte[pris].mean()), 4),
        "gain_top10_holdout": round(gain, 4),
        "seuil_top10": round(seuil_top10, 4),
        "mae": round(mae, 4),
        "features": len(colonnes),
        "arbres": sum(len(i) for i in modele._predictors),
        "hyperparametres": {
            "max_depth": PROFONDEUR, "max_iter": MAX_ITER, "learning_rate": TAUX,
            "min_samples_leaf": FEUILLE_MIN, "l2_regularization": L2,
            "loss": "squared_error"
        }
    }

    donnees = exporter(modele, spec, colonnes, meta)

    # Vérification d'export : la reconstruction sans sklearn doit coller au bit près.
    ecarts = [abs(predire_manuel(donnees, Xte[i]) - p_sk[i]) for i in range(min(300, len(Xte)))]
    ecart_max = float(max(ecarts)) if ecarts else None
    print(f"lignes            : {len(lignes)}  ({', '.join(marches)})")
    print(f"features          : {len(colonnes)}")
    print(f"arbres            : {meta['arbres']}")
    print(f"test (15 % récent): R net moyen {base_test:+.3f} → top 10 % {meta['r_net_moyen_top10']:+.3f} "
          f"(gain {gain:+.3f})")
    print(f"MAE               : {mae:.4f}")
    print(f"export vs sklearn : écart max {ecart_max:.3e}")

    if ecart_max is None or ecart_max > 1e-9:
        print("EXPORT REFUSÉ : la reconstruction ne reproduit pas sklearn")
        return 1

    MODELES.mkdir(parents=True, exist_ok=True)
    (MODELES / "modele-r.json").write_text(json.dumps(donnees, ensure_ascii=False), encoding="utf-8")

    # Échantillon de parité : de VRAIES lignes, avec la prédiction attendue.
    # Le canonique Node rejoue ces lignes et doit retrouver les mêmes valeurs.
    indices = np.linspace(0, len(Xte) - 1, min(120, len(Xte))).astype(int)
    echantillon = [{
        "entree": lignes[ordre[coupe + i]],
        "attendu": round(float(p_sk[i]), 10)
    } for i in indices]
    (MODELES / "echantillon-parite.json").write_text(
        json.dumps(echantillon, ensure_ascii=False), encoding="utf-8")

    print(f"écrit             : models/modele-r.json "
          f"({(MODELES / 'modele-r.json').stat().st_size // 1024} Ko), "
          f"models/echantillon-parite.json ({len(echantillon)} lignes)")
    return 0


if __name__ == "__main__":
    args = sys.argv[1:] or [
        "../data/dataset/deriv-R_75-5m.jsonl",
        "../data/dataset/deriv-R_75-15m.jsonl",
        "../data/dataset/deriv-R_75-1h.jsonl",
        "../data/dataset/deriv-frxXAUUSD-5m.jsonl",
        "../data/dataset/deriv-frxXAUUSD-15m.jsonl",
        "../data/dataset/deriv-frxXAUUSD-1h.jsonl",
    ]
    sys.exit(main(args))
