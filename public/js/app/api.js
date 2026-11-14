// Calls to Dispatch's server API. Each resolves to the parsed JSON body, or
// throws an Error carrying the server's own message.

async function request(method, url, data) {
  const options = { method, headers: {} };
  if (data !== undefined) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(data);
  }
  const res = await fetch(url, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `${method} ${url} failed (${res.status})`);
  return body;
}

const project = (name) => encodeURIComponent(name);

export const getMyProjects = () => request("GET", "/api/me/projects");
export const getMyTasks = () => request("GET", "/api/me/tasks");
export const getMyPushes = () => request("GET", "/api/me/pushes");
// all: everyone you work with, not just the first few (the People page's).
export const getPeople = (q = "", role = "", all = false) => {
  const params = new URLSearchParams(Object.entries({ q, role, all: all ? "1" : "" }).filter(([, value]) => value));
  return request("GET", `/api/me/people${params.size ? `?${params}` : ""}`);
};
export const addToProject = (name, userId) => request("POST", `/api/projects/${project(name)}/staff`, { userId });
export const getPortStatus = (ports) => request("GET", `/api/port-status?ports=${ports.join(",")}`);
export const startProject = (name) => request("POST", `/api/projects/${project(name)}/start`);
export const stopProject = (name) => request("POST", `/api/projects/${project(name)}/stop`);
export const openInVSCode = (name) => request("POST", `/api/projects/${project(name)}/open-vscode`);
export const patchTask = (name, id, changes) =>
  request("PATCH", `/api/project-folders/${project(name)}/tasks/${encodeURIComponent(id)}`, changes);

// Admins only (routes/api.js).
const account = (id) => `/api/admin/users/${encodeURIComponent(id)}`;
export const getAccounts = () => request("GET", "/api/admin/users");
export const createAccount = (fields) => request("POST", "/api/admin/users", fields);
export const updateAccount = (id, changes) => request("PATCH", account(id), changes);
export const newPasswordLink = (id) => request("POST", `${account(id)}/password-link`);
export const deleteAccount = (id) => request("DELETE", account(id));
