// Test profiles for the side column's People, until real staff join: two
// leads and eight developers, some on a few projects, two on none yet (new
// joiners, whom a lead would look for to add to a project). Their last-seen
// times are spread over the past few days. Run it after scripts/seed.js;
// --remove deletes these accounts and every membership they hold. Safe to
// rerun: accounts are matched by email and set back to these values. Like
// scripts/seed.js, local databases only, every account with SEED_PASSWORD.
//
//   node scripts/seed-people.js            add or reset them
//   node scripts/seed-people.js --remove   delete them
require("dotenv").config({ override: true, quiet: true });
const mongoose = require("mongoose");
const { connectDatabase } = require("../db");
const User = require("../models/User");
const Project = require("../models/Project");
const Membership = require("../models/Membership");

const EMAIL_DOMAIN = "dispatch.test"; // a reserved domain, so no seed email can reach a real inbox
const LOCAL_HOSTS = ["localhost", "127.0.0.1"];
const MINUTE = 60 * 1000;

// [name, email name, minutes since last seen, { project: role }]
const PEOPLE = [
  ["Nadia Okafor", "nadia", 20, { grabbn: "lead", theclio: "lead" }],
  ["Tomás Reyes", "tomas", 3 * 60, { whimish: "lead", tapayiti: "lead" }],
  ["Ana Ribeiro", "ana", 45, { genlpt: "dev", grabbn: "dev" }],
  ["Kwame Mensah", "kwame", 90, { genlpt: "dev", ozsdiaries: "dev", theclio: "dev" }],
  ["Priya Nair", "priya", 26 * 60, { storiesbyshews: "dev" }],
  ["Léa Martin", "lea", 5 * 60, { boobayoo: "dev", whimish: "dev" }],
  ["Marcus Bell", "marcus", 3 * 24 * 60, { "3tsworkride": "dev" }],
  ["Yuki Tanaka", "yuki", 8 * 60, { tapayiti: "dev", wapdooz: "dev" }],
  ["Jonah Kim", "jonah", 2 * 24 * 60, {}],
  ["Sofia Haddad", "sofia", null, {}],
];

const emailOf = (local) => `${local}@${EMAIL_DOMAIN}`;

function isLocalUri(uri) {
  try {
    return LOCAL_HOSTS.includes(new URL(uri).hostname);
  } catch {
    return false;
  }
}

async function remove() {
  const users = await User.find({ email: { $in: PEOPLE.map(([, local]) => emailOf(local)) } }, { _id: 1 }).lean();
  const ids = users.map((user) => user._id);
  const { deletedCount: memberships } = await Membership.deleteMany({ user: { $in: ids } });
  const { deletedCount: accounts } = await User.deleteMany({ _id: { $in: ids } });
  console.log(`Removed ${accounts} test profiles and ${memberships} memberships.`);
}

async function seed() {
  const password = process.env.SEED_PASSWORD;
  if (!password) throw new Error("SEED_PASSWORD is not set in .env");
  const projects = new Map((await Project.find({}, { name: 1 }).lean()).map((project) => [project.name, project]));
  const passwordHash = await User.hashPassword(password);
  for (const [name, local, minutes, roles] of PEOPLE) {
    const user = await User.findOneAndUpdate(
      { email: emailOf(local) },
      { $set: { name, isAdmin: false, status: "active", passwordHash, lastSeenAt: minutes === null ? null : new Date(Date.now() - minutes * MINUTE) } },
      { upsert: true, returnDocument: "after", runValidators: true }
    );
    // Back to exactly these roles, whatever was added since.
    await Membership.deleteMany({ user: user._id });
    for (const [projectName, role] of Object.entries(roles)) {
      const project = projects.get(projectName);
      if (project) await Membership.create({ user: user._id, project: project._id, role });
      else console.warn(`  no project "${projectName}" for ${name}: skipped`);
    }
    console.log(`  ${emailOf(local)}  ${Object.entries(roles).map(([p, r]) => `${p}:${r}`).join(", ") || "(no projects)"}`);
  }
  console.log(`Seeded ${PEOPLE.length} test profiles, all with SEED_PASSWORD. Remove them with --remove.`);
}

async function main() {
  if (!isLocalUri(process.env.MONGO_URI)) throw new Error("the seed only runs against a local MongoDB; check MONGO_URI");
  await connectDatabase();
  await Promise.all([User, Membership].map((model) => model.init()));
  await (process.argv.includes("--remove") ? remove() : seed());
}

main()
  .catch((err) => {
    console.error(`Seed failed: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
