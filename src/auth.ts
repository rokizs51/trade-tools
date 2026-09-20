type BrowserAuthConfig =
  | { required: false }
  | { required: true; supabaseUrl: string; publishableKey: string };

type AuthUser = { id: string; email: string | null; role: "authenticated" };

type AuthSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  user: { id: string; email: string | null };
};

declare global {
  interface Window {
    __TRADE_TOOLS_AUTH_CONFIG__?: BrowserAuthConfig;
  }
}

const storageKey = "trade-tools.auth.session.v1";
const config = window.__TRADE_TOOLS_AUTH_CONFIG__;
let currentSession: AuthSession | undefined;
let refreshRequest: Promise<AuthSession> | undefined;

export async function initializeAuthentication(startApplication: () => void): Promise<void> {
  const loginShell = mustGetElement("auth-shell");
  const applicationShell = mustGetElement("application-shell");
  const loginForm = mustGetElement("auth-login-form") as HTMLFormElement;
  const emailInput = mustGetElement("auth-email") as HTMLInputElement;
  const passwordInput = mustGetElement("auth-password") as HTMLInputElement;
  const submitButton = mustGetElement("auth-submit") as HTMLButtonElement;
  const errorElement = mustGetElement("auth-error");
  const userElement = mustGetElement("auth-user");
  const signOutButton = mustGetElement("auth-sign-out") as HTMLButtonElement;
  let applicationStarted = false;

  const showApplication = (user: AuthUser): void => {
    loginShell.hidden = true;
    applicationShell.hidden = false;
    userElement.textContent = user.email ?? "Signed in";
    signOutButton.hidden = !config?.required;
    if (!applicationStarted) {
      applicationStarted = true;
      startApplication();
    }
  };

  const showLogin = (message = ""): void => {
    applicationShell.hidden = true;
    loginShell.hidden = false;
    errorElement.textContent = message;
    passwordInput.value = "";
    emailInput.focus();
  };

  window.addEventListener("trade-tools-auth-expired", () => {
    showLogin("Your session expired. Sign in again.");
  });

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!config?.required) return;
    setLoginBusy(submitButton, true);
    errorElement.textContent = "";
    try {
      currentSession = await requestSession("password", {
        email: emailInput.value.trim(),
        password: passwordInput.value,
      });
      saveSession(currentSession);
      const user = await validateApplicationSession(currentSession.accessToken);
      showApplication(user);
    } catch (error) {
      clearSession();
      showLogin(error instanceof Error ? error.message : "Sign-in failed.");
    } finally {
      setLoginBusy(submitButton, false);
    }
  });

  signOutButton.addEventListener("click", async () => {
    signOutButton.disabled = true;
    try {
      if (config?.required && currentSession) {
        await fetch(`${config.supabaseUrl}/auth/v1/logout`, {
          method: "POST",
          headers: {
            apikey: config.publishableKey,
            authorization: `Bearer ${currentSession.accessToken}`,
          },
        });
      }
    } finally {
      clearSession();
      window.location.reload();
    }
  });

  if (!config) {
    showLogin("Authentication configuration did not load. Start the application through its Node server.");
    return;
  }

  if (!config.required) {
    showApplication({ id: "local-development", email: "Local development", role: "authenticated" });
    return;
  }

  currentSession = readStoredSession();
  if (!currentSession) {
    showLogin();
    return;
  }

  try {
    const accessToken = await getValidAccessToken();
    showApplication(await validateApplicationSession(accessToken));
  } catch {
    clearSession();
    showLogin("Your saved session is no longer valid. Sign in again.");
  }
}

export async function authenticatedFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  if (!config?.required) return fetch(input, init);

  let accessToken = await getValidAccessToken();
  let response = await fetchWithToken(input, init, accessToken);
  if (response.status === 401 && currentSession?.refreshToken) {
    try {
      accessToken = (await refreshSession()).accessToken;
      response = await fetchWithToken(input, init, accessToken);
    } catch {
      expireSession();
    }
  }
  if (response.status === 401) expireSession();
  return response;
}

async function getValidAccessToken(): Promise<string> {
  if (!currentSession) {
    expireSession();
    throw new Error("Sign in is required.");
  }
  if (currentSession.expiresAt <= Math.floor(Date.now() / 1000) + 60) {
    return (await refreshSession()).accessToken;
  }
  return currentSession.accessToken;
}

async function refreshSession(): Promise<AuthSession> {
  if (!currentSession || !config?.required) throw new Error("Sign in is required.");
  if (!refreshRequest) {
    refreshRequest = requestSession("refresh_token", { refresh_token: currentSession.refreshToken })
      .then((session) => {
        currentSession = session;
        saveSession(session);
        return session;
      })
      .finally(() => {
        refreshRequest = undefined;
      });
  }
  return refreshRequest;
}

async function requestSession(grantType: "password" | "refresh_token", body: Record<string, string>): Promise<AuthSession> {
  if (!config?.required) throw new Error("Supabase authentication is not configured.");
  const response = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=${grantType}`, {
    method: "POST",
    headers: { apikey: config.publishableKey, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json() as unknown;
  if (!response.ok) throw new Error(readAuthError(payload));
  return parseSession(payload);
}

async function validateApplicationSession(accessToken: string): Promise<AuthUser> {
  const response = await fetchWithToken("/api/session", {}, accessToken);
  const payload = await response.json() as unknown;
  if (!response.ok) throw new Error(readAuthError(payload));
  if (!isRecord(payload) || !isRecord(payload.user) || typeof payload.user.id !== "string") {
    throw new Error("The server returned an invalid authenticated session.");
  }
  return {
    id: payload.user.id,
    email: typeof payload.user.email === "string" ? payload.user.email : null,
    role: "authenticated",
  };
}

function fetchWithToken(input: RequestInfo | URL, init: RequestInit, token: string): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

function parseSession(value: unknown): AuthSession {
  if (!isRecord(value) || typeof value.access_token !== "string" || typeof value.refresh_token !== "string" ||
      !isRecord(value.user) || typeof value.user.id !== "string") {
    throw new Error("Supabase returned an invalid session.");
  }
  const expiresAt = typeof value.expires_at === "number"
    ? value.expires_at
    : Math.floor(Date.now() / 1000) + (typeof value.expires_in === "number" ? value.expires_in : 3600);
  return {
    accessToken: value.access_token,
    refreshToken: value.refresh_token,
    expiresAt,
    user: { id: value.user.id, email: typeof value.user.email === "string" ? value.user.email : null },
  };
}

function readStoredSession(): AuthSession | undefined {
  try {
    const value = localStorage.getItem(storageKey);
    return value ? parseSession(JSON.parse(value)) : undefined;
  } catch {
    localStorage.removeItem(storageKey);
    return undefined;
  }
}

function saveSession(session: AuthSession): void {
  localStorage.setItem(storageKey, JSON.stringify({
    access_token: session.accessToken,
    refresh_token: session.refreshToken,
    expires_at: session.expiresAt,
    user: session.user,
  }));
}

function clearSession(): void {
  currentSession = undefined;
  refreshRequest = undefined;
  localStorage.removeItem(storageKey);
}

function expireSession(): void {
  clearSession();
  window.dispatchEvent(new Event("trade-tools-auth-expired"));
}

function setLoginBusy(button: HTMLButtonElement, busy: boolean): void {
  button.disabled = busy;
  button.textContent = busy ? "Signing in…" : "Sign in";
}

function readAuthError(value: unknown): string {
  if (!isRecord(value)) return "Authentication failed.";
  if (typeof value.message === "string") return value.message;
  if (typeof value.error_description === "string") return value.error_description;
  if (typeof value.error === "string") return value.error;
  if (isRecord(value.error) && typeof value.error.message === "string") return value.error.message;
  return "Authentication failed.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function mustGetElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element;
}
