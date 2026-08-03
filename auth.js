// ============================================================
// auth.js — Google Identity Services auth + role management
// Uses a single combined OAuth flow to avoid double-popup issue
// caused by GitHub Pages COOP headers.
// Supports persistent sessions via localStorage & silent token renewal.
// ============================================================

const Auth = (() => {
  let _user                 = null;   // { email, name, picture, role }
  let _accessToken          = null;
  let _tokenExpiry          = 0;      // Epoch timestamp (ms) when access token expires
  let _tokenClient          = null;
  let _onAuthChange         = null;
  let _pendingTokenResolver = null;

  const STORAGE_USER  = 'fe_auth_user';
  const STORAGE_TOKEN = 'fe_auth_token_info';

  // ── Public ────────────────────────────────────────────────
  function init(onAuthChange) {
    _onAuthChange = onAuthChange;

    // Single token client that handles BOTH identity + Sheets scope.
    // include_granted_scopes: true tells Google to remember previously
    // granted scopes so it doesn't re-prompt on every login.
    _tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.CLIENT_ID,
      scope: 'openid email profile https://www.googleapis.com/auth/drive.readonly ' + CONFIG.SCOPES,
      include_granted_scopes: true,
      callback: _handleToken,
      error_callback: (err) => {
        console.error('OAuth error:', err);
        if (_pendingTokenResolver) {
          _pendingTokenResolver.reject(err);
          _pendingTokenResolver = null;
        }
        if (err.type === 'access_denied') {
          _clearStorage();
        }
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
        const hasConsented = localStorage.getItem('gsi_consented');
        _tokenClient.requestAccessToken({
          prompt: hasConsented ? '' : 'select_account consent',
        });
      };
    }

    // Try restoring user session from localStorage
    _restoreSession();
  }

  function _clearStorage() {
    try {
      localStorage.removeItem(STORAGE_USER);
      localStorage.removeItem(STORAGE_TOKEN);
      localStorage.removeItem('gsi_consented');
    } catch (e) {}
  }

  function _restoreSession() {
    try {
      const savedUser = localStorage.getItem(STORAGE_USER);
      const savedToken = localStorage.getItem(STORAGE_TOKEN);

      if (savedUser) {
        _user = JSON.parse(savedUser);
      }

      if (savedToken) {
        const info = JSON.parse(savedToken);
        if (info.expiry && info.expiry > Date.now()) {
          _accessToken = info.token;
          _tokenExpiry = info.expiry;
        }
      }

      if (_user) {
        _onAuthChange && _onAuthChange(_user);
      }
    } catch (e) {
      console.warn('Failed to restore auth session:', e);
      _clearStorage();
    }
  }

  function signOut() {
    if (_accessToken) {
      try {
        google.accounts.oauth2.revoke(_accessToken, () => {});
      } catch (e) {}
    }
    _user                 = null;
    _accessToken          = null;
    _tokenExpiry          = 0;
    _pendingTokenResolver = null;
    _clearStorage();
    if (window.google?.accounts?.id?.disableAutoSelect) {
      google.accounts.id.disableAutoSelect();
    }
    _onAuthChange && _onAuthChange(null);
  }

  function getUser()         { return _user; }
  function getToken()        { return _accessToken; }
  function isAdmin()         { return _user && _user.role === 'admin'; }
  function isAuthenticated() { return !!_user; }

  // requestToken — used by sheets.js before API calls
  async function requestToken() {
    // 1. If valid cached token exists, return it
    if (_accessToken && _tokenExpiry > Date.now() + 60000) {
      return _accessToken;
    }

    // 2. If logged in but token expired, silently request a new token
    if (_user && _tokenClient) {
      try {
        const freshToken = await new Promise((resolve, reject) => {
          _pendingTokenResolver = { resolve, reject };
          _tokenClient.requestAccessToken({ prompt: '' });

          setTimeout(() => {
            if (_pendingTokenResolver) {
              _pendingTokenResolver.reject(new Error('Token refresh timeout'));
              _pendingTokenResolver = null;
            }
          }, 10000);
        });
        return freshToken;
      } catch (err) {
        console.warn('Silent token refresh failed:', err);
      }
    }

    // 3. Fallback: session expired
    signOut();
    throw new Error('Session expired. Please sign in again.');
  }

  // ── Private ───────────────────────────────────────────────
  async function _handleToken(tokenResponse) {
    if (tokenResponse.error) {
      console.error('Token error:', tokenResponse);
      if (_pendingTokenResolver) {
        _pendingTokenResolver.reject(new Error(tokenResponse.error));
        _pendingTokenResolver = null;
      } else {
        UI.toast('Sign-in error: ' + tokenResponse.error, 'error', 6000);
      }
      return;
    }

    _accessToken = tokenResponse.access_token;
    const expiresIn = (tokenResponse.expires_in || 3600) * 1000;
    _tokenExpiry = Date.now() + expiresIn;

    try {
      localStorage.setItem(STORAGE_TOKEN, JSON.stringify({
        token: _accessToken,
        expiry: _tokenExpiry
      }));
    } catch (e) {}

    // If resolving a silent background refresh, notify pending promise
    if (_pendingTokenResolver) {
      const resolver = _pendingTokenResolver;
      _pendingTokenResolver = null;
      resolver.resolve(_accessToken);
      return;
    }

    // Decode identity by calling userinfo endpoint (first sign-in)
    try {
      const resp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { 'Authorization': 'Bearer ' + _accessToken }
      });
      const info = await resp.json();

      // Domain check
      if (!info.email || !info.email.endsWith('@' + CONFIG.DOMAIN)) {
        UI.toast(`Access denied: ${info.email} is not an @${CONFIG.DOMAIN} account.`, 'error', 8000);
        signOut();
        return;
      }

      _user = {
        email:   info.email,
        name:    info.name,
        picture: info.picture,
        role:    CONFIG.ADMINS.includes(info.email) ? 'admin' : 'faculty',
      };

      try {
        localStorage.setItem(STORAGE_USER, JSON.stringify(_user));
      } catch (e) {}

      localStorage.setItem('gsi_consented', '1');

      _onAuthChange && _onAuthChange(_user);

    } catch (err) {
      console.error('Userinfo fetch failed:', err);
      UI.toast('Could not verify your account. Please try again.', 'error', 6000);
      signOut();
    }
  }

  return { init, requestToken, signOut, getUser, getToken, isAdmin, isAuthenticated };
})();
