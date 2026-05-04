// truckHelpers/truckOptionsGenerator.js - COMPLETELY DYNAMIC WITH 3D PACKING
const { tryAllocationStrategy } = require('./AllocationStrategy');
const { AppError, ErrorTypes } = require('../utils/errorHandler');

class TruckOptionsGenerator {
  constructor(vehicles, truckRatesMap) {
    this.vehicles = vehicles;
    this.truckRatesMap = truckRatesMap;
  }

  // ==================== MAIN METHOD ====================
  async generateOptions(items, currentAllocation) {
    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new AppError(
        ErrorTypes.VALIDATION.NO_PACKAGES,
        'Items array is required for generating options'
      );
    }

    if (!this.vehicles || !Array.isArray(this.vehicles) || this.vehicles.length === 0) {
      throw new AppError(
        ErrorTypes.VALIDATION.NO_VEHICLES,
        'No vehicles available for generating options'
      );
    }

    const options = [];
    const totalPackages = items.reduce((sum, item) => sum + item.qty, 0);

    // 1. SINGLE TRUCK TYPE OPTIONS
    const singleTruckOptions = await this.generateSingleTruckOptions3D(items, totalPackages);
    options.push(...singleTruckOptions);

    // 2. TWO-TRUCK COMBINATIONS (OPTIMIZED)
    const twoTruckOptions = await this.generateTwoTruckOptions3D(items, totalPackages);
    options.push(...twoTruckOptions);

    // 3. THREE-TRUCK COMBINATIONS (ONLY IF NEEDED)
    if (twoTruckOptions.length === 0) {
      const threeTruckOptions = await this.generateThreeTruckOptions3D(items, totalPackages);
      options.push(...threeTruckOptions);
    }

    // 4. CURRENT ALGORITHM RESULT
    if (currentAllocation && currentAllocation.allocations) {
      const currentOption = this.createOptionFromAllocation(
        currentAllocation,
        "",
        999
      );
      options.push(currentOption);
    }

    // 5. HIGH CAPACITY OPTIONS
    const capacityOptions = await this.generateCapacityOptions3D(items, totalPackages);
    options.push(...capacityOptions);

    // Final processing
    return this.finalizeOptions(options, totalPackages);
  }

  // ==================== SINGLE TRUCK OPTIONS ====================
  async generateSingleTruckOptions3D(items, totalPackages) {
    const options = [];

    const trucksWithRates = this.vehicles
      .filter(truck => this.truckRatesMap[truck.truckId]?.rate)
      .sort((a, b) => this.truckRatesMap[a.truckId].rate - this.truckRatesMap[b.truckId].rate);

    for (const truck of trucksWithRates.slice(0, 5)) { 
      const itemsCopy = JSON.parse(JSON.stringify(items));
      
      const result = await tryAllocationStrategy(
        `Single-${truck.truckName}`,
        [truck], 
        itemsCopy,
        this.truckRatesMap
      );

      if (result.allocations && result.allocations.length > 0) {
        const option = this.convertAllocationResultToOption(
          result,
          `${this.getTruckCountText(result.allocations)} × ${truck.truckName}`
        );
        options.push(option);
      }
    }

    return options;
  }

  // ==================== TWO-TRUCK COMBINATIONS (OPTIMIZED) ====================
 async generateTwoTruckOptions3D(items, totalPackages) {
  const options = [];
  
  const trucks = this.vehicles.filter(t => this.truckRatesMap[t.truckId]?.rate);
  
  for (let i = 0; i < trucks.length; i++) {
    for (let j = i; j < trucks.length; j++) {
      
      const truckList = [trucks[i], trucks[j]];
      
      const itemsCopy = JSON.parse(JSON.stringify(items));
      
      const result = await tryAllocationStrategy(
        `Mixed-${trucks[i].truckId}-${trucks[j].truckId}`,
        truckList,
        itemsCopy,
        this.truckRatesMap
      );
      
      if (result.totalAllocated === totalPackages) {
        const option = this.convertAllocationResultToOption(result, '');
        options.push(option);
        
        if (options.length >= 10) break;
      }
    }
    if (options.length >= 10) break;
  }
  
  return options;
}

  // ==================== THREE-TRUCK COMBINATIONS ====================
  async generateThreeTruckOptions3D(items, totalPackages) {
    const options = [];
    const MAX_COMBINATIONS = 10;
    
    const trucks = this.vehicles.filter(t => this.truckRatesMap[t.truckId]?.rate);
    let combinations = [];
    
    // Generate unique 3-truck combinations
    for (let i = 0; i < trucks.length; i++) {
      for (let j = i; j < trucks.length; j++) {
        for (let k = j; k < trucks.length; k++) {
          combinations.push([trucks[i], trucks[j], trucks[k]]);
          if (combinations.length >= MAX_COMBINATIONS) break;
        }
        if (combinations.length >= MAX_COMBINATIONS) break;
      }
      if (combinations.length >= MAX_COMBINATIONS) break;
    }
    
    for (const truckList of combinations) {
      const itemsCopy = JSON.parse(JSON.stringify(items));
      
      const result = await tryAllocationStrategy(
        `Mixed-${truckList[0].truckId}-${truckList[1].truckId}-${truckList[2].truckId}`,
        truckList,
        itemsCopy,
        this.truckRatesMap
      );
      
      if (result.totalAllocated === totalPackages) {
        const option = this.convertAllocationResultToOption(result, '');
        options.push(option);
      }
    }
    
    return options;
  }

  // ==================== CAPACITY BASED OPTIONS ====================
  async generateCapacityOptions3D(items, totalPackages) {
    const options = [];

    const trucksByCapacity = [...this.vehicles]
      .filter(truck => truck.cbmCapacity > 0 && this.truckRatesMap[truck.truckId]?.rate)
      .sort((a, b) => b.cbmCapacity - a.cbmCapacity)
      .slice(0, 2); // Top 2 largest trucks

    for (const truck of trucksByCapacity) {
      const itemsCopy = JSON.parse(JSON.stringify(items));

      const result = await tryAllocationStrategy(
        `Capacity-${truck.truckName}`,
        [truck],
        itemsCopy,
        this.truckRatesMap
      );

      if (result.totalAllocated === totalPackages) {
        const option = this.convertAllocationResultToOption(result, '');
        options.push(option);
      }
    }

    return options;
  }

  // ==================== CONVERT 3D RESULT TO OPTION ====================
 convertAllocationResultToOption(result, optionName) {
  const allocations = result.allocations.map(alloc => {
    return {
      truckId: alloc.truckId,
      truckName: alloc.truckName,
      truckCount: 1,
      qtyItems: alloc.items?.reduce((sum, it) => sum + (it.qty || 0), 0) || 0,
      usedCBM: alloc.usedCBM || 0,
      usedWeightKg: alloc.usedWeight || 0,
      ratePerTruck: this.truckRatesMap[alloc.truckId]?.rate || 0,
      ratePerTruckInUSD: this.truckRatesMap[alloc.truckId]?.rateInUSD || 0,
      currency: this.truckRatesMap[alloc.truckId]?.currency || 'INR',
      exchangeRate: this.truckRatesMap[alloc.truckId]?.exchangeRateToUSD || 1,
      totalForThisTruck: (this.truckRatesMap[alloc.truckId]?.rate || 0) * (alloc.truckCount || 1),
      totalForThisTruckInUSD: (this.truckRatesMap[alloc.truckId]?.rateInUSD || 0) * (alloc.truckCount || 1),
      rateDetails: {
        baseRate: this.truckRatesMap[alloc.truckId]?.baseRate,
        appreciationPercent: this.truckRatesMap[alloc.truckId]?.appreciationPercent,
        exchangeRateDate: this.truckRatesMap[alloc.truckId]?.exchangeRateDate
      },
      // ✅ YEH THREE PROPERTIES ADD KARO - ORIGINAL DATA
      truckObj: alloc.truckObj,
      space3D: alloc.space3D,
      items: alloc.items
    };
  });

  return {
    optionName,
    allocations,
    totalCost: allocations.reduce((sum, a) => sum + a.totalForThisTruck, 0),
    totalCostInUSD: allocations.reduce((sum, a) => sum + a.totalForThisTruckInUSD, 0),
    currency: allocations[0]?.currency || 'INR',
    exchangeRate: allocations[0]?.exchangeRate || 1,
    totalTrucks: allocations.length,
    totalPackages: result.totalAllocated || 0
  };
}

  // ==================== CREATE OPTION FROM ALLOCATION ====================
 createOptionFromAllocation(allocation, suffix, optionId) {
  const allocations = allocation.allocations.map(alloc => {
    const qtyItems = alloc.items?.reduce((sum, item) => sum + (item.qty || 0), 0) || 0;
    
    const totalWeight = alloc.usedWeight || 0;
    
    const truckRate = this.truckRatesMap[alloc.truckId] || {};
    
    const totalForThisTruck = (truckRate.rate || 0) * (alloc.truckCount || 1);
    
    return {
      truckId: alloc.truckId,
      truckName: alloc.truckName,
      truckCount: 1,
      qtyItems: qtyItems,
      usedCBM: alloc.usedCBM || 0,
      usedWeightKg: totalWeight,
      ratePerTruck: truckRate.rate || 0,
      ratePerTruckInUSD: truckRate.rateInUSD || 0,
      currency: truckRate.currency || 'INR',
      exchangeRate: truckRate.exchangeRateToUSD || 1,
      exchangeRateDisplay: `1 USD = ${(1 / (truckRate.exchangeRateToUSD || 1)).toFixed(2)} ${truckRate.currency || 'INR'}`,
      totalForThisTruck: totalForThisTruck,
      totalForThisTruckInUSD: (truckRate.rateInUSD || 0) * (alloc.truckCount || 1),
      rateDetails: {
        baseRate: truckRate.baseRate,
        appreciationPercent: truckRate.appreciationPercent,
        exchangeRateDate: truckRate.exchangeRateDate
      }
    };
  });

  const totalCost = allocations.reduce((sum, a) => sum + a.totalForThisTruck, 0);
  const totalCostInUSD = allocations.reduce((sum, a) => sum + a.totalForThisTruckInUSD, 0);
  const totalPackages = allocations.reduce((sum, a) => sum + a.qtyItems, 0);

  return {
    optionId,
    optionName: '',
    allocations,
    totalCost,
    totalCostInUSD,
    currency: allocations[0]?.currency || 'INR',
    exchangeRate: allocations[0]?.exchangeRate || 1,
    totalTrucks: allocations.length,
    totalPackages: totalPackages
  };
}

  // ==================== FINALIZE OPTIONS ====================
  finalizeOptions(options, totalPackages) {
    if (options.length === 0) return [];

    const perfectOptions = options.filter(opt => opt.totalPackages === totalPackages);
    if (perfectOptions.length === 0) return [];
    
    perfectOptions.sort((a, b) => a.totalCost - b.totalCost);

    for (const opt of perfectOptions) {
        const placementData = [];
        
       for (const alloc of opt.allocations) {
    const truckPlacement = {
        truckId: alloc.truckId,
        truckName: alloc.truckName,
        truckDimensions: {
            length: alloc.truckObj?.usableLengthFt || alloc.truckObj?.lengthFt || 0,
            width: alloc.truckObj?.usableWidthFt || alloc.truckObj?.widthFt || 0,
            height: alloc.truckObj?.usableHeightFt || alloc.truckObj?.heightFt || 0
        },
        usedCBM: alloc.usedCBM || 0,
        usedWeightKg: alloc.usedWeight || 0,
        packages: []
    };
    
    if (alloc.space3D && alloc.space3D.placedBoxes && alloc.space3D.placedBoxes.length > 0) {
        for (const box of alloc.space3D.placedBoxes) {
            truckPlacement.packages.push({
                pkgId: box.pkg?.pkgId,
                position: { x: box.x || 0, y: box.y || 0, z: box.z || 0 },
                dimensions: { 
                    length: box.length || box.pkg?.lengthFt || 0, 
                    width: box.width || box.pkg?.widthFt || 0, 
                    height: box.height || box.pkg?.heightFt || 0 
                },
                stackable: box.pkg?.stackable || false
            });
        }
    }
    
    placementData.push(truckPlacement);
}
        
        opt.allocationsJson = JSON.stringify(placementData);
    }
    
    // Rest of your existing code...
    perfectOptions.forEach((opt, index) => {
        const truckCounts = {};
        opt.allocations.forEach(alloc => {
            truckCounts[alloc.truckName] = (truckCounts[alloc.truckName] || 0) + 1;
        });
        const nameParts = Object.entries(truckCounts).map(([name, count]) => count === 1 ? name : `${count} × ${name}`);
        opt.optionName = nameParts.join(' + ') + (index === 0 ? ' - Best Fit' : ' - Most Economical');
    });
    
    const uniqueOptions = [];
    const seen = new Set();
    for (const opt of perfectOptions) {
        const key = opt.allocations.map(a => a.truckId).sort().join(',') + '-' + opt.totalCost;
        if (!seen.has(key)) {
            seen.add(key);
            uniqueOptions.push(opt);
        }
    }
    
    return uniqueOptions.slice(0, 5);
}

  // ==================== UTILITY FUNCTIONS ====================
  getTruckCountText(allocations) {
    return allocations.length === 1 ? '1' : allocations.length;
  }
}

module.exports = TruckOptionsGenerator;