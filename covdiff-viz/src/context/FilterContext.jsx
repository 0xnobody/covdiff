import React, { createContext, useContext, useState } from 'react';

const FilterContext = createContext();

export const useFilterContext = () => {
  const context = useContext(FilterContext);
  if (!context) {
    throw new Error('useFilterContext must be used within FilterProvider');
  }
  return context;
};

export const FilterProvider = ({ children }) => {
  // Module filters
  const [moduleStatusFilters, setModuleStatusFilters] = useState({
    new: true,
    changed: true,
    old: true
  });
  const [moduleMinSize, setModuleMinSize] = useState(0);

  // Function filters
  const [functionStatusFilters, setFunctionStatusFilters] = useState({
    new: true,
    changed: true,
    old: true
  });
  const [functionMinSize, setFunctionMinSize] = useState(100);

  // Basic block filters (statuses: 'new' or 'in_both')
  const [bbStatusFilters, setBbStatusFilters] = useState({
    new: true,
    in_both: true  // Covered in both A and B
  });
  const [bbMinSize, setBbMinSize] = useState(0);

  // Call graph options
  const [showTransitiveEdges, setShowTransitiveEdges] = useState(false);
  const [graphMinFunctionSize, setGraphMinFunctionSize] = useState(0);
  const [graphMinNewBBCount, setGraphMinNewBBCount] = useState(0);

  const value = {
    moduleStatusFilters,
    setModuleStatusFilters,
    moduleMinSize,
    setModuleMinSize,
    functionStatusFilters,
    setFunctionStatusFilters,
    functionMinSize,
    setFunctionMinSize,
    bbStatusFilters,
    setBbStatusFilters,
    bbMinSize,
    setBbMinSize,
    showTransitiveEdges,
    setShowTransitiveEdges,
    graphMinFunctionSize,
    setGraphMinFunctionSize,
    graphMinNewBBCount,
    setGraphMinNewBBCount
  };

  return (
    <FilterContext.Provider value={value}>
      {children}
    </FilterContext.Provider>
  );
};
