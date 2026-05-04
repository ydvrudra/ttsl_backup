// cron job file - BOTH DATABASES

//truckHelpers//cronJobs.js
const cron = require('node-cron');
const { fetchExchangeRates } = require('../controller/ExchangeRateController');
const { pool: pool1 } = require('../config/sqlConfig');  // ttsl DB
const { pool2 } = require('../config/sqlConfigSJA');     // SJA DB

const fs = require('fs');

cron.schedule('24 12 * * *', async () => {
  console.log(`\n\n CRON STARTED: ${new Date().toLocaleString('en-IN', {timeZone: 'Asia/Kolkata'})}`);
  console.log(` Exchange rate update for BOTH databases`);
  
  // Log file
  fs.appendFileSync('cron.log', `[${new Date().toISOString()}] Cron started\n`);

  try {
    const mockRequest = {
      user: { id: 1, companyId: 1, locationId: 1 }
    };

    // ========== ttsl DB ==========
    console.log('\n📊 Processing ttsl DB...');
    try {
      const result1 = await fetchExchangeRates(mockRequest, null, pool1);
      console.log(`✅ ttsl DB: Inserted ${result1.insertedCount} exchange rates`);
      console.log(` Header ID: ${result1.headerId}`);
      fs.appendFileSync('cron.log', `[${new Date().toISOString()}] ttsl Success: ${result1.insertedCount} rates\n`);
    } catch (error1) {
      console.error(`❌ ttsl DB failed:`, error1.message);
      fs.appendFileSync('cron.log', `[${new Date().toISOString()}] ttsl Error: ${error1.message}\n`);
    }

    // ========== WAIT 3 SECONDS ==========
    console.log(' Waiting 3 seconds before SJA DB...');
    await new Promise(resolve => setTimeout(resolve, 3000));

    // ========== SJA DB ==========
    console.log('\n Processing SJA DB...');
    try {
      const result2 = await fetchExchangeRates(mockRequest, null, pool2);
      console.log(`✅ SJA DB: Inserted ${result2.insertedCount} exchange rates`);
      console.log(` Header ID: ${result2.headerId}`);
      fs.appendFileSync('cron.log', `[${new Date().toISOString()}] SJA Success: ${result2.insertedCount} rates\n`);
    } catch (error2) {
      console.error(`❌ SJA DB failed:`, error2.message);
      console.error('Full error stack:', error2.stack);
      fs.appendFileSync('cron.log', `[${new Date().toISOString()}] SJA Error: ${error2.message}\n`);
    }

    console.log('\n✅ CRON COMPLETED for both databases');
    fs.appendFileSync('cron.log', `[${new Date().toISOString()}] Cron completed\n\n`);

  } catch (error) {
    console.error(`❌ CRON FAILED:`, error.message);
    fs.appendFileSync('cron.log', `[${new Date().toISOString()}] CRON Failed: ${error.message}\n\n`);
  }
}, { timezone: 'Asia/Kolkata' });