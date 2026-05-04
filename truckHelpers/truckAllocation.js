// truckHelpers/truckAllocation.js
const { processFinalAllocations } = require('./truckAllocationHelpers');
const Simple3DSpace = require('./Simple3DSpace');
const { tryAllocationStrategy } = require('./AllocationStrategy');
const TruckOptionsGenerator = require('./truckOptionsGenerator');
const { AppError, ErrorTypes } = require('../utils/errorHandler'); 


async function allocateTrucksAndPrice({
  client,
  pkgs,
  vehicles,
  fromLocationId = null,    
  toLocationId = null,      
  companyId = null,        
  segmentId = null
}) {
    try {
      if (!pkgs || !pkgs.length) {
        throw new AppError(
          ErrorTypes.VALIDATION.NO_PACKAGES,
          'allocateTrucksAndPrice called with empty packages'
        );
      }

      if (!vehicles || !vehicles.length) {
        throw new AppError(
          ErrorTypes.VALIDATION.NO_VEHICLES,
          'allocateTrucksAndPrice called with empty vehicles'
        );
      }

  let oversizedPackages = [];
  let overweightPackages = [];
  let validPackages = [];

  // Prepare trucks
  vehicles = (vehicles || []).map(v => {
    const copy = { ...v };
    copy.usableLengthFt = Number(copy.usableLengthFt || copy.length || 0);
    copy.usableWidthFt = Number(copy.usableWidthFt || copy.width || 0);
    copy.usableHeightFt = Number(copy.usableHeightFt || copy.height || 0);
    copy.maxWeightKg = Number(copy.maxWeightKg || copy.capacityInKgs || 0);
    copy.cbmCapacity = copy.cbmCapacity && copy.cbmCapacity > 0
      ? Number(copy.cbmCapacity)
      : (copy.usableLengthFt && copy.usableWidthFt && copy.usableHeightFt ? Simple3DSpace.feet3ToCBM(copy.usableLengthFt, copy.usableWidthFt, copy.usableHeightFt) : 0);
    return copy;
  });

// Fetch actual rates
let truckRatesMap = {};
if (fromLocationId && toLocationId && companyId && segmentId) {
  //console.log("\n FETCHING ACTUAL RATES FROM DATABASE...");
  try {
    const TruckRateCalculator = require('./truckRateCalculator');
    const rateCalculator = new TruckRateCalculator(client);
    const truckIds = vehicles.map(v => v.truckId);
    const rates = await rateCalculator.getRatesForTrucks(
      truckIds, fromLocationId, toLocationId, companyId, segmentId
    );
    
    if (rates && rates.length > 0) {
      rates.forEach(rate => {
        // ✅ FIX 1: SIRF RATE > 0 WALI TRUCKS ADD KARO
        if (rate.rateWithAppreciation > 0) {
          truckRatesMap[rate.truckId] = {
            // Rates
            rate: rate.rateWithAppreciation,
            rateInUSD: rate.rateInUSD,
            baseRate: rate.baseRate,
            appreciationPercent: rate.appreciationPercent,
            
            // Currency info
            currency: rate.currencyCode || 'INR',
            currencyCode: rate.currencyCode,
            currencyId: rate.currencyId,
            isUSD: rate.isUSD,
            
            // Exchange rate info
            exchangeRateToUSD: rate.exchangeRateToUSD,
            exchangeRateUsdToCurrency: rate.exchangeRateUsdToCurrency,
            exchangeRateDate: rate.exchangeRateDate,
            
            // Truck info
            truckName: rate.truckName,
            truckId: rate.truckId,
            
            // Extra
            ratePerCbm: rate.ratePerCbm,
            ratePerCbmInUSD: rate.ratePerCbmInUSD
          };
          
          // Vehicle object mein update karo
          const vehicle = vehicles.find(v => v.truckId === rate.truckId);
          if (vehicle) {
            vehicle.rate = rate.rateWithAppreciation;
            vehicle.rateInUSD = rate.rateInUSD;
            vehicle.exchangeRateToUSD = rate.exchangeRateToUSD;
            vehicle.currencyCode = rate.currencyCode;
            vehicle.hasRate = true;
          }
        } else {
          console.log(`⚠️ Skipping truck ${rate.truckId} because rate is ${rate.rateWithAppreciation}`);
        }
      });
    }
  } catch (error) {
    console.error("❌ ERROR FETCHING RATES:", error);
  }
}

// ✅ FIX 2: SIRF UNHI VEHICLES RAKHO JINKA RATE > 0 HAI
const validVehicles = vehicles.filter(v => v.hasRate === true);
if (validVehicles.length === 0) {
  throw new AppError(
    ErrorTypes.VALIDATION.NO_VEHICLES,
    'No trucks with valid rates (>0) found for this route'
  );
}
vehicles = validVehicles;

  // Validate packages
  const maxTruckLength = Math.max(...vehicles.map(v => v.usableLengthFt));

  for (const pkg of pkgs) {
    const lengthFt = Number(pkg.lengthFt || pkg.length || 0);
    const widthFt = Number(pkg.widthFt || pkg.width || 0);
    const heightFt = Number(pkg.heightFt || pkg.height || 0);
    const weightKg = Number(pkg.weightKg || pkg.weight || 0);

    let isValid = true;
    const maxDimension = Math.max(lengthFt, widthFt, heightFt);
    const minDimension = Math.min(lengthFt, widthFt, heightFt);
    
    if (maxDimension > maxTruckLength || minDimension <= 0) {
      oversizedPackages.push({
        pkgId: pkg.pkgId,
        dimensions: `${lengthFt}x${widthFt}x${heightFt}ft`,
        issue: maxDimension > maxTruckLength ? 
               `Package too large (${maxDimension}ft > max truck ${maxTruckLength}ft)` :
               `Invalid dimensions`
      });
      isValid = false;

       // ✅ THROW ERROR IMMEDIATELY IF ANY PACKAGE IS OVERSIZED
  if (maxDimension > maxTruckLength) {
    throw new AppError(
      ErrorTypes.PACKAGE_VALIDATION.OVERSIZED_PACKAGE,
      `Package ${pkg.pkgId}: ${maxDimension}ft > max truck ${maxTruckLength}ft`
    );
  }

   if (minDimension <= 0) {
    throw new AppError(
      ErrorTypes.PACKAGE_VALIDATION.INVALID_DIMENSIONS,
      `Package ${pkg.pkgId}: has zero/negative dimension`
    );
  }
    }

    if (isValid) {
      validPackages.push(pkg);
    }
  }

  if (validPackages.length === 0) {
    return {
      status: "validation-failed",
      message: "No packages can be allocated",
      oversizedPackages,
      overweightPackages,
      allocations: []
    };
  }

  // Prepare items
  let items = validPackages.map(p => {
    const lengthFt = Number(p.lengthFt || p.length || 0);
    const widthFt = Number(p.widthFt || p.width || 0);
    const heightFt = Number(p.heightFt || p.height || 0);
    const cbmVal = (p.cbm && p.cbm > 0) ? Number(p.cbm) : Simple3DSpace.feet3ToCBM(lengthFt, widthFt, heightFt);
    return {
      pkgId: p.pkgId,
      lengthFt,
      widthFt,
      heightFt,
      weightKg: Number(p.weightKg || p.weight || 0) / Math.max(1, Number(p.qty || 1)),
      stackable: p.stackable !== false,
      cbm: cbmVal,
      qty: Number(p.qty || 1),
      originalWeight: Number(p.weightKg || p.weight || 0)
    };
  });

  //console.log("\n=== Packages to Allocate ===");
  items.forEach(it => {
   // console.log(`Pkg: ${it.pkgId}, Size: ${it.lengthFt}x${it.widthFt}x${it.heightFt}ft, CBM: ${it.cbm}, Weight: ${it.weightKg}kg, Qty: ${it.qty}, Stackable: ${it.stackable}`);
  });

  // Generate dynamic strategies
  const strategies = generateDynamicStrategies(vehicles, truckRatesMap);
  const allStrategyResults = [];
  
  for (const strategy of strategies) {
    const result = await tryAllocationStrategy(strategy.name, strategy.sortedVehicles, items, truckRatesMap);
    allStrategyResults.push(result);
  }
  
  // Choose best result
  const bestResult = selectBestResult(allStrategyResults);
  
  // Smart single truck check
  const totalPackages = items.reduce((total, item) => total + (item.qty || 0), 0);
  const totalRequiredCBM = items.reduce((sum, item) => sum + (item.cbm * item.qty), 0);
  const totalRequiredWeight = items.reduce((sum, item) => sum + (item.weightKg * item.qty), 0);
  
  //console.log(`\n🔍 CHECKING SINGLE TRUCK OPTIONS`);
  //console.log(`Total: ${totalPackages} packages, ${totalRequiredCBM.toFixed(2)} CBM, ${totalRequiredWeight.toFixed(0)} kg`);
  
  let foundBetterOption = false;
  const trucksByRate = [...vehicles].sort((a, b) => {
    const rateA = truckRatesMap[a.truckId]?.rate || 999999;
    const rateB = truckRatesMap[b.truckId]?.rate || 999999;
    return rateA - rateB;
  });
  
  for (const truck of trucksByRate) {
    const truckRate = truckRatesMap[truck.truckId]?.rate || 999999;
    
    if (truckRate >= bestResult.totalCost) continue;
    
    // Check capacity
    if (totalRequiredCBM > truck.cbmCapacity || totalRequiredWeight > truck.maxWeightKg) continue;
    
    // 3D packing check
    const tempSpace = new Simple3DSpace(truck);
    let allFit = true;
    let fittedCount = 0;
    
    for (const item of items) {
      const testItem = { ...item };
      const maxFit = tempSpace.calculateMaxFit(testItem, item.qty);
      
      if (maxFit >= item.qty) {
        for (let i = 0; i < item.qty; i++) {
          const position = tempSpace.findBestPosition(testItem);
          if (position) {
            tempSpace.placeBox(testItem, position.x, position.y, position.z,
                             position.length, position.width, position.height);
            fittedCount++;
          } else {
            allFit = false;
            break;
          }
        }
      } else {
        allFit = false;
      }
      
      if (!allFit) break;
    }
    
    if (allFit && fittedCount === totalPackages) {
    //  console.log(`   🎉 CHEAPER FOUND: ${truck.truckName} - ${truckRatesMap[truck.truckId]?.currency || 'INR'} ${truckRate}`);
      
      bestResult.strategyName = `Single-${truck.truckName}`;
      bestResult.allocations = [{
        truckId: truck.truckId,
        truckName: truck.truckName,
        truckObj: truck,
        usedCBM: tempSpace.getUsedCBM(),
        usedWeight: tempSpace.getUsedWeight(),
        items: items.map(it => ({ ...it })),
        space3D: tempSpace
      }];
      bestResult.totalCost = truckRate;
      bestResult.successRate = 100;
      
      foundBetterOption = true;
      break;
    }
  }
  
  if (!foundBetterOption) {
   // console.log(`\n❌ No better single truck option found`);
  }
    
  // Final processing
  const allocations = bestResult.allocations;
  const remainingItems = bestResult.remainingItems;
  
  const validAllocations = allocations.filter(alloc => alloc.items.length > 0);
  
  if (remainingItems.length > 0) {
   // console.log(`\n❌ PARTIAL ALLOCATION: ${remainingItems.length} items remaining`);
    
    const { allocationsStatus } = await processFinalAllocations({
      allocationsInstances: validAllocations,
      remainingPkgs: remainingItems,
      client,
      vehicles,
      truckRatesMap
    });

    if (allocationsStatus) {
      return allocationsStatus;
    }
  }
  
  // // Display final allocation
  // validAllocations.forEach(alloc => {
  //   console.log(`\n🚛 ${alloc.truckName}:`);
  //   console.log(`   📦 ${alloc.items.map(it => `${it.pkgId}×${it.qty}`).join(', ')}`);
  //   console.log(`   📊 ${alloc.usedCBM.toFixed(3)}CBM / ${alloc.truckObj.cbmCapacity}CBM`);
  //   console.log(`   ⚖️  ${alloc.usedWeight.toFixed(1)}kg / ${alloc.truckObj.maxWeightKg}kg`);
  // });

  const currentResult = await processFinalAllocations({
    allocationsInstances: validAllocations,
    remainingPkgs: [],
    client,
    vehicles,
    truckRatesMap
  });

  // Line ~280 ke bad ka code update karo:
const optionsGenerator = new TruckOptionsGenerator(vehicles, truckRatesMap);
const generatedOptions = await optionsGenerator.generateOptions(
  items,
  bestResult   
);

// ✅ SIMPLIFY: generatedOptions already array hai
const finalOptions = Array.isArray(generatedOptions) ? generatedOptions : [];

// ✅ STEP: Har option me USD rates add karo
for (const option of finalOptions) {
  // Pehle option ki currency aur exchange rate nikalo
  let optionExchangeRate = 1;
  let optionCurrency = 'INR';
  
  // Allocation se currency info lelo
  if (option.allocations && option.allocations.length > 0) {
    const firstAlloc = option.allocations[0];
    const truckRate = truckRatesMap[firstAlloc.truckId];

    if (truckRate) {
       console.log(`\n🔧 Truck Rate for ${firstAlloc.truckId}:`, {
      exchangeRateToUSD: truckRate.exchangeRateToUSD,
      currencyCode: truckRate.currencyCode,
      rateInUSD: truckRate.rateInUSD
    });
      optionExchangeRate = truckRate.exchangeRateToUSD || 1;
      optionCurrency = truckRate.currencyCode || 'INR';
    }
  }
  
  // ✅ Option level pe USD totals add karo
  option.exchangeRate = optionExchangeRate;
 option.totalCostInUSD = option.totalCost * optionExchangeRate;
  option.currency = optionCurrency;
  
  // ✅ Har allocation me USD rates add karo
  for (const alloc of option.allocations) {
    const truckRate = truckRatesMap[alloc.truckId];
    
    alloc.exchangeRate = optionExchangeRate;
    alloc.ratePerTruckInUSD = alloc.ratePerTruck * optionExchangeRate; 
    alloc.totalForThisTruckInUSD = alloc.totalForThisTruck * optionExchangeRate; 
    alloc.exchangeRateDisplay = `1 USD = ${(1/optionExchangeRate).toFixed(2)} ${optionCurrency}`;
    
    // TruckRateCalculator se extra info add karo
    if (truckRate) {
      alloc.rateDetails = {
        baseRate: truckRate.baseRate,
        appreciationPercent: truckRate.appreciationPercent,
        exchangeRateDate: truckRate.exchangeRateDate
      };
    }
  }
}

// ✅ GET FIRST OPTION FOR BACKWARD COMPATIBILITY
const firstOption = finalOptions.length > 0 ? finalOptions[0] : null;


// ✅ FORMAT ALLOCATIONS FOR SQL PROCEDURE (UPDATED)
function formatAllocationsForProcedure(option) {
  if (!option || !option.allocations) return [];
  
  return option.allocations.map(alloc => ({
    truckId: alloc.truckId,
    truckName: alloc.truckName,
    truckCount: alloc.truckCount || 1,
    qtyItems: alloc.qtyItems || 0,
    usedCBM: alloc.usedCBM || 0,
    usedWeightKg: alloc.usedWeightKg || 0,
    // ✅ USD FIELDS ADD KIYE
    ratePerTruck: alloc.ratePerTruck || 0,
    ratePerTruckInUSD: alloc.ratePerTruckInUSD || 0,
    currency: alloc.currency || 'INR',
    exchangeRate: alloc.exchangeRate || 1,
    totalForThisTruck: alloc.totalForThisTruck || 0,
    totalForThisTruckInUSD: alloc.totalForThisTruckInUSD || 0
  }));
}

// Overall totals ke liye
const overallExchangeRate = finalOptions.length > 0 ? finalOptions[0].exchangeRate : 1;
const overallCurrency = finalOptions.length > 0 ? finalOptions[0].currency : 'INR';
const overallTotalCost = finalOptions.length > 0 ? finalOptions.reduce((sum, opt) => sum + opt.totalCost, 0) : 0;
const overallTotalCostInUSD = finalOptions.reduce((sum, opt) => sum + opt.totalCostInUSD, 0);

// ✅ RETURN DUAL FORMAT - BOTH NEW AND OLD
return {
  // ✅ NEW FORMAT (for frontend - multiple options with USD)
  status: "success",
  message: finalOptions.length > 1 
    ? "Multiple allocation options available" 
    : finalOptions.length === 1 
      ? "Single allocation option available" 
      : "No allocation options available",
  options: finalOptions,
  defaultOptionId: finalOptions.length > 0 ? finalOptions[0].optionId : 1,
  recommendation: {
    optionId: finalOptions.length > 0 ? finalOptions[0].optionId : 1,
    reason: finalOptions.length > 1 
      ? "Lowest total cost" 
      : finalOptions.length === 1 
        ? "Only option available" 
        : "No options available",
    // ✅ USD INFO IN RECOMMENDATION
    totalCostInUSD: finalOptions.length > 0 ? finalOptions[0].totalCostInUSD : 0,
    exchangeRate: overallExchangeRate
  },
  
  // ✅ OLD FORMAT (for SQL procedure - MUST HAVE!)
  allocations: formatAllocationsForProcedure(firstOption),
  
  // ✅ OVERALL TOTALS WITH USD
  totalCost: overallTotalCost,
  totalCostInUSD: overallTotalCostInUSD,
  currency: overallCurrency,
  exchangeRate: overallExchangeRate,
  
  // ✅ META INFO WITH EXCHANGE RATE DATE
  _meta: {
    processedAt: new Date().toISOString(),
    packageCount: pkgs.length,
    vehicleCount: vehicles.length,
    exchangeRateDate: new Date().toISOString().split('T')[0],
    exchangeRateSource: 'ExchangeRatesDetails'
  }
};

}

catch (error) {
    // If already AppError, re-throw it
    if (error instanceof AppError) {
      throw error;
    }

 console.error('🔴 Error in allocateTrucksAndPrice:', error);

  throw new AppError(
      ErrorTypes.API.ALLOCATION_FAILED,
      `Truck allocation failed: ${error.message}`
    );
  }
}

// Helper functions
function generateDynamicStrategies(vehicles, truckRatesMap) {
  const strategies = [];
  
  // ✅ 1. CHEAPEST-RATE-FIRST - PEHLE YEH
  if (Object.keys(truckRatesMap).length > 0) {
    strategies.push({
      name: "Cheapest-Rate-First",
      sortedVehicles: [...vehicles].sort((a, b) => {
        const rateA = truckRatesMap[a.truckId]?.rate || 999999;
        const rateB = truckRatesMap[b.truckId]?.rate || 999999;
        return rateA - rateB;
      })
    });
  }
  
  // ✅ 2. BEST-VALUE-FIRST - PHIR YEH
  if (Object.keys(truckRatesMap).length > 0) {
    strategies.push({
      name: "Best-Value-First",
      sortedVehicles: [...vehicles].sort((a, b) => {
        const rateA = truckRatesMap[a.truckId]?.rate || 999999;
        const rateB = truckRatesMap[b.truckId]?.rate || 999999;
        const valueA = rateA / (a.cbmCapacity || 1);
        const valueB = rateB / (b.cbmCapacity || 1);
        return valueA - valueB;
      })
    });
  }
  
  // ✅ 3. SMALLEST-CAPACITY-FIRST
  strategies.push({
    name: "Smallest-Capacity-First",
    sortedVehicles: [...vehicles].sort((a, b) => a.cbmCapacity - b.cbmCapacity)
  });
  
  // ✅ 4. LARGEST-CAPACITY-FIRST
  strategies.push({
    name: "Largest-Capacity-First", 
    sortedVehicles: [...vehicles].sort((a, b) => b.cbmCapacity - a.cbmCapacity)
  });
  
  return strategies;
}

function selectBestResult(allStrategyResults) {
  // Perfect allocations
  const perfectResults = allStrategyResults.filter(r => r.totalAllocated === r.totalRequired);
  
  if (perfectResults.length > 0) {
    perfectResults.sort((a, b) => a.totalCost - b.totalCost);
   // console.log(`\n✅ Found ${perfectResults.length} PERFECT allocations`);
    //console.log(`🏆 WINNER: ${perfectResults[0].strategyName} (${perfectResults[0].totalCost})`);
    return perfectResults[0];
  }
  
  // Partial allocations
  allStrategyResults.sort((a, b) => {
    if (b.totalAllocated !== a.totalAllocated) {
      return b.totalAllocated - a.totalAllocated;
    }
    return a.totalCost - b.totalCost;
  });
  
 // console.log(`\n⚠️ No perfect allocation, using BEST PARTIAL`);
  //console.log(`🏆 WINNER: ${allStrategyResults[0].strategyName}`);
 // console.log(`   Items: ${allStrategyResults[0].totalAllocated}/${allStrategyResults[0].totalRequired}`);
 // console.log(`   Cost: ${allStrategyResults[0].totalCost}`);
  
  return allStrategyResults[0];
}

module.exports = { allocateTrucksAndPrice };