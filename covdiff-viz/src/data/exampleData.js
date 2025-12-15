// Example data structure - replace with your own data from SQLite
// This structure is designed to be easily extensible

export const exampleData = {
  modules: [
    {
      id: 'mod_1',
      name: 'auth.dll',
      size: 524288,
      status: 'unchanged', // 'new', 'changed', 'unchanged'
      // Add any additional properties here
    },
    {
      id: 'mod_2',
      name: 'crypto.dll',
      size: 1048576,
      status: 'changed',
    },
    {
      id: 'mod_3',
      name: 'network.dll',
      size: 786432,
      status: 'new',
    },
  ],

  functions: [
    // Functions for auth.dll
    {
      id: 'fn_1',
      moduleId: 'mod_1',
      name: 'authenticate',
      size: 2048,
      status: 'unchanged',
      // Add any additional properties here
    },
    {
      id: 'fn_2',
      moduleId: 'mod_1',
      name: 'validateToken',
      size: 1536,
      status: 'unchanged',
    },
    // Functions for crypto.dll
    {
      id: 'fn_3',
      moduleId: 'mod_2',
      name: 'encrypt',
      size: 4096,
      status: 'changed',
    },
    {
      id: 'fn_4',
      moduleId: 'mod_2',
      name: 'decrypt',
      size: 3584,
      status: 'unchanged',
    },
    {
      id: 'fn_5',
      moduleId: 'mod_2',
      name: 'hash',
      size: 2560,
      status: 'changed',
    },
    // Functions for network.dll
    {
      id: 'fn_6',
      moduleId: 'mod_3',
      name: 'sendPacket',
      size: 3072,
      status: 'new',
    },
    {
      id: 'fn_7',
      moduleId: 'mod_3',
      name: 'receivePacket',
      size: 2816,
      status: 'new',
    },
  ],

  basicBlocks: [
    // Basic blocks for authenticate
    { id: 'bb_1', functionId: 'fn_1', name: 'BB_0x1000', size: 512, status: 'unchanged' },
    { id: 'bb_2', functionId: 'fn_1', name: 'BB_0x1200', size: 768, status: 'unchanged' },
    { id: 'bb_3', functionId: 'fn_1', name: 'BB_0x1500', size: 768, status: 'unchanged' },

    // Basic blocks for validateToken
    { id: 'bb_4', functionId: 'fn_2', name: 'BB_0x2000', size: 640, status: 'unchanged' },
    { id: 'bb_5', functionId: 'fn_2', name: 'BB_0x2280', size: 896, status: 'unchanged' },

    // Basic blocks for encrypt
    { id: 'bb_6', functionId: 'fn_3', name: 'BB_0x3000', size: 1024, status: 'changed' },
    { id: 'bb_7', functionId: 'fn_3', name: 'BB_0x3400', size: 1536, status: 'unchanged' },
    { id: 'bb_8', functionId: 'fn_3', name: 'BB_0x3A00', size: 1536, status: 'changed' },

    // Basic blocks for decrypt
    { id: 'bb_9', functionId: 'fn_4', name: 'BB_0x4000', size: 1280, status: 'unchanged' },
    { id: 'bb_10', functionId: 'fn_4', name: 'BB_0x4500', size: 1152, status: 'unchanged' },
    { id: 'bb_11', functionId: 'fn_4', name: 'BB_0x4980', size: 1152, status: 'unchanged' },

    // Basic blocks for hash
    { id: 'bb_12', functionId: 'fn_5', name: 'BB_0x5000', size: 896, status: 'changed' },
    { id: 'bb_13', functionId: 'fn_5', name: 'BB_0x5380', size: 832, status: 'unchanged' },
    { id: 'bb_14', functionId: 'fn_5', name: 'BB_0x56C0', size: 832, status: 'changed' },

    // Basic blocks for sendPacket
    { id: 'bb_15', functionId: 'fn_6', name: 'BB_0x6000', size: 1024, status: 'new' },
    { id: 'bb_16', functionId: 'fn_6', name: 'BB_0x6400', size: 1024, status: 'new' },
    { id: 'bb_17', functionId: 'fn_6', name: 'BB_0x6800', size: 1024, status: 'new' },

    // Basic blocks for receivePacket
    { id: 'bb_18', functionId: 'fn_7', name: 'BB_0x7000', size: 896, status: 'new' },
    { id: 'bb_19', functionId: 'fn_7', name: 'BB_0x7380', size: 960, status: 'new' },
    { id: 'bb_20', functionId: 'fn_7', name: 'BB_0x7740', size: 960, status: 'new' },
  ],

  // Call graph edges (basic block to basic block)
  // Format: { source: 'bb_id', target: 'bb_id' }
  edges: [
    // Within authenticate
    { source: 'bb_1', target: 'bb_2' },
    { source: 'bb_2', target: 'bb_3' },

    // Within validateToken
    { source: 'bb_4', target: 'bb_5' },

    // Within encrypt
    { source: 'bb_6', target: 'bb_7' },
    { source: 'bb_7', target: 'bb_8' },

    // Within decrypt
    { source: 'bb_9', target: 'bb_10' },
    { source: 'bb_10', target: 'bb_11' },

    // Within hash
    { source: 'bb_12', target: 'bb_13' },
    { source: 'bb_13', target: 'bb_14' },

    // Cross-function calls (authenticate -> validateToken)
    { source: 'bb_3', target: 'bb_4' },

    // encrypt -> hash
    { source: 'bb_8', target: 'bb_12' },

    // Within sendPacket
    { source: 'bb_15', target: 'bb_16' },
    { source: 'bb_16', target: 'bb_17' },

    // Within receivePacket
    { source: 'bb_18', target: 'bb_19' },
    { source: 'bb_19', target: 'bb_20' },

    // sendPacket -> receivePacket
    { source: 'bb_17', target: 'bb_18' },
  ],
};

// Helper function to get functions by module
export const getFunctionsByModule = (moduleId) => {
  return exampleData.functions.filter(fn => fn.moduleId === moduleId);
};

// Helper function to get basic blocks by function
export const getBasicBlocksByFunction = (functionId) => {
  return exampleData.basicBlocks.filter(bb => bb.functionId === functionId);
};

// Helper function to get edges for a specific module
export const getEdgesForModule = (moduleId) => {
  const functions = getFunctionsByModule(moduleId);
  const functionIds = functions.map(fn => fn.id);
  const basicBlocks = exampleData.basicBlocks.filter(bb => 
    functionIds.includes(bb.functionId)
  );
  const bbIds = new Set(basicBlocks.map(bb => bb.id));

  return exampleData.edges.filter(edge => 
    bbIds.has(edge.source) && bbIds.has(edge.target)
  );
};
