// controller/ExchangeRateController.js - FIXED VERSION
const axios = require('axios');
const { pool, poolConnect, sql } = require('../config/sqlConfig');

exports.fetchExchangeRates = async (req, res = null, customPool = null) => {
  try {
    // Use custom pool if provided, else use default ttsl pool
    const dbPool = customPool || pool;
    const dbSql = customPool ? require('mssql') : sql;
    
    // STEP 1: Fetch current rates from API
    const response = await axios.get("https://api.exchangerate-api.com/v4/latest/USD");
    const { rates } = response.data;

    // STEP 2: Get all active currencies from CurrencyMaster
    const currencyResult = await dbPool.request().query(`
      SELECT CurrencyMasterId, CurrencyCode 
      FROM CurrencyMaster 
    `);
    
    //console.log(` Currencies found in DB: ${currencyResult.recordset.length}`);
    
    // IMPROVED: Create mapping with trimmed codes
    const currencyMap = {};
    currencyResult.recordset.forEach(currency => {
      const cleanCode = currency.CurrencyCode.trim().toUpperCase();
      currencyMap[cleanCode] = currency.CurrencyMasterId;
      
      // Also map with spaces (just in case)
      const originalCode = currency.CurrencyCode.toUpperCase();
      if (originalCode !== cleanCode) {
        currencyMap[originalCode] = currency.CurrencyMasterId;
      }
    });

    // Debug: Show what we found
   // console.log(' Available currency codes in map:', Object.keys(currencyMap));

    // STEP 3: Create HEADER record
    const headerResult = await dbPool.request()
      .input('kz_UserId', dbSql.Int, req?.user?.id || 1)
      .input('kz_CompanyId', dbSql.Int, req?.user?.companyId || 1)
      .input('kz_PageMasterId', dbSql.Int, 0)
      .input('kz_LocationId', dbSql.Int, req?.user?.locationId || 1)
      .input('kz_CreatedUserId', dbSql.Int, req?.user?.id || 1)
      .input('ExchangeRateDate', dbSql.Date, new Date())
      .query(`
        INSERT INTO ExchangeRatesHdr (
          kz_UserId, kz_CompanyId, kz_PageMasterId, kz_LocationId,
          kz_CreatedUserId, ExchangeRateDate
        )
        OUTPUT INSERTED.ExchangeRatesHdrId
        VALUES (
          @kz_UserId, @kz_CompanyId, @kz_PageMasterId, @kz_LocationId,
          @kz_CreatedUserId, @ExchangeRateDate
        )
      `);

    const headerId = headerResult.recordset[0].ExchangeRatesHdrId;

    // STEP 4: Insert DETAILS for each currency
    let insertedCount = 0;
    let matchedCurrencies = [];
    
    for (const [currencyCode, usdToCurrencyRate] of Object.entries(rates)) {
      const currencyCodeUpper = currencyCode.toUpperCase();
      
      // Check if this currency exists in CurrencyMaster
      const currencyId = currencyMap[currencyCodeUpper];
      
      if (!currencyId) {
        // Try to find with spaces (for debugging)
        const withSpaces = currencyCodeUpper + '  ';
        if (currencyMap[withSpaces]) {
          //console.log(`ℹ️ Found ${currencyCode} as '${withSpaces}' (with spaces)`);
        }
        continue;
      }

      // Calculate Currency → USD rate
      const currencyToUsdRate = usdToCurrencyRate !== 0 ? (1 / usdToCurrencyRate) : 0;

      await dbPool.request()
        .input('ExchangeRatesHdrId', dbSql.Int, headerId)
        .input('kz_UserId', dbSql.Int, req?.user?.id || 1)
        .input('kz_CompanyId', dbSql.Int, req?.user?.companyId || 1)
        .input('kz_PageMasterId', dbSql.Int, 0)
        .input('kz_LocationId', dbSql.Int, req?.user?.locationId || 1)
        .input('CurrencyId', dbSql.Int, currencyId)
        .input('CurrencyCode', dbSql.VarChar, currencyCode)
        .input('ExchageRateCurrencyToUsd', dbSql.Numeric(18, 6), currencyToUsdRate)
        .input('ExchangeRateUsdtoCurrency', dbSql.Numeric(18, 6), usdToCurrencyRate)
        .input('kz_CreatedUserId', dbSql.Int, req?.user?.id || 1)
        .query(`
          INSERT INTO ExchangeRatesDetails (
            ExchangeRatesHdrId, kz_UserId, kz_CompanyId, kz_PageMasterId, kz_LocationId,
            CurrencyId, CurrencyCode, ExchageRateCurrencyToUsd, ExchangeRateUsdtoCurrency,
            kz_CreatedUserId
          )
          VALUES (
            @ExchangeRatesHdrId, @kz_UserId, @kz_CompanyId, @kz_PageMasterId, @kz_LocationId,
            @CurrencyId, @CurrencyCode, @ExchageRateCurrencyToUsd, @ExchangeRateUsdtoCurrency,
            @kz_CreatedUserId
          )
        `);

      insertedCount++;
      matchedCurrencies.push(currencyCode);
    }

   // console.log(` Inserted ${insertedCount} exchange rates | HeaderId: ${headerId}`);
    //console.log(` Matched currencies: ${matchedCurrencies.join(', ')}`);
    
    // Only send response if res object exists
    if (res && typeof res.status === 'function') {
      return res.status(200).json({ 
        message: `Exchange rates updated successfully.`,
        headerId: headerId,
        currenciesInserted: insertedCount,
        matchedCurrencies: matchedCurrencies,
        date: new Date().toISOString().split('T')[0]
      });
    }
    
    // Return result for cron job
    return { headerId, insertedCount, matchedCurrencies };

  } catch (error) {
    console.error("❌ Error in fetchExchangeRates:", error.message);
    
    // Only send error response if res object exists
    if (res && typeof res.status === 'function') {
      return res.status(500).json({ 
        message: 'Error fetching exchange rates', 
        error: error.message 
      });
    }
    
    // Throw error for cron job to catch
    throw error;
  }
};