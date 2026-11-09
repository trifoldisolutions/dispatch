require("dotenv").config({ override: true, quiet: true });
const express = require("express");
const path = require("path");
const crypto = require("crypto");
const helmet = require("helmet");
const { connectDatabase } = require("./config/db");
const { PORT } = require("./config/projects");
const { sessions, loadUser } = require("./middleware/auth");
const { skipOptions, answerOptions } = require("./middleware/options");
const appRoutes = require("./routes/app");
const apiRoutes = require("./routes/api");
const live = require("./services/live");
const { avatarUrl } = require("./services/people");
const { syncProjectsRoot } = require("./services/registry");

const app = express();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.disable("x-powered-by");

// helmet's security headers. Its CSP only runs scripts served from this
// origin, so each response gets a fresh nonce for the pages' inline <script>
// (cspNonce in the views). Locally Dispatch is plain http, where upgrading
// requests to https would break every one of them.
app.use((req, res, next) => {
  res.locals.cspNonce = crypto.randomBytes(16).toString("base64");
  next();
});
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        "script-src": ["'self'", (req, res) => `'nonce-${res.locals.cspNonce}'`],
        "upgrade-insecure-requests": process.env.NODE_ENV === "production" ? [] : null,
      },
    },
  })
);

// The pages' stylesheets and scripts (public/css, public/js). Served ahead of
// the login check: they hold no data, and the login page needs none of them.
// No directory redirects or index files, so /js or /css can't answer for a
// project page.
app.use(express.static(path.join(__dirname, "public"), { index: false, redirect: false }));

// Vendor files, ahead of the body parsers and the login check.
const vendor = { name: "Vendor files", mount: "/", router: appRoutes.vendor };
app.use(vendor.mount, skipOptions(vendor.router));

app.use(express.json());
app.use(express.urlencoded({ extended: false })); // the login form
app.use(sessions, loadUser);

// Facades
const facades = [
  { name: "App", mount: "/", router: appRoutes },
  { name: "API", mount: "/api", router: apiRoutes },
];

facades.forEach(({ mount, router }) => app.use(mount, router));
app.use(answerOptions([vendor, ...facades]));

// The left menu's account button shows the user's picture when there is one.
app.locals.avatarUrl = avatarUrl;

syncProjectsRoot();

const server = app.listen(PORT, () => {
  const local = `http://localhost:${PORT}`;
  console.log(`Dispatch running on ${local}`);
  console.log("");
  [vendor, ...facades].forEach(({ name, mount, router }) => {
    console.log(`[${name}]`);
    (router.routes || []).forEach(({ method, path: p, label }) => {
      const full = (mount === "/" ? "" : mount) + (p === "/" && mount !== "/" ? "" : p);
      console.log(`  ${method.padEnd(6)} ${local}${full || "/"} — ${label}`);
    });
  });
  console.log("");
});

server.on("upgrade", live.handleUpgrade);

// Logins and the registry live in the database, so without it nobody can log
// in (the login page says so) and the dashboard can't list projects. The API
// for files, git, journal and tasks still works, and agents post journal
// entries through it, so the failure is logged rather than stopping the server.
connectDatabase()
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error(`MongoDB connection failed: ${err.message}`));
