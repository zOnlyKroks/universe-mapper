// server.ts
import express, { Request, Response } from 'express';
import cors from 'cors';
import axios from 'axios';
import { MongoClient } from 'mongodb';
import { CombinedSystemData, PlanetInfo, SystemInfo, SystemJump, SystemJumps, SystemKill, SystemKills } from './types';

const app = express();
const port = 88;

// MongoDB setup
const mongoUrl = 'mongodb://localhost:27017';
const dbName = 'system_info';
let mongoClient: MongoClient;
let mongoDb: any;

app.use(express.static('public'));
app.use(express.json());
app.use(cors());

// Helper to get data from MongoDB
async function getDataFromMongoDb(key: string): Promise<any> {
  try {
    const data = await mongoDb.collection('cache').findOne({ _id: key });
    return data ? data.value : null;
  } catch (error) {
    console.error(`Error getting data for key ${key}:`, error);
    return null;
  }
}

// Helper to save data to MongoDB
async function saveDataToMongoDb(key: string, value: any): Promise<void> {
  try {
    await mongoDb.collection('cache').updateOne(
      { _id: key },
      { $set: { value } },
      { upsert: true }
    );
  } catch (error) {
    console.error(`Error saving data for key ${key}:`, error);
  }
}

// Endpoint to fetch system data with sorting
app.get('/api/system-data', async (req: Request, res: Response) => {
  try {
    const systemIds = await mongoDb.collection('cache').find({ _id: /_info$/ }).toArray();
    const systemsData: CombinedSystemData[] = [];

    for (const system of systemIds) {
      const systemInfo: SystemInfo = system.value;
      const killsData: SystemKill = await getDataFromMongoDb(`${systemInfo.system_id}_kills`);
      const jumpsData: SystemJump = await getDataFromMongoDb(`${systemInfo.system_id}_jumps`);

      const combinedData: CombinedSystemData = {
        ...systemInfo,
        ship_jumps: jumpsData ? jumpsData.ship_jumps : 0,
        npc_kills: killsData ? killsData.npc_kills : 0,
        pod_kills: killsData ? killsData.pod_kills : 0,
        ship_kills: killsData ? killsData.ship_kills : 0
      };

      systemsData.push(combinedData);
    }

    res.status(200).json(systemsData).end();
  } catch (error) {
    console.error('Error fetching system data:', error);
    res.status(500).send('Error fetching system data');
  }
});

app.get('/api/planet', async (req: Request, res: Response) => {
  try {
    const planetId = String(req.query.planet_id);
    let result: PlanetInfo = await getDataFromMongoDb(`${planetId}_info_planet`);

    if (!result) {
      const planet: PlanetInfo = (await axios.get(`https://esi.evetech.net/latest/universe/planets/${planetId}/`)).data;
      await saveDataToMongoDb(`${planetId}_info_planet`, planet);
      result = planet;
    }

    res.status(200).json(result).end();
  } catch (error) {
    res.status(500).send('Error fetching system planet data');
  }
});

app.get('/api/planet/type', async (req: Request, res: Response) => {
  try {
    const planet_type_id: number = Number(req.query.planet_type_id);
    let planet_type_id_string: string;

    switch (planet_type_id) {
      case 11: planet_type_id_string = 'Planet (Temperate)'; break;
      case 12: planet_type_id_string = 'Planet (Ice)'; break;
      case 13: planet_type_id_string = 'Planet (Gas)'; break;
      case 2014: planet_type_id_string = 'Planet (Oceanic)'; break;
      case 2015: planet_type_id_string = 'Planet (Lava)'; break;
      case 2016: planet_type_id_string = 'Planet (Barren)'; break;
      case 2017: planet_type_id_string = 'Planet (Storm)'; break;
      case 2063: planet_type_id_string = 'Planet (Plasma)'; break;
      default: planet_type_id_string = "Unknown, invalid esi Data!";
    }

    res.status(200).json(planet_type_id_string).end();
  } catch (error) {
    res.status(500).send('Error fetching system planet type');
  }
});

app.listen(port, async () => {
  try {
    mongoClient = new MongoClient(mongoUrl);
    await mongoClient.connect();
    mongoDb = mongoClient.db(dbName);
    console.log(`Connected to MongoDB. Server running on http://localhost:${port}`);

    // Ensure the cache collection exists
    await mongoDb.createCollection('cache');
  } catch (error) {
    console.error('Failed to connect to MongoDB:', error);
    process.exit(1);
  }

  setInterval(() => {
    pullDataFromESI();
  }, 3600 * 60);

  pullDataFromESI();
});

const RETRY_DELAY_MS = 10000; // 30 seconds

async function fetchWithRetry<T>(
  fetchFunction: () => Promise<T>,
  path: string
): Promise<T> {
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      return await fetchFunction();
    } catch (error) {
      console.error(`Attempt ${attempt} failed`);
      if (attempt < 10) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      } else {
        throw new Error("Could not get system id after 10 retries!");
      }
    }
  }
  throw new Error('Failed to fetch data after multiple retries');
}

async function fetchSystemData(systemID: number): Promise<void> {
  try {
    const result = await getDataFromMongoDb(`${systemID}_info`);

    if (!result) {
      const systemInfo: SystemInfo = await fetchWithRetry(() => axios.get(`https://esi.evetech.net/latest/universe/systems/${systemID}/`).then(res => res.data),`https://esi.evetech.net/latest/universe/systems/${systemID}/`);
      
      if (!isWormholeSystem(systemInfo.name)) {
        await saveDataToMongoDb(`${systemID}_info`, systemInfo);

        console.log(systemID)

        if (systemInfo.planets) {
          await Promise.all(systemInfo.planets.map(planetID =>
            fetchWithRetry(() => axios.get(`https://esi.evetech.net/latest/universe/planets/${planetID.planet_id}/`).then(res => res.data), `https://esi.evetech.net/latest/universe/planets/${planetID.planet_id}/`)
              .then(async planet => {
                const planetExists = await getDataFromMongoDb(`${planetID.planet_id}_info_planet`);
                if (!planetExists) {
                  await saveDataToMongoDb(`${planetID.planet_id}_info_planet`, planet);
                }
              })
          ));
        }
      }
    }
  } catch (error) {
    console.error(`Error processing system ${systemID}:`, error);
  }
}

async function pullDataFromESI(): Promise<void> {
  try {
    const systems: number[] = (await axios.get('https://esi.evetech.net/latest/universe/systems/')).data;
    const kills: SystemKills = (await axios.get('https://esi.evetech.net/latest/universe/system_kills/'))
    const jumps: SystemJumps = (await axios.get('https://esi.evetech.net/latest/universe/system_jumps/'))

    for (const systemID of systems) {
      await fetchSystemData(systemID);

      kills.data.forEach(async (kill) => {
        if (kill.system_id === systemID) {
          await saveDataToMongoDb(`${systemID}_kills`, kill);
        }
      });

      jumps.data.forEach(async (jump) => {
        if (jump.system_id === systemID) {
          await saveDataToMongoDb(`${systemID}_jumps`, jump);
        }
      });
    }

    console.log('Sync done!')
  } catch (error) {
    console.error('Error pulling data from ESI:', error);
  }
}

function isWormholeSystem(systemName: string): boolean {
  return systemName.charAt(0) === 'J' && is_numeric(systemName.charAt(1))
}

function is_numeric(str : string){
  return /^\d+$/.test(str);
}

// Ensure to close the MongoDB connection on process exit
process.on('SIGINT', async () => {
  console.log('SIGINT signal received: closing MongoDB connection.');
  await mongoClient.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('SIGTERM signal received: closing MongoDB connection.');
  await mongoClient.close();
  process.exit(0);
});
