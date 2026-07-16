// ============================================================
// auth.js — Google Identity Services auth + role management
// Uses a single combined OAuth flow to avoid double-popup issue
// caused by GitHub Pages COOP headers.
// ============================================================

const Auth = (() => {
  let _user        = null;   // { email, name, picture, role }
  let _accessToken = null;
  let _onAuthChange = null;

  // ── Public ────────────────────────────────────────────────
  function init(onAuthChange) {
    _onAuthChange = onAuthChange;

    // Single token client that handles BOTH identity + Sheets scope.
    // We request the ID token via 'openid email profile' alongside
    // the Sheets scope, so only one popup/redirect ever fires.
    const tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.CLIENT_ID,
      // openid + profile + email gives us identity info
      // spreadsheets scope gives Sheets read/write
      scope: 'openid email profile ' + CONFIG.SCOPES,
      callback: _handleToken,
      error_callback: (err) => {
        console.error('OAuth error:', err);
        UI.toast('Sign-in failed: ' + (err.message || err.type), 'error', 6000);
      },
    });

    // Render a plain sign-in button that triggers the token flow directly
    const btn = document.getElementById('google-signin-btn');
    if (btn) {
      btn.innerHTML = `
        <button class="btn btn-google" id="gsi-custom-btn">
          <svg width="18" height="18" viewBox="0 0 48 48" style="display:block">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            <path fill="none" d="M0 0h48v48H0z"/>
          </svg>
          Sign in with Google
        </button>`;

      document.getElementById('gsi-custom-btn').onclick = () => {
        // prompt:'select_account' forces the account chooser every time
        tokenClient.requestAccessToken({ prompt: 'select_account' });
      };
    }
  }

  function signOut() {
    if (_accessToken) {
      google.accounts.oauth2.revoke(_accessToken, () => {});
    }
    _user        = null;
    _accessToken = null;
    google.accounts.id.disableAutoSelect();
    _onAuthChange && _onAuthChange(null);
  }

  function getUser()         { return _user; }
  function getToken()        { return _accessToken; }
  function isAdmin()         { return _user && _user.role === 'admin'; }
  function isAuthenticated() { return !!_user; }

  // requestToken — used by sheets.js before every API call
  async function requestToken() {
    if (_accessToken) return _accessToken;
    // Token expired — this shouldn't normally be called without a valid token
    // If it is, it means the session expired; prompt re-login
    _onAuthChange && _onAuthChange(null);
    throw new Error('Session expired. Please sign in again.');
  }

  // ── Private ───────────────────────────────────────────────
  async function _handleToken(tokenResponse) {
    if (tokenResponse.error) {
      console.error('Token error:', tokenResponse);
      UI.toast('Sign-in error: ' + tokenResponse.error, 'error', 6000);
      return;
    }

    _accessToken = tokenResponse.access_token;

    // Decode identity from the access token by calling userinfo endpoint
    try {
      const resp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { 'Authorization': 'Bearer ' + _accessToken }
      });
      const info = await resp.json();

      // Domain check
      if (!info.email || !info.email.endsWith('@' + CONFIG.DOMAIN)) {
        UI.toast(`Access denied: ${info.email} is not an @${CONFIG.DOMAIN} account.`, 'error', 8000);
        _accessToken = null;
        return;
      }

      _user = {
        email:   info.email,
        name:    info.name,
        picture: info.picture,
        role:    CONFIG.ADMINS.includes(info.email) ? 'admin' : 'faculty',
      };

      // Auto-revoke before expiry
      const expiresIn = (tokenResponse.expires_in || 3600) * 1000;
      setTimeout(() => { _accessToken = null; }, expiresIn - 60000);

      _onAuthChange && _onAuthChange(_user);

    } catch (err) {
      console.error('Userinfo fetch failed:', err);
      UI.toast('Could not verify your account. Please try again.', 'error', 6000);
      _accessToken = null;
    }
  }

  return { init, requestToken, signOut, getUser, getToken, isAdmin, isAuthenticated };
})();
