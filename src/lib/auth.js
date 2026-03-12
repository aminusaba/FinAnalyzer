const USERS_KEY = "finanalyzer_users";
const SESSION_KEY = "finanalyzer_session";

function hashPassword(password) {
  // Simple hash for local-only auth (no network, no server)
  let h = 5381;
  for (let i = 0; i < password.length; i++) {
    h = ((h << 5) + h) ^ password.charCodeAt(i);
    h = h >>> 0;
  }
  let h2 = 0x811c9dc5;
  for (let i = 0; i < password.length; i++) {
    h2 ^= password.charCodeAt(i);
    h2 = Math.imul(h2, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

function getUsers() {
  try { return JSON.parse(localStorage.getItem(USERS_KEY)) || {}; } catch { return {}; }
}

function saveUsers(users) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

export function getSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; }
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

export function register(username, password) {
  if (!username.trim() || !password) throw new Error("Username and password required");
  const users = getUsers();
  const key = username.trim().toLowerCase();
  if (users[key]) throw new Error("Username already taken");
  const hash = hashPassword(password);
  users[key] = { username: username.trim(), hash, createdAt: Date.now() };
  saveUsers(users);
  const session = { username: username.trim(), key };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

export function login(username, password) {
  if (!username.trim() || !password) throw new Error("Username and password required");
  const users = getUsers();
  const key = username.trim().toLowerCase();
  const user = users[key];
  if (!user) throw new Error("User not found");
  const hash = hashPassword(password);
  if (hash !== user.hash) throw new Error("Incorrect password");
  const session = { username: user.username, key };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

export function getUserSettingsKey(userKey) {
  return `finanalyzer_notif_${userKey}`;
}
