/*
 * Habitat — Home Assistant connectivity.
 *
 * Three ways in, tried in order:
 *  1. Embedded in Home Assistant (Webpage dashboard / iframe on the same origin): reuse the
 *     parent frontend's live connection, so the Android companion app needs no extra login.
 *  2. Same origin as Home Assistant (served from /local/): reuse the frontend's stored login,
 *     or sign in through Home Assistant's own OAuth page.
 *  3. Anywhere else: a Home Assistant URL plus a long-lived access token.
 */
(function (HB) {
  'use strict';

  const AUTH_KEY = 'habitat.auth';
  const FRONTEND_TOKENS_KEY = 'hassTokens';
  const OAUTH_STATE_KEY = 'habitat.oauthState';
  const CALLBACK_PARAM = 'auth_callback';
  const REFRESH_MARGIN_MS = 60 * 1000;
  const PING_INTERVAL_MS = 30 * 1000;
  const PING_TIMEOUT_MS = 10 * 1000;
  const MIN_BACKOFF_MS = 1000;
  const MAX_BACKOFF_MS = 30 * 1000;

  /** Raised when Home Assistant rejects the credentials; the user has to sign in again. */
  class AuthError extends Error {
    constructor(message) {
      super(message);
      this.name = 'AuthError';
    }
  }
  HB.AuthError = AuthError;

  /** Normalises user input like "homeassistant.local:8123/" to "http://homeassistant.local:8123". */
  HB.normalizeUrl = (url) => {
    let clean = String(url || '').trim().replace(/\/+$/, '');
    if (clean && !/^https?:\/\//i.test(clean)) clean = `http://${clean}`;
    return clean;
  };

  HB.clearAuth = () => HB.storage.remove(AUTH_KEY);

  function saveAuth(auth) {
    HB.storage.set(AUTH_KEY, auth);
  }

  function frontendTokens(hassUrl) {
    const tokens = HB.storage.get(FRONTEND_TOKENS_KEY, null);
    if (!tokens || !tokens.refresh_token || HB.normalizeUrl(tokens.hassUrl) !== hassUrl) return null;
    return {
      kind: 'oauth',
      source: 'frontend',
      hassUrl,
      clientId: tokens.clientId,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires: tokens.expires,
    };
  }

  async function tokenRequest(hassUrl, params) {
    let response;
    try {
      response = await fetch(`${hassUrl}/auth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params),
      });
    } catch (_) {
      throw new Error(
        'Could not reach Home Assistant to finish signing in. If Habitat runs on a different address than ' +
          'Home Assistant, add it to cors_allowed_origins or use a long-lived access token.',
      );
    }
    if (response.status === 400 || response.status === 403) throw new AuthError('Home Assistant rejected the login. Sign in again.');
    if (!response.ok) throw new Error(`Home Assistant answered the login request with HTTP ${response.status}.`);
    return response.json();
  }

  function withTokens(auth, data) {
    const next = { ...auth, access_token: data.access_token, expires: Date.now() + data.expires_in * 1000 };
    if (data.refresh_token) next.refresh_token = data.refresh_token;
    return next;
  }

  /** Returns an async access-token getter that refreshes OAuth tokens shortly before they expire. */
  function tokenProvider(initial) {
    let auth = initial;
    let refreshing = null;
    return async function getAccessToken() {
      if (auth.kind === 'llat') return auth.access_token;
      if (auth.access_token && auth.expires - REFRESH_MARGIN_MS > Date.now()) return auth.access_token;
      if (!refreshing) {
        refreshing = tokenRequest(auth.hassUrl, {
          grant_type: 'refresh_token',
          refresh_token: auth.refresh_token,
          client_id: auth.clientId,
        })
          .then((data) => {
            auth = withTokens(auth, data);
            saveAuth(auth);
            return auth.access_token;
          })
          .finally(() => {
            refreshing = null;
          });
      }
      return refreshing;
    };
  }

  function clientId() {
    return `${location.origin}/`;
  }

  function redirectUri() {
    return `${location.origin}${location.pathname}?${CALLBACK_PARAM}=1`;
  }

  function randomNonce() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  /** Sends the browser to Home Assistant's login page; it returns here with an authorization code. */
  HB.startLogin = (hassUrl) => {
    const nonce = randomNonce();
    try {
      sessionStorage.setItem(OAUTH_STATE_KEY, nonce);
    } catch (_) {
      /* without sessionStorage the nonce check below fails closed */
    }
    const state = btoa(JSON.stringify({ hassUrl, clientId: clientId(), nonce }));
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: clientId(),
      redirect_uri: redirectUri(),
      state,
    });
    location.assign(`${hassUrl}/auth/authorize?${query}`);
  };

  async function finishLogin() {
    const params = new URLSearchParams(location.search);
    if (!params.has(CALLBACK_PARAM)) return null;
    history.replaceState(null, '', location.pathname);
    let state = null;
    let expectedNonce = null;
    try {
      state = JSON.parse(atob(params.get('state') || ''));
      expectedNonce = sessionStorage.getItem(OAUTH_STATE_KEY);
      sessionStorage.removeItem(OAUTH_STATE_KEY);
    } catch (_) {
      state = null;
    }
    const code = params.get('code');
    if (!code || !state || !state.hassUrl || !expectedNonce || state.nonce !== expectedNonce) {
      throw new Error('The sign-in response did not match this browser tab. Sign in again.');
    }
    const data = await tokenRequest(state.hassUrl, {
      grant_type: 'authorization_code',
      code,
      client_id: state.clientId,
    });
    const auth = withTokens({ kind: 'oauth', source: 'habitat', hassUrl: state.hassUrl, clientId: state.clientId }, data);
    saveAuth(auth);
    return auth;
  }

  async function revoke(auth) {
    if (auth.kind !== 'oauth' || auth.source !== 'habitat' || !auth.refresh_token) return;
    try {
      await fetch(`${auth.hassUrl}/auth/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: auth.refresh_token }),
      });
    } catch (_) {
      /* best effort: the local copy is removed either way */
    }
  }

  /** Small event emitter shared by the backends. */
  function emitter() {
    const listeners = new Map();
    return {
      on(event, callback) {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event).add(callback);
      },
      emit(event, payload) {
        (listeners.get(event) || []).forEach((callback) => callback(payload));
      },
    };
  }

  /**
   * Minimal Home Assistant WebSocket client: authentication, request/response, subscriptions,
   * keep-alive pings and automatic reconnection with resubscription.
   */
  class Connection {
    constructor(hassUrl, getAccessToken) {
      this.hassUrl = hassUrl;
      this.wsUrl = `${hassUrl.replace(/^http/i, 'ws')}/api/websocket`;
      this.getAccessToken = getAccessToken;
      this.events = emitter();
      this.nextId = 1;
      this.pending = new Map();
      this.subscriptions = new Set();
      this.subscriptionsById = new Map();
      this.socket = null;
      this.dropSocket = null;
      this.reconnectTimer = null;
      this.pingTimer = null;
      this.backoff = MIN_BACKOFF_MS;
      this.closedByUser = false;
      this.haVersion = null;
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') this.reconnectNow();
      });
      window.addEventListener('online', () => this.reconnectNow());
    }

    setStatus(status) {
      this.status = status;
      this.events.emit('status', status);
    }

    /** Opens the socket and resolves once Home Assistant accepted the access token. */
    open() {
      return new Promise((resolve, reject) => {
        this.setStatus(this.status === 'reconnecting' ? 'reconnecting' : 'connecting');
        let socket;
        try {
          socket = new WebSocket(this.wsUrl);
        } catch (err) {
          reject(err);
          return;
        }
        this.socket = socket;
        let authenticated = false;
        let closed = false;

        const handleClose = () => {
          if (closed) return;
          closed = true;
          socket.onclose = null;
          socket.onmessage = null;
          this.stopPing();
          this.pending.forEach((request) => request.reject(new Error('Connection lost')));
          this.pending.clear();
          if (this.socket === socket) this.socket = null;
          if (!authenticated) {
            reject(new Error(`Could not connect to Home Assistant at ${this.hassUrl}.`));
            return;
          }
          if (this.closedByUser) {
            this.setStatus('closed');
            return;
          }
          this.scheduleReconnect();
        };
        this.dropSocket = () => {
          try {
            socket.close();
          } catch (_) {
            /* already closed */
          }
          handleClose();
        };

        socket.onclose = handleClose;
        socket.onerror = () => {
          /* onclose follows and carries the handling */
        };
        socket.onmessage = (event) => {
          let data;
          try {
            data = JSON.parse(event.data);
          } catch (_) {
            return;
          }
          for (const message of Array.isArray(data) ? data : [data]) {
            if (authenticated) {
              this.dispatch(message);
            } else if (message.type === 'auth_required') {
              this.getAccessToken().then(
                (token) => socket.send(JSON.stringify({ type: 'auth', access_token: token })),
                (err) => {
                  reject(err);
                  this.closedByUser = err instanceof AuthError;
                  socket.close();
                },
              );
            } else if (message.type === 'auth_ok') {
              authenticated = true;
              this.haVersion = message.ha_version;
              this.backoff = MIN_BACKOFF_MS;
              this.setStatus('connected');
              this.startPing();
              resolve();
            } else if (message.type === 'auth_invalid') {
              this.closedByUser = true;
              reject(new AuthError(message.message || 'Home Assistant rejected the access token.'));
              socket.close();
            }
          }
        };
      });
    }

    dispatch(message) {
      if (message.type === 'result' || message.type === 'pong') {
        const request = this.pending.get(message.id);
        if (!request) return;
        this.pending.delete(message.id);
        if (message.type === 'pong' || message.success) {
          request.resolve(message.result);
        } else {
          const error = new Error(message.error?.message || 'Home Assistant rejected the request.');
          error.code = message.error?.code;
          request.reject(error);
        }
      } else if (message.type === 'event') {
        const subscription = this.subscriptionsById.get(message.id);
        if (subscription) subscription.callback(message.event);
      }
    }

    sendWithId(id, message) {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
        return Promise.reject(new Error('Not connected to Home Assistant.'));
      }
      return new Promise((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        this.socket.send(JSON.stringify({ ...message, id }));
      });
    }

    /** Sends a command and resolves with its result. */
    send(message) {
      return this.sendWithId(this.nextId++, message);
    }

    async activate(subscription) {
      const id = this.nextId++;
      subscription.id = id;
      this.subscriptionsById.set(id, subscription);
      try {
        await this.sendWithId(id, subscription.message);
      } catch (err) {
        this.subscriptionsById.delete(id);
        throw err;
      }
    }

    /** Starts a subscription; events go to `callback`. Resolves with an unsubscribe function. */
    async subscribe(message, callback) {
      const subscription = { message, callback, id: null };
      await this.activate(subscription);
      this.subscriptions.add(subscription);
      return async () => {
        this.subscriptions.delete(subscription);
        this.subscriptionsById.delete(subscription.id);
        try {
          await this.send({ type: 'unsubscribe_events', subscription: subscription.id });
        } catch (_) {
          /* connection already gone */
        }
      };
    }

    scheduleReconnect() {
      if (this.reconnectTimer || this.closedByUser) return;
      this.setStatus('reconnecting');
      this.events.emit('disconnected');
      const delay = this.backoff;
      this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.reconnect();
      }, delay);
    }

    async reconnect() {
      try {
        await this.open();
        this.subscriptionsById.clear();
        for (const subscription of this.subscriptions) await this.activate(subscription);
        this.events.emit('ready');
      } catch (err) {
        if (err instanceof AuthError) {
          this.setStatus('closed');
          this.events.emit('auth-error', err);
          return;
        }
        this.scheduleReconnect();
      }
    }

    /** Skips the back-off wait, e.g. when the tab becomes visible or the network returns. */
    reconnectNow() {
      if (!this.reconnectTimer) return;
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
      this.backoff = MIN_BACKOFF_MS;
      this.reconnect();
    }

    startPing() {
      this.stopPing();
      this.pingTimer = setInterval(() => this.ping(), PING_INTERVAL_MS);
    }

    stopPing() {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }

    async ping() {
      const drop = this.dropSocket;
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Ping timed out')), PING_TIMEOUT_MS);
      });
      try {
        await Promise.race([this.send({ type: 'ping' }), timeout]);
      } catch (_) {
        // A half-open socket can take minutes to report closing; drop it now and reconnect.
        if (drop && drop === this.dropSocket) drop();
      } finally {
        clearTimeout(timer);
      }
    }

    close() {
      this.closedByUser = true;
      clearTimeout(this.reconnectTimer);
      if (this.dropSocket) this.dropSocket();
    }
  }

  function directBackend(auth) {
    const connection = new Connection(auth.hassUrl, tokenProvider(auth));
    return {
      kind: 'ha',
      hassUrl: auth.hassUrl,
      start: () => connection.open(),
      send: (message) => connection.send(message),
      subscribe: (message, callback) => connection.subscribe(message, callback),
      on: (event, callback) => connection.events.on(event, callback),
      describe: () => ({
        mode: auth.kind === 'llat' ? 'Long-lived access token' : auth.source === 'frontend' ? 'Home Assistant login' : 'Signed in',
        url: auth.hassUrl,
        version: connection.haVersion,
      }),
      async signOut() {
        connection.close();
        await revoke(auth);
        HB.clearAuth();
      },
    };
  }

  function parentFrontend() {
    try {
      if (window.parent === window) return null;
      const element = window.parent.document.querySelector('home-assistant');
      return element && element.hass && element.hass.connection ? element : null;
    } catch (_) {
      return null; // cross-origin parent
    }
  }

  function parentBackend(element) {
    const events = emitter();
    const connection = () => element.hass.connection;
    connection().addEventListener('ready', () => {
      events.emit('status', 'connected');
      events.emit('ready');
    });
    connection().addEventListener('disconnected', () => {
      events.emit('status', 'reconnecting');
      events.emit('disconnected');
    });
    return {
      kind: 'ha',
      embedded: true,
      hassUrl: location.origin,
      start: async () => events.emit('status', 'connected'),
      send: (message) => connection().sendMessagePromise(message),
      subscribe: (message, callback) => connection().subscribeMessage(callback, message),
      on: events.on,
      describe: () => ({
        mode: 'Embedded in Home Assistant',
        url: location.origin,
        version: connection().haVersion || element.hass.config?.version,
      }),
      signOut: null,
    };
  }

  /** Creates a backend from a URL and long-lived token entered on the connect screen. */
  HB.tokenBackend = (hassUrl, token) => {
    const auth = { kind: 'llat', hassUrl, access_token: token.trim() };
    const backend = directBackend(auth);
    const start = backend.start;
    backend.start = async () => {
      await start();
      saveAuth(auth);
    };
    return backend;
  };

  /**
   * Picks the best available backend, or resolves null when the user has to connect first.
   * Throws when an OAuth callback could not be completed.
   */
  HB.resolveBackend = async () => {
    const params = new URLSearchParams(location.search);
    if (params.has('demo') || HB.forceDemo) return HB.createDemoBackend();
    const parent = parentFrontend();
    if (parent) return parentBackend(parent);
    const fromLogin = await finishLogin();
    if (fromLogin) return directBackend(fromLogin);
    const stored = HB.storage.get(AUTH_KEY, null);
    if (stored && stored.hassUrl && stored.access_token) return directBackend(stored);
    const sameOrigin = /^https?:$/.test(location.protocol) ? location.origin : '';
    const fromFrontend = sameOrigin && frontendTokens(sameOrigin);
    return fromFrontend ? directBackend(fromFrontend) : null;
  };

  /** Default address offered on the connect screen. */
  HB.defaultHassUrl = () => {
    const stored = HB.storage.get(AUTH_KEY, null);
    if (stored && stored.hassUrl) return stored.hassUrl;
    return /^https?:$/.test(location.protocol) ? location.origin : '';
  };
})(window.HB = window.HB || {});
