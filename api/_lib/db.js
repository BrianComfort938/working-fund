// Cached MongoDB connection, reused across serverless invocations on Vercel.
const { MongoClient } = require("mongodb");

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || "pettycash";

// Reuse the connection between warm invocations (avoids exhausting Atlas limits).
let cached = global.__mongo;
if (!cached) cached = global.__mongo = { promise: null };

async function getDb() {
  if (!uri) throw new Error("MONGODB_URI environment variable is not set");
  if (!cached.promise) {
    cached.promise = MongoClient.connect(uri, { maxPoolSize: 5 });
  }
  const client = await cached.promise;
  return client.db(dbName);
}

module.exports = { getDb };
