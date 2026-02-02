// Simple Cognito authentication helper for Vite-based apps
// Reads config from Vite env variables (VITE_*) and remains inert until configured

export class CognitoAuth {
  constructor() {
    this.region = import.meta.env.VITE_COGNITO_REGION || '';
    this.userPoolId = import.meta.env.VITE_COGNITO_USER_POOL_ID || '';
    this.appClientId = import.meta.env.VITE_COGNITO_APP_CLIENT_ID || '';
    this.cognitoDomain = import.meta.env.VITE_COGNITO_DOMAIN || '';
    this.redirectUri = import.meta.env.VITE_COGNITO_REDIRECT_URI || window.location.origin;
  }

  isConfigured() {
    return !!(this.region && this.userPoolId && this.appClientId && this.cognitoDomain);
  }

  getAuthUrl() {
    if (!this.isConfigured()) {
      throw new Error('Cognito is not properly configured');
    }

    const params = new URLSearchParams({
      client_id: this.appClientId,
      response_type: 'code',
      scope: 'email openid profile',
      redirect_uri: this.redirectUri,
    });

    return `https://${this.cognitoDomain}/login?${params.toString()}`;
  }

  async exchangeCodeForTokens(code) {
    if (!this.isConfigured()) {
      throw new Error('Cognito is not properly configured');
    }

    const tokenResponse = await fetch(`https://${this.cognitoDomain}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: this.appClientId,
        code: code,
        redirect_uri: this.redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      throw new Error(`Token exchange failed: ${tokenResponse.status} ${errorText}`);
    }

    const tokens = await tokenResponse.json();

    const userInfoResponse = await fetch(`https://${this.cognitoDomain}/oauth2/userInfo`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!userInfoResponse.ok) {
      const errorText = await userInfoResponse.text();
      throw new Error(`User info fetch failed: ${userInfoResponse.status} ${errorText}`);
    }

    const userInfo = await userInfoResponse.json();

    let idTokenClaims = {};
    if (tokens.id_token) {
      try {
        idTokenClaims = this.parseJWTPayload(tokens.id_token);
      } catch {
        idTokenClaims = {};
      }
    }

    return {
      email: userInfo.email || idTokenClaims.email,
      full_name:
        userInfo.name ||
        idTokenClaims.name ||
        (userInfo.given_name && userInfo.family_name
          ? `${userInfo.given_name} ${userInfo.family_name}`
          : userInfo.email?.split('@')[0]),
      provider: 'cognito',
      provider_user_id: userInfo.sub || idTokenClaims.sub,
      is_email_verified:
        userInfo.email_verified === 'true' || idTokenClaims.email_verified === true,
      raw_user_info: userInfo,
      raw_id_claims: idTokenClaims,
    };
  }

  parseJWTPayload(token) {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  }

  getLogoutUrl() {
    return `https://${this.cognitoDomain}/logout?client_id=${this.appClientId}&redirect_uri=${encodeURIComponent(
      this.redirectUri
    )}`;
  }
}

export const cognitoAuth = new CognitoAuth();


