// The newer parts of the page, in Preact: / and /projects on their way to a
// project, /people and an admin's /users (in #app-view), the project list beside project pages (in
// #project-list-root), the side column's tasks and people under the Add
// project form (in #side-root) and the command palette (in #palette-root).
// They load after the older scripts in public/js/legacy and talk to them
// through window.DispatchLegacy, until those parts are rebuilt here too.
import { render } from "preact";
import { effect } from "@preact/signals";
import { html } from "./html.js";
import * as store from "./store.js";
import { ProjectList, ProjectsPage, listOpen, firstProjectPath } from "./projects.js";
import { Side, PeoplePage } from "./side.js";
import { Palette } from "./palette.js";
import { UsersPage } from "./users.js";
import "./live.js";

function App() {
  if (store.view.value === "projects") return html`<${ProjectsPage} />`;
  if (store.view.value === "people") return html`<${PeoplePage} />`;
  if (store.view.value === "users" && store.isAdmin) return html`<${UsersPage} />`;
  return null;
}

store.init();
render(html`<${App} />`, document.getElementById("app-view"));
render(html`<${ProjectList} />`, document.getElementById("project-list-root"));
render(html`<${Side} />`, document.getElementById("side-root"));
render(html`<${Palette} />`, document.getElementById("palette-root"));
document.getElementById("project-list-btn").addEventListener("click", () => (listOpen.value = true));

// The left menu's Projects leads straight to the first project in the list;
// /projects stands in until the list has loaded. An admin's menu has Users
// in its place.
const railProjects = document.querySelector('#rail [data-rail="projects"]');
if (railProjects) effect(() => railProjects.setAttribute("href", firstProjectPath.value || "/projects"));

// The account popup (views/app/index.ejs) opens 8px beside the left menu, its
// foot level with the avatar's; on the phone's bottom bar, 8px above the
// bar, its right edge with the avatar's. Escape closes it before the page's
// own Escape (boot.js) can abandon an edit or leave a section's page.
const rail = document.getElementById("rail");
const accountBtn = document.getElementById("account-btn");
const accountMenu = document.getElementById("account-menu");
accountMenu.addEventListener("beforetoggle", (e) => {
  if (e.newState !== "open") return;
  const bar = rail.getBoundingClientRect();
  const avatar = accountBtn.getBoundingClientRect();
  const side = bar.height > bar.width;
  Object.assign(accountMenu.style, {
    left: side ? `${bar.right + 8}px` : "auto",
    right: side ? "auto" : `${Math.max(8, window.innerWidth - avatar.right)}px`,
    bottom: `${side ? window.innerHeight - avatar.bottom : window.innerHeight - bar.top + 8}px`,
  });
});
accountMenu.addEventListener("toggle", (e) => accountBtn.setAttribute("aria-expanded", e.newState === "open"));
window.addEventListener(
  "keydown",
  (e) => {
    if (e.key !== "Escape" || !accountMenu.matches(":popover-open")) return;
    e.stopPropagation();
    accountMenu.hidePopover();
  },
  true
);
