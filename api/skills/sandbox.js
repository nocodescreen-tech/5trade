'use strict';

// No in-process evaluator is a security boundary for untrusted code.
function creerContexteSecurise() {
  throw new Error('Sandbox JavaScript désactivée.');
}

function chargerDansSandbox() {
  return { ok: false, erreur: 'Exécution de code non approuvé interdite.' };
}

// Reserved for reviewed native functions. The timeout only bounds awaiting
// asynchronous work; it cannot preempt synchronous JavaScript.
async function executerMethodeSecurisee(methode, args = [], timeoutMs = 5000) {
  if (typeof methode !== 'function') return { ok: false, erreur: 'Méthode invalide' };
  let timer;
  try {
    const resultat = await Promise.race([
      Promise.resolve().then(() => methode(...args)),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Délai dépassé')), timeoutMs);
      })
    ]);
    return { ok: true, resultat };
  } catch (error) {
    return { ok: false, erreur: error.message || String(error) };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { creerContexteSecurise, chargerDansSandbox, executerMethodeSecurisee };
