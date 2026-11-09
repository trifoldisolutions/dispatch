Set up a new Node.js project at the project root given in step 0, with the following. This prompt sits in that project's `dev_resources/` folder, so that folder is not the root.

Read the **File and Folder Structure** section of the project's `AGENTS.md` first and follow it: it's a hard rule, and it says where everything below goes. This prompt only covers what to build on day one. Folders it doesn't mention (`config/`, `models/`, `middleware/`, `services/`, `scripts/`, `test/`) get added once there's something to put in them. If this prompt and that section disagree, stop and ask.

## 0. Project Path
The project root is `F:\trifoldi\projects\:projectFolderName` — substitute the actual project's folder name for `:projectFolderName` (also used elsewhere in this doc, e.g. the Mongo `dbName`/URI in step 2 and the `.vbs` launcher name in step 6). Use this exact path regardless of whatever default working directory the harness/agent normally creates new files in.

- If `F:\trifoldi\projects\:projectFolderName` already exists, use it as-is as the project root — do not create a nested subdirectory inside it, and do not create the project elsewhere.
- If it does not exist yet, create it at that exact path before doing anything else.
- Do not place any project file (dependencies, `.env`, `server.js`, etc.) in the harness's default directory if that differs from the path above.

## 1. Dependencies
Initialize npm and install:

- express
- mongoose
- ejs
- dotenv

Dev dependencies:
- nodemon
- tailwindcss
- @tailwindcss/cli
- concurrently (optional — only needed if you also want a manual "run both in one pane" script; the default folder-open behavior no longer uses it, see step 7)

## 2. Environment config
Before writing `.env`, look up this project's assigned port in Dispatch's registry: with the Dispatch dashboard running, `GET http://localhost:3000/api/registry` groups ports by category (`fire`/`breeze`/`cold`) and maps each port number to `{ "name", "description" }`; find the entry whose `name` matches `:projectFolderName` and use its port number as `PORT` below. Do not invent or hardcode a port — if no entry exists yet for this project's folder name, stop and ask, since ports are a shared registry and an unreserved one may collide with another project.

Create a `.env` file at the project root with:

```
PORT=<port looked up from Dispatch's registry>
MONGO_URI=mongodb://localhost:27017/:projectFolderName
SESSION_SECRET=
NODE_ENV=development
```

Also create `.env.example` with the same keys and `PORT` left empty. It gets committed, so it never holds a real secret.

## 3. package.json scripts
```
"dev": "nodemon server.js"
"tw": "tailwindcss -i ./src/input.css -o ./public/output.css --watch=always"
"dev:all": "concurrently -k -n TW,SERVER -c yellow,cyan \"npm run tw\" \"npm run dev\""
```
`dev:all` is kept as an optional manual convenience script (single interleaved terminal pane)
but is NOT what auto-runs on folder open — see step 7.

## 4. Basic server + three-facade structure
Create `server.js` using Express + EJS, listening on `PORT` from `.env`. Don't give it a fallback
port: if `PORT` isn't set, stop with an error.
Scaffold the app around three separate facades from day one, each as its own route module
and view folder:

- **Public** (`routes/public.js`, `views/public/`) — mounted at `/`. Landing page + related
  public pages, and the 404 page (`views/public/404.ejs`).
- **App** (`routes/app.js`, `views/app/`) — mounted at `/app`. Index page, a combined
  login/sign-up page (in `views/app/auth/`), and placeholder template pages for the core
  entities (adjust names to the project). Keep these as placeholder shells until real
  requirements are defined.
- **Admin** (`routes/admin.js`, `views/admin/`) — mounted at `/admin`. Index page placeholder.

Every page in all three facades uses the shared `head.ejs` and `foot.ejs` partials in
`views/partials/`. Serve `public/` as static files, create `src/input.css` with
`@import "tailwindcss";`, and load the built `/output.css` from `head.ejs`.

Each route module exports the router with a `.routes` metadata array attached
(`{ method, path, label }`) documenting its own routes inline, e.g.:

```js
router.routes = [
  { method: 'GET', path: '/', label: 'Landing page' },
];
```

In `server.js`, build a `facades` array (`{ name, mount, router }`), mount them all, and on
`app.listen` print a route map as full clickable URLs
(`http://localhost:<port>/path — label`) — this reprints on every nodemon restart too, so
the full route list is always visible in the `npm run dev` terminal tab (Ctrl+click to
navigate in VS Code's integrated terminal).

After the facades, `server.js` answers anything unmatched with the 404 page and ends with an
error handler. Routes stay in the route modules, never in `server.js`.

Mongoose connection: pass `{ dbName: '<project-name>' }` explicitly to `mongoose.connect()`
— local Mongo URIs often omit the database name from the path, so don't rely on it being
implicit.

## 5. Git
Initialize a git repository (`git init`), create a `.gitignore` covering:
```
node_modules/
.env
*.log
npm-debug.log*
.DS_Store
Thumbs.db
public/output.css
dev_resources/
```
Make an initial commit. No remote needed yet.

## 6. Launcher script (.vbs)
Create a `.vbs` file at the project root named :projectFolderName.vbs that just opens VS Code
in the project folder, hidden/silently, via `cmd /c code "<path>"` with window style 0. It
does NOT try to run npm scripts itself — that's handled entirely by `.vscode/tasks.json`
(VS Code's `runOn: folderOpen`), since a `.vbs` script can only launch the editor.

## 7. .vscode/tasks.json — two separate terminal tabs, not one merged pane
Auto-run `npm run tw` and `npm run dev` as **two separate tasks**, each `isBackground: true`,
`runOn: folderOpen`, `presentation.panel: "dedicated"` — this makes each open in its own
terminal tab in VS Code's terminal panel, rather than interleaving both through
`concurrently` in a single pane:

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "TW (watch)",
      "type": "shell",
      "command": "npm run tw",
      "isBackground": true,
      "problemMatcher": [],
      "presentation": { "reveal": "always", "panel": "dedicated", "clear": true },
      "runOptions": { "runOn": "folderOpen" }
    },
    {
      "label": "Server (nodemon)",
      "type": "shell",
      "command": "npm run dev",
      "isBackground": true,
      "problemMatcher": [],
      "presentation": { "reveal": "always", "panel": "dedicated", "clear": true },
      "runOptions": { "runOn": "folderOpen" }
    }
  ]
}
```

## 8. dev_resources/ folder
`dev_resources/` (internal only, git-ignored, not linked from the public site) already exists and
holds this prompt: leave the prompt there, don't copy it to the project root. Add:

- **journal.md** — a daily project log, newest entries at the top, with a template HTML
  comment block for the entry format (`## YYYY-MM-DD`, bullet list of what changed / why).
  Seed it with an entry for the day the project was bootstrapped. If Dispatch already created
  it when the project was added, keep what's there and add that entry.
- **tasks.json** — the project's to-do list, shown in the Dispatch dashboard's Tasks tab. Create
  it empty, as `{ "tags": [], "tasks": [] }`; after that, tasks only change through Dispatch (see
  the Tasks rule in `AGENTS.md`). Don't build a task board page, route or model.

---
