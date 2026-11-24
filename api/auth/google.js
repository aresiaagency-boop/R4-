// GET /api/auth/google → redirige al selector de cuentas de Google (OpenID Connect, solo email y perfil)
import { env, googleEnabled, newState, newVerifier, challengeDe, stateCookie, baseUrl, redirect, send } from '../../lib/auth.js';

export default function handler(req, res) {
  if (!googleEnabled()) return send(res, 503, { error: 'login con Google no configurado (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)' });
  const state = newState(), verifier = newVerifier();
  const q = new URLSearchParams({
    client_id: env().googleId,
    redirect_uri: baseUrl(req) + '/api/auth/callback',
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
    access_type: 'online',
    code_challenge: challengeDe(verifier),
    code_challenge_method: 'S256'
  });
  return redirect(res, 'https://accounts.google.com/o/oauth2/v2/auth?' + q.toString(), [stateCookie(state + '.' + verifier)]);
}
