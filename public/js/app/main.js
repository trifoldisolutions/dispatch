// The newer parts of the page, in Preact: Home and /projects (in #app-view),
// the project list beside project pages (in #project-list-root) and the
// command palette (in #palette-root). They load after the older scripts in
// public/js/legacy and talk to them through window.DispatchLegacy, until
// those parts are rebuilt here too.
import { render } from "preact";
import { effect } from "@preact/signals";
import { html } from "./html.js";
import * as store from "./store.js";
import { Home } from "./home.js";
import { ProjectList, ProjectsPage, listOpen, firstProjectPath } from "./projects.js";
import { Palette, paletteOpen } from "./palette.js";
import "./live.js";

const appView = document.getElementById("app-view");
const firstName = (appView.dataset.user || "").trim().split(/\s+/)[0] || "there";

function App() {
  const view = store.view.value;
  if (view === "home") return html`<${Home} userName=${firstName} />`;
  if (view === "projects") return html`<${ProjectsPage} />`;
  return null;
}

store.init();
render(html`<${App} />`, appView);
render(html`<${ProjectList} />`, document.getElementById("project-list-root"));
render(html`<${Palette} />`, document.getElementById("palette-root"));
document.getElementById("palette-btn").addEventListener("click", () => (paletteOpen.value = true));
document.getElementById("project-list-btn").addEventListener("click", () => (listOpen.value = true));

// The left menu's Projects leads straight to the first project in the list;
// /projects stands in until the list has loaded.
const railProjects = document.querySelector('#rail [data-rail="projects"]');
effect(() => railProjects.setAttribute("href", firstProjectPath.value || "/projects"));
