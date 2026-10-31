const mongoose = require("mongoose");

// Passed explicitly: a local MONGO_URI can leave the database name out of its
// path, and Mongo would then quietly use "test".
const DB_NAME = "dispatch";

async function connectDatabase() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is not set (see .env.example)");
  await mongoose.connect(process.env.MONGO_URI, { dbName: DB_NAME });
}

module.exports = { connectDatabase };
