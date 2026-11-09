// Fills the local database with starter accounts: an admin, a dev (Claude)
// who is on every project, and one client per project except Dispatch. Leads
// are real people's accounts, so the seed makes none. The projects are the
// ones already in the database (the dashboard's registry), plus Dispatch's
// own, created here if it's missing since the dashboard never adds it. Safe
// to rerun: records are matched by email or project name and set back to
// these values, and nothing else in the database is touched. Every account
// gets SEED_PASSWORD from .env.
require("dotenv").config({ override: true, quiet: true });
const path = require("path");
const mongoose = require("mongoose");
const { connectDatabase } = require("../config/db");
const User = require("../models/User");
const Project = require("../models/Project");
const Membership = require("../models/Membership");
const { description: DISPATCH_DESCRIPTION } = require("../package.json");

const DISPATCH_PROJECT = path.basename(path.join(__dirname, "..")); // SELF_PROJECT in config/projects.js
const EMAIL_DOMAIN = "dispatch.test"; // a reserved domain, so no seed email can reach a real inbox
const LOCAL_HOSTS = ["localhost", "127.0.0.1"];
const UPSERT = { upsert: true, returnDocument: "after", runValidators: true };

// "dilankreyòl" -> "dilankreyol": the client emails are built from project
// names and keep to plain ASCII.
function emailSlug(name) {
  return name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9._-]/g, "");
}

// Accounts with a known password must never land in a live database.
function isLocalUri(uri) {
  try {
    return LOCAL_HOSTS.includes(new URL(uri).hostname);
  } catch {
    return false;
  }
}

async function main() {
  if (!isLocalUri(process.env.MONGO_URI)) throw new Error("the seed only runs against a local MongoDB; check MONGO_URI");
  const password = process.env.SEED_PASSWORD;
  if (!password) throw new Error("SEED_PASSWORD is not set in .env");

  await connectDatabase();
  await Promise.all([User, Project, Membership].map((model) => model.init())); // unique indexes in place before writing

  await Project.updateOne({ name: DISPATCH_PROJECT }, { $setOnInsert: { description: DISPATCH_DESCRIPTION } }, { upsert: true });
  const projects = await Project.find().sort({ port: 1, name: 1 });

  const accounts = [];
  async function upsertUser(email, fields) {
    const passwordHash = await User.hashPassword(password);
    const user = await User.findOneAndUpdate({ email }, { $set: { ...fields, passwordHash, status: "active" } }, UPSERT);
    accounts.push(user);
    return user;
  }
  async function setRole(user, project, role) {
    await Membership.updateOne({ user: user._id, project: project._id }, { $set: { role } }, { upsert: true, runValidators: true });
  }

  await upsertUser(`admin@${EMAIL_DOMAIN}`, { name: "Admin", isAdmin: true });
  const dev = await upsertUser(`claude@${EMAIL_DOMAIN}`, { name: "Claude", isAdmin: false });
  for (const project of projects) {
    await setRole(dev, project, "dev");
    if (project.name === DISPATCH_PROJECT) continue; // internal: no client
    const client = await upsertUser(`client.${emailSlug(project.name)}@${EMAIL_DOMAIN}`, { name: `${project.name} client`, isAdmin: false });
    await setRole(client, project, "client");
  }

  console.log(`Seeded ${accounts.length} accounts across ${projects.length} projects, all with SEED_PASSWORD:`);
  for (const user of accounts) console.log(`  ${user.email}`);
}

main()
  .catch((err) => {
    console.error(`Seed failed: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
