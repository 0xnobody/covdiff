import React, { createContext, useContext, useState } from 'react';

const AppContext = createContext();

export const useAppContext = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppContext must be used within AppProvider');
  }
  return context;
};

export const AppProvider = ({ children }) => {
  const [selectedModule, setSelectedModule] = useState(null);
  const [selectedFunction, setSelectedFunction] = useState(null);
  const [selectedBasicBlock, setSelectedBasicBlock] = useState(null);

  const value = {
    selectedModule,
    setSelectedModule,
    selectedFunction,
    setSelectedFunction,
    selectedBasicBlock,
    setSelectedBasicBlock,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};
