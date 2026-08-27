import { MongoClient, type Collection } from "mongodb";
import type { NewUser, TeamPerson } from "./store";
import type { AppUser } from "./types";

let clientPromise: Promise<MongoClient> | null = null;
let indexPromise: Promise<string> | null = null;

function mongoUri() {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) throw new Error("MongoDB storage is not configured");
  return uri;
}

async function users(): Promise<Collection<AppUser>> {
  if (!clientPromise) {
    const client = new MongoClient(mongoUri(), {
      appName: "erentals-expense-manager-auth",
      maxPoolSize: 5,
      maxIdleTimeMS: 30_000,
      serverSelectionTimeoutMS: 5_000,
    });
    clientPromise = client.connect().catch((error) => {
      clientPromise = null;
      throw error;
    });
  }
  const client = await clientPromise;
  const database = client.db(process.env.MONGODB_DB_NAME?.trim() || "erentals_expense_manager");
  const collection = database.collection<AppUser>("users");
  if (!indexPromise) {
    indexPromise = collection.createIndex({ email: 1 }, { unique: true }).catch((error) => {
      indexPromise = null;
      throw error;
    });
  }
  await indexPromise;
  return collection;
}

function normalizeUser(user: AppUser | null): AppUser | null {
  return user ? { ...user, personId: user.personId ?? "" } : null;
}

const options = { projection: { _id: 0 } } as const;

export async function findUserByEmail(email: string) {
  return normalizeUser(await (await users()).findOne({ email }, options));
}

export async function findUserById(id: string) {
  return normalizeUser(await (await users()).findOne({ id }, options));
}

export async function listUsers() {
  return (await users()).find({}, options).sort({ createdAt: -1 }).toArray().then((rows) => rows.map((row) => normalizeUser(row) as AppUser));
}

export async function countUsers() {
  return (await users()).countDocuments();
}

export async function createUser(input: NewUser) {
  const timestamp = new Date().toISOString();
  const user: AppUser = {
    id: crypto.randomUUID(),
    name: input.name,
    email: input.email,
    personId: input.personId,
    role: input.role,
    status: "Active",
    passwordHash: input.passwordHash,
    mustChangePassword: input.mustChangePassword,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await (await users()).insertOne(user);
  return user;
}

export async function listTeamPersons() {
  const collection = (await users()).dbName;
  const client = await clientPromise;
  if (!client) throw new Error("MongoDB storage is not configured");
  return client.db(collection).collection<TeamPerson>("persons")
    .find({ status: "Active" }, { projection: { _id: 0, id: 1, name: 1, role: 1, phone: 1, status: 1 } })
    .sort({ name: 1 })
    .toArray();
}

export async function updateUserPerson(id: string, personId: string) {
  await (await users()).updateOne(
    { id },
    { $set: { personId, updatedAt: new Date().toISOString() } },
  );
}

export async function updateUserPassword(id: string, passwordHash: string) {
  await (await users()).updateOne(
    { id },
    { $set: { passwordHash, mustChangePassword: false, updatedAt: new Date().toISOString() } },
  );
}
