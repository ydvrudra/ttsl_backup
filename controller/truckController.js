// controllers/truckController.js
const {pool, poolConnect } = require('../config/sqlConfig');
const { loadHeaderAndPackages, loadVehiclesAndCapacities } = require('../truckHelpers/loadData');
const { allocateTrucksAndPrice } = require('../truckHelpers/truckAllocation');
const InsertService = require('../truckHelpers/insertTrcukData');
const { AppError, ErrorTypes, sendErrorResponse } = require('../utils/errorHandler');

async function suggestTruckForEnquiry(req, res) {
    
    // ✅ 1. SET TIMEOUT
    res.setTimeout(120000, () => {
        console.log('⚠️ Request timeout after 120 seconds');
        const timeoutError = new AppError(
            ErrorTypes.API.TIMEOUT,
            'Request took more than 120 seconds'
        );
        return sendErrorResponse(res, timeoutError);
    });

    try {
        // ✅ 2. CONNECT TO DATABASE
        await poolConnect;
        const client = pool;
        
        // ✅ 3. GET REQUEST DATA
        const { 
            recordId, 
            packages: bodyPackages = [], 
            userId = 0, 
            persist = false,
            calculationUnitId,
            fromLocationId,
            toLocationId,
            companyId,
            segmentId
        } = req.body || {};

        // ✅ 4. VALIDATE INPUT
        if (!bodyPackages.length && !recordId) {
            throw new AppError(
                ErrorTypes.VALIDATION.NO_PACKAGES,
                'Neither packages array nor recordId provided'
            );
        }

        // ✅ 5. LOAD HEADER AND PACKAGES
        const { hdr, pkgs } = await loadHeaderAndPackages(client, recordId, bodyPackages, calculationUnitId);

        if (!pkgs.length) {
            throw new AppError(
                ErrorTypes.VALIDATION.NO_PACKAGES,
                `No packages found for recordId: ${recordId}`
            );
        }
        
        // ✅ 6. LOAD VEHICLES
        const vehicles = await loadVehiclesAndCapacities(client);

        if (!vehicles.length) {
            throw new AppError(
                ErrorTypes.VALIDATION.NO_VEHICLES,
                'No truck types found in database'
            );
        }
        
        // ✅ 7. ALLOCATE TRUCKS
        const result = await allocateTrucksAndPrice({
            client,
            hdr,
            pkgs,
            vehicles,
            persist,
            recordId,
            userId,
            fromLocationId,
            toLocationId,
            companyId,
            segmentId
        });

        // ✅ 8. CHECK ALLOCATION RESULT
        if (result.status === 'validation-failed' || result.status === 'no-packages') {
          
            throw new AppError(
                ErrorTypes.VALIDATION.INVALID_INPUT,
                JSON.stringify(result.oversizedPackages || result.message)
            );
        }

        if (result.status !== 'success' && result.status !== 'partial_allocated') {
            throw new AppError(
                ErrorTypes.API.ALLOCATION_FAILED,
                `Allocation status: ${result.status}`
            );
        }

        // ✅ 9. UPDATE DATABASE (if recordId exists)
        if (recordId) {
            try {
                // Update main table with truck IDs
                if (result.allocations) {
                    await InsertService.updateMainTable(recordId, result.allocations);
                }
                
                // Insert options to quotation table
                if (result.status === 'success' || result.status === 'partial_allocated') {
                    console.log(`📝 Calling insertResponseToTable for record: ${recordId}`);
                    await InsertService.insertResponseToTable(recordId, result);
                }
                
            } catch (dbError) {
                // Database errors shouldn't fail the whole request
                console.warn(`⚠️ Database operations partially failed for ${recordId}:`, dbError.message);
                // Continue to return successful allocation response
            }
        }

        // ✅ 10. RETURN SUCCESS RESPONSE
        console.log(`✅ Request completed for record: ${recordId || 'new'}`);
        return res.status(200).json({
            ...result,
            _meta: {
                processedAt: new Date().toISOString(),
                packageCount: pkgs.length,
                vehicleCount: vehicles.length
            }
        });

    } catch (error) {
        // ✅ 11. ERROR HANDLING
        console.error(' Error in suggestTruckForEnquiry:', error);
        
        // If it's already an AppError, send it
        if (error instanceof AppError) {
            return sendErrorResponse(res, error);
        }
        
        // Convert unknown errors to AppError
        const appError = new AppError(
            ErrorTypes.SYSTEM.UNKNOWN_ERROR,
            `Controller error: ${error.message}`
        );
        
        return sendErrorResponse(res, appError);
    }
}

module.exports = { suggestTruckForEnquiry };