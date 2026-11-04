/**
 * 5trade — accès S3-compatible (Cloudflare R2), signé AWS SigV4, zéro dépendance.
 *
 * Pourquoi pas @aws-sdk/client-s3 : ~50 Mo de dépendances pour 3 requêtes HTTP.
 * Les identifiants sont lus à l'appel (le .env est chargé par server.js).
 *
 * Variables : S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY, S3_ENDPOINT,
 *             S3_REGION (défaut « auto »), S3_PUBLIC_URL (facultatif).
 */
const crypto = require('crypto');

const cfg = () => ({
  endpoint: (process.env.S3_ENDPOINT || '').replace(/\/$/, ''),
  bucket: process.env.S3_BUCKET,
  region: process.env.S3_REGION || 'auto',
  accessKey: process.env.S3_ACCESS_KEY,
  secretKey: process.env.S3_SECRET_KEY,
  publicUrl: (process.env.S3_PUBLIC_URL || '').replace(/\/$/, '')
});

const s3Ready = () => {
  const c = cfg();
  return !!(c.bucket && c.accessKey && c.secretKey && c.endpoint);
};

const hmac = (key, str) => crypto.createHmac('sha256', key).update(str, 'utf8').digest();
const sha256 = x => crypto.createHash('sha256').update(x).digest('hex');

/**
 * Signe une requête (path-style : {endpoint}/{bucket}/{key}).
 * Piège SigV4 : une ligne VIDE sépare le bloc d'en-têtes canoniques de SignedHeaders.
 */
function s3Sign(method, key, body) {
  const { endpoint, bucket, region, accessKey, secretKey } = cfg();
  const pathKey = '/' + bucket + '/' +
    String(key).split('/').filter(Boolean).map(encodeURIComponent).join('/');

  const payloadHash = sha256(body || Buffer.alloc(0));
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);

  const canonicalHeaders =
    `host:${new URL(endpoint).host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest =
    `${method}\n${pathKey}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign =
    `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256(canonicalRequest)}`;

  const kSigning = hmac(
    hmac(hmac(hmac('AWS4' + secretKey, dateStamp), region), 's3'), 'aws4_request');

  return {
    url: endpoint + pathKey,
    headers: {
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      Authorization:
        `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, ` +
        `SignedHeaders=${signedHeaders}, ` +
        `Signature=${crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex')}`
    }
  };
}

/** URL de lecture publique si le bucket en expose une, sinon l'URL du bucket. */
function s3Url(key) {
  const { publicUrl, endpoint, bucket } = cfg();
  return publicUrl ? `${publicUrl}/${key}` : `${endpoint}/${bucket}/${key}`;
}

/** Écrit un objet. Lève une erreur explicite en cas d'échec (pas d'avalage silencieux). */
async function uploadToS3(buffer, key, contentType) {
  // Le corps DOIT être un Buffer : `s3Sign` calcule le SHA-256 du corps, et une
  // chaîne non vide hacherait un contenu différent de celui réellement envoyé
  // (l'ancien code retombait sur `Buffer.alloc(0)` seulement si le corps était
  // falsy — une chaîne ne l'est pas). Un seul appelant aujourd'hui, et il passe
  // bien `Buffer.from(payload)` ; ce garde verrouille l'invariant pour le suivant.
  if (!Buffer.isBuffer(buffer)) {
    throw new Error('uploadToS3 : le corps doit être un Buffer '
      + `(reçu : ${buffer === null ? 'null' : typeof buffer})`);
  }
  const { url, headers } = s3Sign('PUT', key, buffer);
  const res = await fetch(url, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': contentType || 'application/octet-stream' },
    body: buffer
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`R2 PUT ${res.status} ${detail.slice(0, 200)}`);
  }
  return s3Url(key);
}

module.exports = { s3Ready, s3Sign, s3Url, uploadToS3 };
