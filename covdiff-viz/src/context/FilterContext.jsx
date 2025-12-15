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

  // Basic block filters - category-based (visual categories)
  const [bbCategoryFilters, setBbCategoryFilters] = useState({
    new: true,       // Red - non-frontier new blocks
    frontier: true,  // Blue->Purple gradient - frontier blocks
    old: true        // Grey - old blocks (in_both status)
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
    bbCategoryFilters,
    setBbCategoryFilters,
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
