const USERS_KEY = "finanalyzer_users";
const SESSION_KEY = "finanalyzer_session";

async function hashPassword(password) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
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

export async function register(username, password) {
  if (!username.trim() || !password) throw new Error("Username and password required");
  const users = getUsers();
  const key = username.trim().toLowerCase();
  if (users[key]) throw new Error("Username already taken");
  const hash = await hashPassword(password);
  users[key] = { username: username.trim(), hash, createdAt: Date.now() };
  saveUsers(users);
  const session = { username: username.trim(), key };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

export async function login(username, password) {
  if (!username.trim() || !password) throw new Error("Username and password required");
  const users = getUsers();
  const key = username.trim().toLowerCase();
  const user = users[key];
  if (!user) throw new Error("User not found");
  const hash = await hashPassword(password);
  if (hash !== user.hash) throw new Error("Incorrect password");
  const session = { username: user.username, key };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

export function getUserSettingsKey(userKey) {
  return `finanalyzer_notif_${userKey}`;
}
