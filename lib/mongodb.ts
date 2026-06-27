import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI||'mongodb+srv://sathishchandran321:9uYGXNxjs7qFQqn9@cluster0.0k4nwbh.mongodb.net/idcard_db?retryWrites=true&w=majority&appName=Cluster0';

if (!MONGODB_URI) {
  throw new Error(
    'Missing MONGODB_URI environment variable. Set it in .env.local for local dev, ' +
    'and in your Vercel project Settings -> Environment Variables for production.'
  );
}

interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

declare global {
  var mongooseCache: MongooseCache;
}

if (!global.mongooseCache) {
  global.mongooseCache = { conn: null, promise: null };
}

const cache = global.mongooseCache;

export async function connectDB() {
  if (cache.conn) return cache.conn;
  if (!cache.promise) {
    cache.promise = mongoose.connect('mongodb://127.0.0.1:27017/id-card-creator', { bufferCommands: false });
  }
  cache.conn = await cache.promise;
  return cache.conn;
}
