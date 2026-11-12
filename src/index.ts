import 'dotenv/config';
import { createDatabase } from './db/database.js';
import { seedCustomerConfig } from './config/customerConfig.js';
import { createExpressApp } from './api/app.js';
import path from 'node:path';

const dbPath = process.env.DB_PATH || path.resolve(process.cwd(), 'reconciliation.db');
const db = createDatabase(dbPath);
seedCustomerConfig(db);

const authEnabled = process.env.ENABLE_AUTH === 'true';
const app = createExpressApp(db, undefined, { authEnabled });
const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`Cross-Document Reconciliation Engine listening on http://localhost:${port}`);
  if (authEnabled) {
    console.log('🔒 API Authentication & Role-Based Access Control (RBAC) is ENABLED.');
  } else {
    console.log('⚠️ API Authentication is currently in developer bypass mode (ENABLE_AUTH=false).');
  }
});

