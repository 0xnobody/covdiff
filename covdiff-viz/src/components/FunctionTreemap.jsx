import React, { useState, useRef } from 'react';
import Treemap from './Treemap';
import FilterControls from './FilterControls';
import { useAppContext } from '../context/AppContext';
import { useDatabaseContext } from '../context/DatabaseContext';
import { useFilterContext } from '../context/FilterContext';
import { applyFilters } from '../utils/filterUtils';

const FunctionTreemap = () => {
  const { selectedModule, selectedFunction, setSelectedFunction, setSelectedBasicBlock } = useAppContext();
  const { coverageData } = useDatabaseContext();
  const { 
    functionStatusFilters, 
    setFunctionStatusFilters, 
    functionMinSize, 
    setFunctionMinSize 
  } = useFilterContext();
  
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const filterButtonRef = useRef(null);

  const handleSelect = (func) => {
    // Just pass the function directly - it has all the data we need
    setSelectedFunction(func);
    setSelectedBasicBlock(null);
  };

  const handleStatusChange = (status, checked) => {
    setFunctionStatusFilters({
      ...functionStatusFilters,
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

  const functions = selectedModule 
    ? coverageData.functions.filter(f => f.moduleId === selectedModule.id)
    : [];

  if (!selectedModule) {
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
        Select a module to view functions
      </div>
    );
  }

  const filteredFunctions = applyFilters(functions, functionStatusFilters, functionMinSize);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Treemap
        data={filteredFunctions}
        onSelect={handleSelect}
        selectedId={selectedFunction?.id}
        title="Functions"
        onFilterClick={() => setIsFilterOpen(!isFilterOpen)}
        showSizeLabels={false}
      />
      <FilterControls
        statusFilters={functionStatusFilters}
        onStatusChange={handleStatusChange}
        minSize={functionMinSize}
        onMinSizeChange={setFunctionMinSize}
        availableStatuses={['new', 'changed', 'old']}
        isOpen={isFilterOpen}
        onClose={() => setIsFilterOpen(false)}
        buttonRef={filterButtonRef}
      />
    </div>
  );
};

export default FunctionTreemap;
