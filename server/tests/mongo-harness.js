/**
 * A real MongoDB for a test to talk to.
 *
 * The default ten seconds is not enough here: WiredTiger takes six or seven to
 * initialise on a loaded machine, and the process is killed a moment after it
 * finishes starting — which reports as "failed to start" when what actually
 * happened is that it started too slowly to be waited for. The generous limit
 * costs nothing when the machine is quick.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

export async function startMongo(dbName = 'vignan') {
  const mongod = await MongoMemoryServer.create({
    instance: { launchTimeout: 120_000 },
  });
  await mongoose.connect(mongod.getUri(), { dbName });
  return {
    uri: mongod.getUri(),
    async stop() {
      await mongoose.disconnect();
      await mongod.stop();
    },
  };
}
