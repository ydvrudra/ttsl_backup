//truckHelpers//truckRateCalculator.js
const { sql } = require('../config/sqlConfig');
const { AppError, ErrorTypes } = require('../utils/errorHandler');

class TruckRateCalculator {
  constructor(client) {
    this.client = client;
  }

  // ✅ Method 1: Latest exchange rate fetch
  async getLatestExchangeRate(currencyId) {
    try {
      const query = `
        SELECT TOP 1 
          ERD.ExchageRateCurrencyToUsd,
          ERD.ExchangeRateUsdtoCurrency,
          ERH.ExchangeRateDate
        FROM ExchangeRatesDetails ERD
        JOIN ExchangeRatesHdr ERH ON ERD.ExchangeRatesHdrId = ERH.ExchangeRatesHdrId
        WHERE ERD.CurrencyId = @currencyId
        ORDER BY ERH.ExchangeRatesHdrId DESC
      `;
      
      const result = await this.client.request()
        .input('currencyId', sql.Int, currencyId)
        .query(query);
      
      if (result.recordset[0]) {
        return {
          currencyToUsd: result.recordset[0].ExchageRateCurrencyToUsd || 1,
          usdToCurrency: result.recordset[0].ExchangeRateUsdtoCurrency || 1,
          rateDate: result.recordset[0].ExchangeRateDate
        };
      }
      
      // Agar rate nahi mila to default
      return {
        currencyToUsd: 1,
        usdToCurrency: 1,
        rateDate: new Date()
      };
      
    } catch (error) {
      console.error('Error fetching exchange rate:', error);
      return {
        currencyToUsd: 1,
        usdToCurrency: 1,
        rateDate: new Date()
      };
    }
  }

  // ✅ Method 2: Get currency code
  async getCurrencyCode(currencyId) {
    try {
      const query = `
        SELECT TOP 1 CurrencyCode 
        FROM CurrencyMaster 
        WHERE CurrencyMasterId = @currencyId
      `;
      
      const result = await this.client.request()
        .input('currencyId', sql.Int, currencyId)
        .query(query);
      
      if (result.recordset[0]) {
        return result.recordset[0].CurrencyCode || 'INR';
      }
    } catch (error) {
      console.error('Error fetching currency:', error);
    }
    return 'INR'; // Fallback
  }

  // ✅ Method 3: Get USD currency ID from database
  async getUSDCurrencyId() {
    try {
      const query = `
        SELECT TOP 1 CurrencyMasterId 
        FROM CurrencyMaster 
        WHERE CurrencyCode = 'USD'
      `;
      
      const result = await this.client.request().query(query);
      return result.recordset[0]?.CurrencyMasterId || 1; // Default to 1 if not found
    } catch (error) {
      console.error('Error fetching USD currency ID:', error);
      return 1; // Fallback
    }
  }

  async getDefaultCurrencyId() {
  try {
    // Check column name in your database
    const query = `
      SELECT TOP 1 CurrencyMasterId 
      FROM CurrencyMaster 
      WHERE IsDefaultCurrency = 1 OR IsDefault = 1 OR IsActive = 1
      ORDER BY CurrencyMasterId
    `;
    
    const result = await this.client.request().query(query);
    return result.recordset[0]?.CurrencyMasterId || 1;
  } catch (error) {
    console.error('Error fetching default currency:', error.message);
    return 1;
  }
}
  // ========== MAIN RATE CALCULATION METHODS ==========

  // ✅ Method 5: Get vehicle column mapping
  async getVehicleColumnMapping(vehicleId) {
    const query = `
      SELECT TOP 1 ColumnName 
      FROM MapVehicle 
      WHERE VehicleId = @vehicleId
    `;
    
    const result = await this.client.request()
      .input('vehicleId', sql.Int, vehicleId)
      .query(query);
    
    return result.recordset[0]?.ColumnName || null;
  }

  // ✅ Method 6: Calculate FINAL rate for ONE truck
  async calculateFinalRateForTruck(vehicleId, fromLocationId, toLocationId, companyId, segmentId) {
    try {
      // Step 1: Get column name
      const columnName = await this.getVehicleColumnMapping(vehicleId);
      if (!columnName) {
        console.log(`❌ No column mapping for vehicle ${vehicleId}`);
        return null;
      }

      // Step 2: Get base rate
      const baseRateQuery = `
        SELECT TOP 1 
          ${columnName} as BaseRate,
          CurrencyId
        FROM TruckingContractsRate
        WHERE PickupLocationId = @fromLoc
          AND FinalLocationId = @toLoc
      `;

      const baseRateResult = await this.client.request()
        .input('fromLoc', sql.Int, fromLocationId)
        .input('toLoc', sql.Int, toLocationId)
        .query(baseRateQuery);
      
      const baseRateRow = baseRateResult.recordset[0];
      if (!baseRateRow || baseRateRow.BaseRate == null) {
       // console.log(`❌ No rate found for ${columnName} on this route`);
        return null;
      }
      
      const baseRate = Number(baseRateRow.BaseRate);
      let contractCurrencyId = baseRateRow.CurrencyId;

      // Step 3: Get contract currency code
      const currencyCode = await this.getCurrencyCode(contractCurrencyId);
      const isUSD = currencyCode === 'USD';
      
      // If no currency in contract, get default
      if (!contractCurrencyId) {
        contractCurrencyId = await this.getDefaultCurrencyId();
      }

      // Step 4: Get appreciation %
      const appreciationQuery = `
        SELECT TOP 1 ISNULL(AppreciationPer, 0) as AppreciationPer
        FROM AppreciationConfiguration
        WHERE CompanyId = @companyId
          AND SegmentId = @segmentId
        ORDER BY AppreciationConfigurationId DESC
      `;
      
      const appreciationResult = await this.client.request()
        .input('companyId', sql.Int, companyId)
        .input('segmentId', sql.Int, segmentId)
        .query(appreciationQuery);
      
      const appreciationPercent = appreciationResult.recordset[0]?.AppreciationPer || 0;

      // Step 5: Apply appreciation
      const rateWithAppreciation = baseRate + (baseRate * appreciationPercent / 100.0);

      // Step 6: Get exchange rate (only if not USD)
      let exchangeRateToUSD = 1;
      let exchangeRateDate = new Date();
      
      if (!isUSD) {
        const exchangeInfo = await this.getLatestExchangeRate(contractCurrencyId);
        exchangeRateToUSD = exchangeInfo.currencyToUsd;
        exchangeRateDate = exchangeInfo.rateDate;
        
       // console.log(`💰 Exchange Rate: 1 USD = ${(1/exchangeRateToUSD).toFixed(2)} ${currencyCode}`);
        //console.log(`📅 Rate Date: ${exchangeRateDate}`);
      } else {
        //console.log(`✅ Contract in USD, no conversion needed`);
      }

      // Step 7: Calculate USD equivalent
      const rateInUSD = rateWithAppreciation * exchangeRateToUSD;

      // Step 8: Get truck details
      const truckQuery = `
        SELECT 
          VehicleTypeMasterId as truckId,
          VehicleName as truckName,
          Length as lengthFt,
          Width as widthFt,
          Height as heightFt,
          ISNULL(CBMCapacity, 0) as cbmCapacity
        FROM VehicleTypeMaster
        WHERE VehicleTypeMasterId = @vehicleId
      `;
      
      const truckResult = await this.client.request()
        .input('vehicleId', sql.Int, vehicleId)
        .query(truckQuery);
      
      const truck = truckResult.recordset[0];

      // Step 9: Return complete rate object
      return {
        truckId: vehicleId,
        truckName: truck?.truckName || `Truck ${vehicleId}`,
        
        // Currency information
        currencyId: contractCurrencyId,
        currencyCode: currencyCode,
        isUSD: isUSD,
        
        // Dimensions
        lengthFt: Number(truck?.lengthFt || 0),
        widthFt: Number(truck?.widthFt || 0),
        heightFt: Number(truck?.heightFt || 0),
        cbmCapacity: Number(truck?.cbmCapacity || 0),
        
        // Usable dimensions
        usableLengthFt: Math.max(0, Number(truck?.lengthFt || 0) - 0.25),
        usableWidthFt: Math.max(0, Number(truck?.widthFt || 0) - 0.25),
        usableHeightFt: Math.max(0, Number(truck?.heightFt || 0) - 0.25),
        
        // Rates in original currency
        baseRate: baseRate,
        appreciationPercent: appreciationPercent,
        rateWithAppreciation: rateWithAppreciation,
        
        // Exchange rate information
        exchangeRateToUSD: exchangeRateToUSD,
        exchangeRateUsdToCurrency: exchangeRateToUSD !== 0 ? 1/exchangeRateToUSD : 1,
        exchangeRateDate: exchangeRateDate,
        
        // USD converted rates
        rateInUSD: rateInUSD,
        ratePerCbm: truck?.cbmCapacity > 0 ? rateWithAppreciation / truck.cbmCapacity : 0,
        ratePerCbmInUSD: truck?.cbmCapacity > 0 ? rateInUSD / truck.cbmCapacity : 0
      };
      
    } catch (error) {
     // console.error(`Error calculating rate for truck ${vehicleId}:`, error);
      return null;
    }
  }

  // ✅ Method 7: Get rates for MULTIPLE trucks
  async getRatesForTrucks(truckIds, fromLocationId, toLocationId, companyId, segmentId) {
    if (!truckIds || !Array.isArray(truckIds) || truckIds.length === 0) {
      throw new AppError(
        ErrorTypes.VALIDATION.INVALID_INPUT,
        'truckIds array is required and cannot be empty'
      );
    }

    if (!fromLocationId || !toLocationId) {
      throw new AppError(
        ErrorTypes.VALIDATION.INVALID_INPUT,
        'fromLocationId and toLocationId are required'
      );
    }

    const rates = [];
    
    for (const truckId of truckIds) {
      const rate = await this.calculateFinalRateForTruck(
        truckId, fromLocationId, toLocationId, companyId, segmentId
      );
      
      if (rate) {
        rates.push(rate);
      }
    }
    
    // Sort by rateWithAppreciation (cheapest first)
    rates.sort((a, b) => a.rateWithAppreciation - b.rateWithAppreciation);
    
    // Log results
    //console.log(`\n✅ FINAL RATES FOR ${rates.length} TRUCKS:`);
    // rates.forEach((rate, i) => {
    //   console.log(`${i+1}. ${rate.truckName}:`);
    //   console.log(`   ${rate.currencyCode} ${rate.rateWithAppreciation.toFixed(2)}`);
    //   if (!rate.isUSD) {
    //     console.log(`   USD ${rate.rateInUSD.toFixed(2)} (1 USD = ${(1/rate.exchangeRateToUSD).toFixed(2)} ${rate.currencyCode})`);
    //   }
    //   console.log(`   Date: ${rate.exchangeRateDate}`);
    // });
    
    return rates;
  }

  // ✅ Method 8: Get local charges separately
  async getLocalChargesSeparate(fromLocationId, toLocationId, segmentId) {
    const query = `
      -- Origin Charges
      SELECT 
        1 AS chargeForId,
        lcd.ChargeId,
        lcd.ChargeAmount,
        lcd.CurrencyId,
        lcd.UnitId,
        lcd.AtActual
      FROM LocalChargesDetails lcd
      INNER JOIN LocalCharges lc ON lcd.LocalChargesId = lc.LocalChargesId
      WHERE lcd.SegmentId = @segmentId 
        AND lc.CityId = @fromLoc
      
      UNION ALL
      
      -- Destination Charges  
      SELECT 
        2 AS chargeForId,
        lcd.ChargeId,
        lcd.ChargeAmount,
        lcd.CurrencyId,
        lcd.UnitId,
        lcd.AtActual
      FROM LocalChargesDetails lcd
      INNER JOIN LocalCharges lc ON lcd.LocalChargesId = lc.LocalChargesId
      WHERE lcd.SegmentId = @segmentId 
        AND lc.CityId = @toLoc
    `;
    
    const result = await this.client.request()
      .input('segmentId', sql.Int, segmentId)
      .input('fromLoc', sql.Int, fromLocationId)
      .input('toLoc', sql.Int, toLocationId)
      .query(query);
    
    return result.recordset;
  }
}

module.exports = TruckRateCalculator;