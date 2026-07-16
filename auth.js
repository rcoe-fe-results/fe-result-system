// ============================================================
// auth.js — Google Identity Services auth + role management
// ============================================================

const Auth = (() => {
  let _user = null;         // { email, name, picture, role }
  let _tokenClient = null;
  let _accessToken = null;
  let _onAuthChange = null; // callback(user|null)

  // ── Public ────────────────────────────────────────────────
  function init(onAuthChange) {
    _onAuthChange = onAuthChange;

    // Initialise GIS token client (for Sheets API)
    _tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.CLIENT_ID,
      scope:     CONFIG.SCOPES,
      callback:  _handleToken,
      ux_mode:   'redirect',
      redirect_uri: window.location.origin + window.location.pathname,
    });

    // Initialise ID client (for login button / sign-in popup)
    google.accounts.id.initialize({
      client_id:  CONFIG.CLIENT_ID,
      callback:   _handleCredential,
      auto_select: false,
      hd:          CONFIG.DOMAIN,
    });

    // Render the Google Sign-In button
    google.accounts.id.renderButton(
      document.getElementById('google-signin-btn'),
      { theme:'outline', size:'large', shape:'pill', text:'signin_with' }
    );

    // Prompt one-tap
    google.accounts.id.prompt();
  }

  function requestToken() {
    if (_accessToken) return Promise.resolve(_accessToken);
    return new Promise((resolve) => {
      _tokenClient.callback = (resp) => {
        _handleToken(resp);
        resolve(_accessToken);
      };
      _tokenClient.requestAccessToken({ prompt:'' });
    });
  }

  function signOut() {
    google.accounts.id.disableAutoSelect();
    if (_accessToken) {
      google.accounts.oauth2.revoke(_accessToken, () => {});
    }
    _user = null;
    _accessToken = null;
    _onAuthChange && _onAuthChange(null);
  }

  function getUser()        { return _user; }
  function getToken()       { return _accessToken; }
  function isAdmin()        { return _user && _user.role === 'admin'; }
  function isAuthenticated(){ return !!_user; }

  // ── Private ───────────────────────────────────────────────
  function _handleCredential(response) {
    // Decode JWT id_token to get email + name
    const payload = _parseJwt(response.credential);
    if (!payload) return;

    // Domain check
    if (!payload.email.endsWith('@' + CONFIG.DOMAIN)) {
      _showDomainError(payload.email);
      return;
    }

    _user = {
      email:   payload.email,
      name:    payload.name,
      picture: payload.picture,
      role:    CONFIG.ADMINS.includes(payload.email) ? 'admin' : 'faculty',
    };

    // Now request Sheets access token
    _tokenClient.requestAccessToken({ prompt:'' });
  }

  function _handleToken(tokenResponse) {
    if (tokenResponse.error) {
      console.error('Token error:', tokenResponse.error);
      return;
    }
    _accessToken = tokenResponse.access_token;

    // Auto-revoke before expiry
    const expiresIn = (tokenResponse.expires_in || 3600) * 1000;
    setTimeout(() => { _accessToken = null; }, expiresIn - 60000);

    _onAuthChange && _onAuthChange(_user);
  }

  function _parseJwt(token) {
    try {
      const base64 = token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
      return JSON.parse(atob(base64));
    } catch { return null; }
  }

  function _showDomainError(email) {
    UI.toast(`Access denied: ${email} is not an @${CONFIG.DOMAIN} account.`, 'error', 6000);
  }

  return { init, requestToken, signOut, getUser, getToken, isAdmin, isAuthenticated };
})();
