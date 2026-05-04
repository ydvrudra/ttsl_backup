//config/sqlConfigSJA.js
require("dotenv").config();
const sql = require("mssql");

const sqlCfg2 = {
  user: process.env.SQLSERVERSJA_USER,
  password: process.env.SQLSERVERSJA_PASSWORD,
  server: process.env.SQLSERVERSJA_SERVER,
  port: Number(process.env.SQLSERVERSJA_PORT) || 1433,
  database: process.env.SQLSERVERSJA_DATABASE,
  connectionTimeout: 180000,
  requestTimeout: 180000,
  options: {
    encrypt: true,
    enableArithAbort: true,
    trustServerCertificate: true
  },
  pool: { max: 5, min: 1, idleTimeoutMillis: 60000, acquireTimeoutMillis: 90000 },
};

const pool2 = new sql.ConnectionPool(sqlCfg2);
const poolConnect2 = pool2.connect();

poolConnect2.then(() => {
  console.log('✅Database SJA connected successfully');
}).catch(err => {
  console.error('❌ Database SJA connection failed:', err.message);
});

module.exports = { sql, pool2, poolConnect2 };
