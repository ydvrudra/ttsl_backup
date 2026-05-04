// services/insertService.js
const { sql, pool, poolConnect } = require('../config/sqlConfig');
const { AppError, ErrorTypes } = require('../utils/errorHandler');

class InsertService {

//     // ✅ Add this method to InsertService class
// async saveEnquiryError(recordId, errorResponse) {
//     try {
//         await pool.request()
//             .input('recordId', sql.Int, recordId)
//             .input('errorCode', sql.VarChar, errorResponse.errorCode || 'UNKNOWN_ERROR')
//             .input('userMessage', sql.VarChar, errorResponse.userMessage || 'Unknown error')
//             .input('technicalDetails', sql.VarChar, errorResponse.technicalDetails || '')
//             .input('errorData', sql.NVarChar, JSON.stringify(errorResponse.details || {}))
//             .query(`
//                 INSERT INTO EnquiryErrors 
//                 (EnquiryDimensionsHdrId, ErrorCode, UserMessage, TechnicalDetails, ErrorData)
//                 VALUES (@recordId, @errorCode, @userMessage, @technicalDetails, @errorData)
//             `);
            
//         console.log(`✅ Saved error for record ${recordId}: ${errorResponse.errorCode}`);
//     } catch (error) {
//         console.warn('Could not save enquiry error:', error.message);
//     }
// }
    
    // ✅ 1. Insert API response into table (UPDATED)
    async insertResponseToTable(recordId, apiResponse) {
        try {
            await poolConnect;
            
            // Validate response
            if (!apiResponse.options || !Array.isArray(apiResponse.options)) {
               // console.log(`📭 No options to insert for record ${recordId}`);
                return { success: false, message: 'No options in response' };
            }
            
            // Delete old options
            await this.deleteOldOptions(recordId);
            
            // Insert each option
            let insertedCount = 0;
            for (const option of apiResponse.options) {
                await this.insertSingleOption(recordId, option);
                insertedCount++;
            }
            
           // console.log(`✅ Inserted ${insertedCount} options for record ${recordId}`);
            return { success: true, inserted: insertedCount };
            
        } catch (error) {
            console.error(`❌ Error inserting API response:`, error);
            throw new AppError(
                ErrorTypes.DATABASE.QUERY_FAILED,
                `Failed to insert options for record ${recordId}: ${error.message}`
            );
        }
    }
    
    // ✅ 2. Delete old options (same)
    async deleteOldOptions(recordId) {
        try {
            await pool.request()
                .input('recordId', sql.Int, recordId)
                .query(`
                    DELETE FROM EnquiryVehicleQuotationOption
                    WHERE EnquiryDimensionsHdrId = @recordId
                `);
        } catch (error) {
            console.warn(`⚠️ Could not delete old options for ${recordId}:`, error.message);
        }
    }
    
// ✅ 3. Insert single option (UPDATED WITH COMMA SEPARATED RATES)
async insertSingleOption(recordId, option) {
    const request = pool.request();
    
    const truckDetails = this.formatTruckDetails(option.allocations);
    const suggestedTruckIds = this.extractTruckIds(option.allocations);
    const totalCBM = this.calculateTotalCBM(option.allocations);
    const totalWeight = this.calculateTotalWeight(option.allocations);
    
    // ✅ FIX 1: RATEPERTRUCK KO COMMA SEPARATED BANAYE
    let ratePerTruckString = '';
    if (option.allocations && option.allocations.length > 0) {
        const ratesArray = [];
        for (const alloc of option.allocations) {
            const truckCount = alloc.truckCount || 1;
            const rate = alloc.ratePerTruck || 0;
            // Agar ek hi truck type ke multiple hain to rate ko utni baar repeat karo
            for (let i = 0; i < truckCount; i++) {
                ratesArray.push(rate);
            }
        }
        ratePerTruckString = ratesArray.join(', ');
    } else {
        ratePerTruckString = '0';
    }
    
    // ✅ FIX 2: TotalTruckRate column me TOTAL cost (all trucks)
    const totalTruckRate = option.totalCost || 0;
    
    // Get exchange rate date from allocation details
    const exchangeRateDate = option.allocations.length > 0 
        ? (option.allocations[0].rateDetails?.exchangeRateDate || new Date())
        : new Date();
    
    const query = `
        INSERT INTO EnquiryVehicleQuotationOption (
            EnquiryDimensionsHdrId,
            OptionName,
            TruckDetails,
            AllocationsJson,
            TotalTrucks,
            TotalPackages,
            TotalCBM,
            TotalWeight,
            RatePerTruck,           -- ✅ comma separated values
            TotalTruckRate,         --  TOTAL cost (all trucks)
            Currency,
            TotalCostInUSD,         -- ✅ USD converted total
            ExchangeRateUsed,       -- ✅ Exchange rate used
            ExchangeRateDate,       -- ✅ Date of exchange rate
            SuggestedTruckIds,
            kz_CreatedUserId,
            kz_ModifiedDateTime
        ) VALUES (
            @recordId,
            @optionName,
            @truckDetails,
            @allocationsJson,  
            @totalTrucks,
            @totalPackages,
            @totalCBM,
            @totalWeight,
            @ratePerTruck,          -- ✅ Ab string hai
            @totalTruckRate,
            @currency,
            @totalCostInUSD,
            @exchangeRateUsed,
            @exchangeRateDate,
            @suggestedTruckIds,
            @userId,
            GETDATE()
        )
    `;
    
    await request
        .input('recordId', sql.Int, recordId)
        .input('optionName', sql.VarChar, option.optionName || 'API Option')
        .input('truckDetails', sql.VarChar, truckDetails)
        .input('allocationsJson', sql.NVarChar, option.allocationsJson || null)
        .input('totalTrucks', sql.Int, option.totalTrucks || 1)
        .input('totalPackages', sql.Int, option.totalPackages || 0)
        .input('totalCBM', sql.VarChar, totalCBM)
        .input('totalWeight', sql.VarChar, totalWeight)
        .input('ratePerTruck', sql.VarChar, ratePerTruckString)      // ✅ VARCHAR me change kiya
        .input('totalTruckRate', sql.Numeric(18, 2), totalTruckRate)
        .input('currency', sql.VarChar, option.currency || 'INR')
        .input('totalCostInUSD', sql.Numeric(18, 2), option.totalCostInUSD || 0)
        .input('exchangeRateUsed', sql.Numeric(18, 6), option.exchangeRate || 1)
        .input('exchangeRateDate', sql.Date, exchangeRateDate)
        .input('suggestedTruckIds', sql.VarChar, suggestedTruckIds)
        .input('userId', sql.Int, 3)
        .query(query);
        
    console.log(`📊 Inserted option: ${option.optionName}`);
    console.log(`   RatePerTruck: ${ratePerTruckString}`);
    console.log(`   TotalTruckRate: ${totalTruckRate} ${option.currency}`);
}
    
    // ✅ 4. Format truck details (UPDATED WITH USD)
   formatTruckDetails(allocations) {
    if (!allocations) return 'From API Response';
    
    return allocations.map(alloc => {
        const parts = [];
        if (alloc.qtyItems) parts.push(`${alloc.qtyItems}pkgs`);
        if (alloc.usedCBM) parts.push(`${alloc.usedCBM.toFixed(2)}CBM`);
        if (alloc.usedWeightKg) parts.push(`${alloc.usedWeightKg}kg`);
        
        // ✅ INR rate
        const inrRate = alloc.ratePerTruck || 0;
        // ✅ USD rate
        const usdRate = alloc.ratePerTruckInUSD || 0;
        
        // ✅ DONO RATES DIKHAO - INR + USD
       const rateInfo = `${inrRate} ($${usdRate.toFixed(2)})`;
        
        return `${alloc.truckName} ${rateInfo} (${parts.join('/')})`;
    }).join(', ');
}
    
    // ✅ 5. Extract truck IDs (same)
    extractTruckIds(allocations) {
        if (!allocations) return '';
        
        const ids = [];
        allocations.forEach(alloc => {
            const count = alloc.truckCount || 1;
            for (let i = 0; i < count; i++) {
                ids.push(alloc.truckId);
            }
        });
        
        return [...new Set(ids)].join(',');
    }
    
    // ✅ 6. Calculate total CBM (same)
    calculateTotalCBM(allocations) {
        if (!allocations) return '0 (0)';
        
        const total = allocations.reduce((sum, alloc) => sum + (alloc.usedCBM || 0), 0);
        const perTruck = allocations.length > 0 ? total / allocations.length : 0;
        
        return `${total.toFixed(2)} (${perTruck.toFixed(2)})`;
    }
    
    // ✅ 7. Calculate total weight (same)
    calculateTotalWeight(allocations) {
        if (!allocations) return '0 (0)';
        
        const total = allocations.reduce((sum, alloc) => sum + (alloc.usedWeightKg || 0), 0);
        const perTruck = allocations.length > 0 ? total / allocations.length : 0;
        
       return `${total.toFixed(2)} (${perTruck.toFixed(2)})`;
    }
    
    // ✅ 8. Update main table with truck IDs (same)
    async updateMainTable(recordId, allocations) {
        try {
            if (!recordId || !allocations || !Array.isArray(allocations)) {
                return;
            }
            
            let repeatedTruckIds = [];
            allocations.forEach(alloc => {
                for (let i = 0; i < (alloc.truckCount || 1); i++) {
                    repeatedTruckIds.push(alloc.truckId);
                }
            });
            
            const truckIds = repeatedTruckIds.join(',');
            
            const updateQuery = `
                UPDATE EnquiryGenerationNew 
                SET VehicleTypeMasterId = @truckIds,
                    SuggestOneVehicle = @suggestionsJson
                WHERE EnquiryGenerationNewId = @recordId
            `;
            
            await pool.request()
                .input('truckIds', sql.VarChar, truckIds)
                .input('suggestionsJson', sql.NVarChar, JSON.stringify(allocations))
                .input('recordId', sql.Int, recordId)
                .query(updateQuery);
            
           // console.log(`✅ Main table updated for record: ${recordId}`);
            
        } catch (error) {
            console.warn(`⚠️ Could not update main table for ${recordId}:`, error.message);
        }
    }
}

module.exports = new InsertService();