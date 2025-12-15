import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const DatabaseContext = createContext();

export const useDatabaseContext = () => {
  const context = useContext(DatabaseContext);
  if (!context) {
    throw new Error('useDatabaseContext must be used within DatabaseProvider');
  }
  return context;
};

export const DatabaseProvider = ({ children }) => {
  const [covdiffFilePath, setCovdiffFilePath] = useState(null);
  const [coverageData, setCoverageData] = useState(null);
  const [rawCoverageData, setRawCoverageData] = useState(null); // Store original JSON
  const fileInputRef = React.useRef(null);

  const processCovdiffData = useCallback(async (fileContents, fileName) => {
    try {
      const jsonData = JSON.parse(fileContents);
      
      console.log('Loaded .covdiff.json file:', jsonData);
      
      setCovdiffFilePath(fileName);
      
      // Store raw data for call graph
      setRawCoverageData(jsonData);
      
      // Transform the data to visualization format for treemaps
      const transformedData = transformCovdiffData(jsonData);
      setCoverageData(transformedData);
      
    } catch (error) {
      console.error('Error loading covdiff file:', error);
      alert('Failed to load coverage file: ' + error.message);
    }
  }, []);

  const openCovdiffFile = useCallback(async () => {
    console.log('openCovdiffFile called');
    // Check if running in Electron
    const isElectron = window.electron?.isElectron === true;
    console.log('isElectron:', isElectron);
    
    if (isElectron) {
      // Electron environment - use native file dialog
      const result = await window.electron.openFileDialog({
        title: 'Open Coverage Diff File',
        filters: [{ name: 'Coverage Diff', extensions: ['covdiff.json', 'json'] }],
        properties: ['openFile']
      });

      if (!result.canceled && result.filePaths.length > 0) {
        const filePath = result.filePaths[0];
        setCovdiffFilePath(filePath);
        
        // Read and process the file
        const fileContents = await window.electron.readFile(filePath);
        await processCovdiffData(fileContents, filePath);
      }
    } else {
      console.log('Web environment - creating file input');
      // Web environment - use HTML file input
      if (!fileInputRef.current) {
        console.log('Creating new file input element');
        // Create file input if it doesn't exist
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.covdiff.json,.json';
        input.onchange = async (e) => {
          console.log('File selected:', e.target.files[0]);
          const file = e.target.files[0];
          if (file) {
            const reader = new FileReader();
            reader.onload = async (event) => {
              await processCovdiffData(event.target.result, file.name);
            };
            reader.readAsText(file);
          }
        };
        fileInputRef.current = input;
      }
      // Reset the value to allow selecting the same file again
      fileInputRef.current.value = '';
      console.log('Clicking file input');
      fileInputRef.current.click();
    }
  }, [processCovdiffData]);

  const loadCovdiffFile = useCallback(async (filePath) => {
    try {
      // Read the file contents
      const fileContents = await window.electron.readFile(filePath);
      await processCovdiffData(fileContents, filePath);
    } catch (error) {
      console.error('Error loading covdiff file:', error);
      alert('Failed to load coverage file: ' + error.message);
    }
  }, [processCovdiffData]);

  const transformCovdiffData = (jsonData) => {
    const modules = [];
    const functions = [];
    const basicBlocks = [];
    const edges = [];

    jsonData.modules.forEach((module) => {
      // Add module
      modules.push({
        id: `mod_${module.binary_id}`,
        name: module.module_name,
        // TODO: Change to SizeOfImage when available
        size: module.statistics.total_blocks,
        status: module.status,
        binary_id: module.binary_id,
        statistics: module.statistics
      });

      // Add functions for this module
      module.functions.forEach((func) => {
        const funcId = `func_${module.binary_id}_${func.func_id}`;
        
        functions.push({
          id: funcId,
          moduleId: `mod_${module.binary_id}`,
          name: func.func_name,
          size: func.func_size,
          status: func.status,
          func_id: func.func_id,
          entry_rva: func.entry_rva,
          is_indirectly_called: func.is_indirectly_called,
          attribution: func.attribution,
          // Store reference to complete raw data for unified access
          _rawData: func,
          _moduleData: { binary_id: module.binary_id, module_name: module.module_name }
        });

        // Add basic blocks for this function
        func.blocks.forEach((block) => {
          basicBlocks.push({
            id: `bb_${module.binary_id}_${block.bb_rva}`,
            functionId: funcId,
            name: block.bb_rva,
            size: block.bb_size,
            status: block.status,
            bb_rva: block.bb_rva,
            is_frontier: block.is_frontier,
            frontier_type: block.frontier_type,
            attribution: block.attribution
          });
        });
      });

      // Add edges for this module
      module.edges.forEach((edge) => {
        edges.push({
          source: `bb_${module.binary_id}_${edge.src_bb_rva}`,
          target: `bb_${module.binary_id}_${edge.dst_bb_rva}`,
          edge_type: edge.edge_type,
          is_frontier_edge: edge.is_frontier_edge
        });
      });
    });

    console.log(`Transformed: ${modules.length} modules, ${functions.length} functions, ${basicBlocks.length} basic blocks`);

    return {
      modules,
      functions,
      basicBlocks,
      edges
    };
  };

  // Listen for menu events
  useEffect(() => {
    const handleOpenCovdiffFile = () => {
      openCovdiffFile();
    };

    window.electron.onMenuOpenCovdiffFile(handleOpenCovdiffFile);

    // Cleanup listeners on unmount
    return () => {
      window.electron.removeMenuOpenCovdiffFile?.(handleOpenCovdiffFile);
    };
  }, [openCovdiffFile]);

  const value = {
    covdiffFilePath,
    coverageData,
    rawCoverageData,
    openCovdiffFile
  };

  return (
    <DatabaseContext.Provider value={value}>
      {children}
    </DatabaseContext.Provider>
  );
};
