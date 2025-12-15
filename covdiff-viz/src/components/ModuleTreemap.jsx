import React, { useState, useRef } from 'react';
import Treemap from './Treemap';
import FilterControls from './FilterControls';
import { useAppContext } from '../context/AppContext';
import { useDatabaseContext } from '../context/DatabaseContext';
import { useFilterContext } from '../context/FilterContext';
import { applyFilters } from '../utils/filterUtils';

const ModuleTreemap = () => {
  const { selectedModule, setSelectedModule, setSelectedFunction, setSelectedBasicBlock } = useAppContext();
  const { coverageData } = useDatabaseContext();
  const { 
    moduleStatusFilters, 
    setModuleStatusFilters, 
    moduleMinSize, 
    setModuleMinSize 
  } = useFilterContext();
  
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const filterButtonRef = useRef(null);

  const handleSelect = (module) => {
    setSelectedModule(module);
    setSelectedFunction(null);
    setSelectedBasicBlock(null);
  };

  const handleStatusChange = (status, checked) => {
    setModuleStatusFilters({
      ...moduleStatusFilters,
      [status]: checked
    });
  };

  if (!coverageData) {
    return (
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        height: '100%',
        color: '#64748b',
        fontSize: '14px'
      }}>
        No coverage data loaded. Open a coverage diff to visualize.
      </div>
    );
  }

  const filteredModules = applyFilters(coverageData.modules, moduleStatusFilters, moduleMinSize);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Treemap
        data={filteredModules}
        onSelect={handleSelect}
        selectedId={selectedModule?.id}
        title="Modules"
        onFilterClick={() => setIsFilterOpen(!isFilterOpen)}
      />
      <FilterControls
        statusFilters={moduleStatusFilters}
        onStatusChange={handleStatusChange}
        minSize={moduleMinSize}
        onMinSizeChange={setModuleMinSize}
        availableStatuses={['new', 'changed', 'old']}
        isOpen={isFilterOpen}
        onClose={() => setIsFilterOpen(false)}
        buttonRef={filterButtonRef}
      />
    </div>
  );
};

export default ModuleTreemap;
