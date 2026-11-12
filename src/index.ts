import { createDatabase } from './db/database.js';
import { seedCustomerConfig } from './config/customerConfig.js';
import { createExpressApp } from './api/app.js';
import path from 'node:path';

const dbPath = process.env.DB_PATH || path.resolve(process.cwd(), 'reconciliation.db');
const db = createDatabase(dbPath);
seedCustomerConfig(db);

const app = createExpressApp(db);
const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`Cross-Document Reconciliation Engine listening on http://localhost:${port}`);
});

