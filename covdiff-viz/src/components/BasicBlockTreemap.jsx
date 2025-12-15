import React, { useState, useRef } from 'react';
import Treemap from './Treemap';
import FilterControls from './FilterControls';
import { useAppContext } from '../context/AppContext';
import { useDatabaseContext } from '../context/DatabaseContext';
import { useFilterContext } from '../context/FilterContext';
import { applyFilters } from '../utils/filterUtils';

const BasicBlockTreemap = () => {
  const { selectedFunction, selectedBasicBlock, setSelectedBasicBlock } = useAppContext();
  const { coverageData } = useDatabaseContext();
  const { 
    bbStatusFilters, 
    setBbStatusFilters, 
    bbMinSize, 
    setBbMinSize 
  } = useFilterContext();
  
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const filterButtonRef = useRef(null);

  const handleSelect = (bb) => {
    setSelectedBasicBlock(bb);
  };

  const handleStatusChange = (status, checked) => {
    setBbStatusFilters({
      ...bbStatusFilters,
      [status]: checked
    });
  };

  if (!coverageData) {
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

  const basicBlocks = selectedFunction 
    ? coverageData.basicBlocks.filter(bb => bb.functionId === selectedFunction.id)
    : [];

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

  const filteredBasicBlocks = applyFilters(basicBlocks, bbStatusFilters, bbMinSize);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Treemap
        data={filteredBasicBlocks}
        onSelect={handleSelect}
        selectedId={selectedBasicBlock?.id}
        title="Basic Blocks"
        onFilterClick={() => setIsFilterOpen(!isFilterOpen)}
        legendType="status"
      />
      <FilterControls
        statusFilters={bbStatusFilters}
        onStatusChange={handleStatusChange}
        minSize={bbMinSize}
        onMinSizeChange={setBbMinSize}
        availableStatuses={['new', 'in_both']}
        statusLabels={{ new: 'new', in_both: 'old' }}
        isOpen={isFilterOpen}
        onClose={() => setIsFilterOpen(false)}
        buttonRef={filterButtonRef}
      />
    </div>
  );
};

export default BasicBlockTreemap;
