// Regenerate the Apple OAuth client secret JWT for Supabase.
// Apple caps this JWT at 6 months — set a reminder to re-run before then.
// Usage: node scripts/generate-apple-jwt.js
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const TEAM_ID   = 'TNRL5XN485';
const KEY_ID    = 'T8AAFWNN6R';
const CLIENT_ID = 'com.mishwaro.app.signin';
const KEY_PATH  = path.join(__dirname, '..', 'secrets', 'AuthKey_T8AAFWNN6R.p8');

const privateKey = fs.readFileSync(KEY_PATH);
const now = Math.floor(Date.now() / 1000);
const SIX_MONTHS = 60 * 60 * 24 * 180;

const token = jwt.sign(
  {
    iss: TEAM_ID,
    iat: now,
    exp: now + SIX_MONTHS,
    aud: 'https://appleid.apple.com',
    sub: CLIENT_ID,
  },
  privateKey,
  { algorithm: 'ES256', header: { alg: 'ES256', kid: KEY_ID } }
);

console.log(token);
console.log('\nExpires:', new Date((now + SIX_MONTHS) * 1000).toISOString());
