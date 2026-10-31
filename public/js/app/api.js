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
export const getHome = () => request("GET", "/api/me/home");
export const getPortStatus = (ports) => request("GET", `/api/port-status?ports=${ports.join(",")}`);
export const startProject = (name) => request("POST", `/api/projects/${project(name)}/start`);
export const stopProject = (name) => request("POST", `/api/projects/${project(name)}/stop`);
export const openInVSCode = (name) => request("POST", `/api/projects/${project(name)}/open-vscode`);
export const patchTask = (name, id, changes) =>
  request("PATCH", `/api/project-folders/${project(name)}/tasks/${encodeURIComponent(id)}`, changes);
