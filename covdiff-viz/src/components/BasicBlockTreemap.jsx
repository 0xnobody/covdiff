import React, { useState, useRef } from 'react';
import Treemap from './Treemap';
import FilterControls from './FilterControls';
import { useAppContext } from '../context/AppContext';
import { useDatabaseContext } from '../context/DatabaseContext';
import { useFilterContext } from '../context/FilterContext';
import { applyFilters } from '../utils/filterUtils';

const BasicBlockTreemap = () => {
  const { selectedFunction, selectedBasicBlock, setSelectedBasicBlock } = useAppContext();
  const { rawCoverageData } = useDatabaseContext();
  const { 
    bbCategoryFilters, 
    setBbCategoryFilters, 
    bbMinSize, 
    setBbMinSize 
  } = useFilterContext();
  
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const filterButtonRef = useRef(null);

  const handleSelect = (bb) => {
    setSelectedBasicBlock(bb);
  };

  const handleCategoryChange = (category, checked) => {
    setBbCategoryFilters({
      ...bbCategoryFilters,
      [category]: checked
    });
  };

  if (!rawCoverageData) {
    return (
      <div style={{ 
        width: '100%', 
        height: '100%', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        color: '#64748b',
        fontSize: '14px'
      }}>
        No coverage data loaded
      </div>
    );
  }

  // Get basic blocks from the selected function's raw data
  const basicBlocks = selectedFunction?._rawData?.blocks || [];

  // Convert to treemap format with proper IDs and attach function data
  const basicBlocksWithFunctionData = basicBlocks.map((bb, index) => ({
    id: `bb_${selectedFunction.func_id}_${index}`,
    name: bb.bb_rva,
    size: bb.bb_size,
    status: bb.status,
    bb_rva: bb.bb_rva,
    bb_start_va: bb.bb_start_va,
    bb_end_va: bb.bb_end_va,
    is_frontier: bb.is_frontier,
    frontier_type: bb.frontier_type,
    frontier_attribution: bb.frontier_attribution,
    attribution: bb.attribution,
    _functionData: selectedFunction
  }));

  // Apply category-based filtering
  const filteredBasicBlocks = basicBlocksWithFunctionData.filter(bb => {
    // Check min size
    if (bb.size < bbMinSize) return false;
    
    // Determine category
    let category;
    if (bb.status === 'new' && bb.is_frontier) {
      category = 'frontier';
    } else if (bb.status === 'new') {
      category = 'new';
    } else {
      category = 'old';
    }
    
    // Check if category is enabled
    return bbCategoryFilters[category];
  });

  if (!selectedFunction) {
    return (
      <div style={{ 
        width: '100%', 
        height: '100%', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        color: '#6b7280',
        fontSize: '14px'
      }}>
        Select a function to view basic blocks
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Treemap
        data={filteredBasicBlocks}
        onSelect={handleSelect}
        selectedId={selectedBasicBlock?.id}
        title="Basic Blocks"
        onFilterClick={() => setIsFilterOpen(!isFilterOpen)}
        legendType="frontier"
        showSizeLabels={false}
      />
      <FilterControls
        statusFilters={bbCategoryFilters}
        onStatusChange={handleCategoryChange}
        minSize={bbMinSize}
        onMinSizeChange={setBbMinSize}
        availableStatuses={['new', 'frontier', 'old']}
        statusLabels={{ new: 'New', frontier: 'Frontier', old: 'Old' }}
        isOpen={isFilterOpen}
        onClose={() => setIsFilterOpen(false)}
        buttonRef={filterButtonRef}
      />
    </div>
  );
};

export default BasicBlockTreemap;
