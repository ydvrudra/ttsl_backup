// truckHelpers/AllocationStrategy.js - FINAL STABLE VERSION
const Simple3DSpace = require('./Simple3DSpace');

async function tryAllocationStrategy(strategyName, sortedVehicles, items, truckRatesMap) {
  
  const packageGroups = {};
  items.forEach(pkg => {
    const key = `${pkg.lengthFt}_${pkg.widthFt}_${pkg.heightFt}_${pkg.weightKg}_${pkg.stackable}`;
    if (!packageGroups[key]) {
      packageGroups[key] = { ...pkg, qty: 0, originalPkgIds: [] };
    }
    packageGroups[key].qty += pkg.qty;
    packageGroups[key].originalPkgIds.push(pkg.pkgId);
  });
  
  let remainingItems = Object.values(packageGroups);
  const allocations = [];
  
  // Sort packages
  remainingItems.sort((a, b) => {
    const aMaxDim = Math.max(a.lengthFt, a.widthFt, a.heightFt);
    const bMaxDim = Math.max(b.lengthFt, b.widthFt, b.heightFt);
    if (bMaxDim !== aMaxDim) return bMaxDim - aMaxDim;
    if (a.stackable !== b.stackable) return a.stackable ? 1 : -1;
    return (b.lengthFt * b.widthFt * b.heightFt) - (a.lengthFt * a.widthFt * a.heightFt);
  });
  
  // Main allocation logic
  for (const currentItem of remainingItems) {
    let remainingQty = currentItem.qty;
    
    // Try existing trucks first
    for (const alloc of allocations) {
      if (remainingQty <= 0) break;
      
      const canSingleUnitFit = (pkg, truck) => {
        return (pkg.lengthFt <= truck.usableLengthFt && pkg.widthFt <= truck.usableWidthFt && pkg.heightFt <= truck.usableHeightFt) ||
               (pkg.widthFt <= truck.usableLengthFt && pkg.lengthFt <= truck.usableWidthFt && pkg.heightFt <= truck.usableHeightFt);
      };
      
      if (!canSingleUnitFit(currentItem, alloc.truckObj)) continue;
      
      const tempSpace = new Simple3DSpace(alloc.truckObj);
      tempSpace.placedBoxes = [...alloc.space3D.placedBoxes];
      tempSpace.totalCBM = alloc.space3D.totalCBM;
      tempSpace.totalWeight = alloc.space3D.totalWeight;
      tempSpace.itemsList = [...alloc.space3D.itemsList];
      
      const canFit = tempSpace.calculateMaxFit(currentItem, remainingQty);
      if (canFit > 0) {
        const toPlace = Math.min(canFit, remainingQty);
        let placed = 0;
        for (let i = 0; i < toPlace; i++) {
          const position = tempSpace.findBestPosition(currentItem);
          if (!position) break;
          if (tempSpace.totalCBM + currentItem.cbm > alloc.truckObj.cbmCapacity) break;
          if (tempSpace.totalWeight + currentItem.weightKg > alloc.truckObj.maxWeightKg) break;
          
          tempSpace.placeBox(currentItem, position.x, position.y, position.z,
                           position.length, position.width, position.height);
          placed++;
        }
        remainingQty -= placed;
        
        alloc.space3D = tempSpace;
        alloc.usedCBM = tempSpace.getUsedCBM();
        alloc.usedWeight = tempSpace.getUsedWeight();
        const existingItem = alloc.items.find(it => it.pkgId === currentItem.pkgId);
        if (existingItem) {
          existingItem.qty += placed;
        } else if (placed > 0) {
          alloc.items.push({ ...currentItem, qty: placed });
        }
      }
    }
    
    // Create new trucks for remaining
    while (remainingQty > 0) {
      let bestTruck = null;
      let maxFit = 0;
      let bestTruckRate = Infinity;

      //console.log(`\n🔍 Finding truck for remaining ${remainingQty} packages of size ${currentItem.lengthFt}x${currentItem.widthFt}x${currentItem.heightFt}`); 

      
      // FIRST PRIORITY: Find truck that can fit MAXIMUM packages
      for (let i = 0; i < sortedVehicles.length; i++) {
    const truck = sortedVehicles[i];
    
    const canSingleUnitFit = (pkg, truck) => {
      return (pkg.lengthFt <= truck.usableLengthFt && pkg.widthFt <= truck.usableWidthFt && pkg.heightFt <= truck.usableHeightFt) ||
             (pkg.widthFt <= truck.usableLengthFt && pkg.lengthFt <= truck.usableWidthFt && pkg.heightFt <= truck.usableHeightFt);
    };
        
        if (!canSingleUnitFit(currentItem, truck)) continue;
        
        const tempSpace = new Simple3DSpace(truck);
        const fit = tempSpace.calculateMaxFit(currentItem, remainingQty);

       //  console.log(`   ${truck.truckName} - can fit ${fit} packages, rate: ${truckRatesMap[truck.truckId]?.rate || 'N/A'}`); 
        
            if (fit > maxFit) {
          maxFit = fit;
          bestTruck = truck;
          bestTruckRate = truckRatesMap[truck.truckId]?.rate || 999999;
        } else if (fit === maxFit && fit > 0) {
          const currentRate = truckRatesMap[truck.truckId]?.rate || 999999;
          if (currentRate < bestTruckRate) {
            bestTruck = truck;
            bestTruckRate = currentRate;
          }
        }
      }
          
      if (!bestTruck) break;
      
      const newAlloc = {
        truckId: bestTruck.truckId,
        truckName: bestTruck.truckName,
        truckObj: bestTruck,
        usedCBM: 0,
        usedWeight: 0,
        items: [],
        space3D: new Simple3DSpace(bestTruck)
      };
      
      const toPlace = Math.min(maxFit, remainingQty);
      let placed = 0;
      for (let i = 0; i < toPlace; i++) {
        const position = newAlloc.space3D.findBestPosition(currentItem);
        if (!position) break;
        if (newAlloc.space3D.totalCBM + currentItem.cbm > bestTruck.cbmCapacity) break;
        if (newAlloc.space3D.totalWeight + currentItem.weightKg > bestTruck.maxWeightKg) break;
        
        newAlloc.space3D.placeBox(currentItem, position.x, position.y, position.z,
                                 position.length, position.width, position.height);
        placed++;
      }
      
      newAlloc.usedCBM = newAlloc.space3D.getUsedCBM();
      newAlloc.usedWeight = newAlloc.space3D.getUsedWeight();
      newAlloc.items.push({ ...currentItem, qty: placed });
      
      allocations.push(newAlloc);
      remainingQty -= placed;
    }
    
    currentItem.qty = remainingQty;
  }
  
  const totalAllocated = allocations.reduce((total, alloc) => {
    return total + alloc.items.reduce((sum, item) => sum + (item.qty || 0), 0);
  }, 0);
  
  const totalRequired = items.reduce((total, item) => total + (item.qty || 0), 0);
  
  const totalCost = allocations.reduce((sum, alloc) => {
    return sum + (truckRatesMap[alloc.truckId]?.rate || 0);
  }, 0);
  
  // ========== 🔍 DEBUG CONSOLE - YAHAN SE ==========
  console.log('\n========== ALLOCATION STRATEGY DEBUG ==========');
  console.log('Strategy:', strategyName);
  console.log('Total allocations:', allocations.length);
  
  if (allocations.length > 0) {
    console.log('First allocation truck:', allocations[0].truckName);
    console.log('First allocation has space3D?', allocations[0].space3D ? 'YES' : 'NO');
    
    if (allocations[0].space3D) {
      console.log('First allocation placedBoxes count:', allocations[0].space3D.placedBoxes?.length || 0);
      console.log('First allocation placedBoxes sample:', JSON.stringify(allocations[0].space3D.placedBoxes?.[0] || 'empty'));
    } else {
      console.log('❌ ERROR: space3D is MISSING for first allocation!');
    }
  }
  console.log('=============================================\n');
  //
  
  return {
    strategyName,
    allocations,
    remainingItems: remainingItems.filter(item => item.qty > 0),
    totalAllocated,
    totalRequired,
    totalCost,
    successRate: (totalAllocated / totalRequired) * 100
  };
}


module.exports = { tryAllocationStrategy };