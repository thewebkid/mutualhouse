import path from 'node:path';
import dotenv from 'dotenv';
import { getDb } from '../server/db/index.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const db = await getDb();
const { rows } = await db.query(
  `SELECT table_name
   FROM information_schema.tables
   WHERE table_schema = 'public'
   ORDER BY table_name`
);

console.log(
  `[migrate] Connected via "${db.driver}" · ${rows.length} public tables verified:\n  ${rows.map((r) => r.table_name).join(', ')}`
);

await db.close();
