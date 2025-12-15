import React from 'react';
import { useAppContext } from '../context/AppContext';
import { formatSize } from '../utils/filterUtils';

const DetailPane = () => {
  const { selectedModule, selectedFunction, selectedBasicBlock } = useAppContext();

  const renderDetails = () => {
    if (selectedBasicBlock) {
      const uniqueNewBB = selectedBasicBlock.frontier_attribution?.unique_new_bb || 0;
      const sharedNewBB = selectedBasicBlock.frontier_attribution?.shared_new_bb || 0;
      const totalNewBB = selectedBasicBlock.frontier_attribution?.total_new_bb || 0;
      const frontierType = selectedBasicBlock.frontier_type;
      
      return (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '48px', alignItems: 'start' }}>
            <div style={{ display: 'grid', gap: '8px', minWidth: '300px' }}>
              <DetailRow label="RVA" value={selectedBasicBlock.bb_rva || selectedBasicBlock.rva} isCode />
              <DetailRow label="Function Name" value={selectedFunction?.name || 'N/A'} isCode />
              <DetailRow label="Size" value={formatSize(selectedBasicBlock.size)} />
              <DetailRow label="Status" value={selectedBasicBlock.status} status={selectedBasicBlock.status} />
              <DetailRow label="Frontier Type" value={frontierType || 'N/A'} frontierType={frontierType} />
            </div>
            {totalNewBB > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', minWidth: '250px' }}>
                <CompositionChart
                  title="New BB Attribution"
                  data={[
                    { label: 'Unique', value: uniqueNewBB, color: '#06b6d4' },
                    { label: 'Shared', value: sharedNewBB, color: '#a855f7' }
                  ]}
                />
              </div>
            )}
          </div>
        </div>
      );
    }

    if (selectedFunction) {
      // Extract data from unified structure
      const totalBasicBlocks = selectedFunction._rawData?.blocks?.length || 0;
      const uniqueNewBB = selectedFunction.attribution?.unique_new_bb || 0;
      const sharedNewBB = selectedFunction.attribution?.shared_new_bb || 0;
      const frontierCount = selectedFunction.attribution?.frontier_count || 0;
      const strongFrontierCount = selectedFunction.attribution?.strong_frontier_count || 0;
      const weakFrontierCount = selectedFunction.attribution?.weak_frontier_count || 0;
      
      return (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '48px', alignItems: 'start' }}>
            <div style={{ display: 'grid', gap: '8px', minWidth: '300px' }}>
              <DetailRow label="Name" value={selectedFunction.name} isCode />
              <DetailRow label="RVA" value={selectedFunction.entry_rva} isCode />
              <DetailRow label="Size" value={formatSize(selectedFunction.size)} />
              <DetailRow label="Status" value={selectedFunction.status} status={selectedFunction.status} />
              <DetailRow label="Indirect Call" value={selectedFunction.is_indirectly_called ? 'Yes' : 'No'} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', minWidth: '250px' }}>
              <CompositionChart
                title="Newly-Reachable BB Composition"
                data={[
                  { label: 'Unique', value: uniqueNewBB, color: '#06b6d4' },
                  { label: 'Shared', value: sharedNewBB, color: '#a855f7' }
                ]}
              />
              <CompositionChart
                title="Basic Block Composition"
                data={[
                  { label: 'Strong Frontier', value: strongFrontierCount, color: '#059669' },
                  { label: 'Weak Frontier', value: weakFrontierCount, color: '#d97706' },
                  { label: 'Non-frontier', value: totalBasicBlocks - frontierCount, color: '#9ca3af' }
                ]}
              />
            </div>
          </div>
        </div>
      );
    }

    if (selectedModule) {
      const stats = selectedModule.statistics || {};
      const newFunctions = stats.new_functions || 0;
      const changedFunctions = stats.changed_functions || 0;
      const oldFunctions = stats.old_functions || 0;
      const totalBlocks = stats.total_blocks || 0;
      const newBlocks = stats.new_blocks || 0;
      const blocksInA = stats.blocks_in_A || 0;
      const blocksInB = stats.blocks_in_B || 0;
      
      return (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '48px', alignItems: 'start' }}>
            <div style={{ display: 'grid', gap: '8px', minWidth: '300px' }}>
              <DetailRow label="Name" value={selectedModule.name} isCode />
              <DetailRow label="Size" value={formatSize(selectedModule.size)} />
              <DetailRow label="Status" value={selectedModule.status} status={selectedModule.status} />
            </div>
            {stats && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', minWidth: '250px' }}>
                <CompositionChart
                  title="Function Composition"
                  data={[
                    { label: 'New', value: newFunctions, color: '#ef4444' },
                    { label: 'Changed', value: changedFunctions, color: '#f97316' },
                    { label: 'Unchanged', value: oldFunctions, color: '#6b7280' }
                  ]}
                />
                <CompositionChart
                  title="Block Coverage"
                  data={[
                    { label: 'New (B only)', value: newBlocks, color: '#ef4444' },
                    { label: 'Existing (in both)', value: totalBlocks - newBlocks, color: '#22c55e' }
                  ]}
                />
              </div>
            )}
          </div>
        </div>
      );
    }

    return (
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        height: '100%',
        color: '#6b7280',
        fontSize: '14px'
      }}>
        Select an item to view details
      </div>
    );
  };

  return (
    <div style={{ 
      width: '100%', 
      height: '100%', 
      padding: '16px',
      overflow: 'auto',
      backgroundColor: '#fff'
    }}>
      {renderDetails()}
    </div>
  );
};

const CompositionChart = ({ title, data }) => {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  
  if (total === 0) {
    return (
      <div style={{ minWidth: '200px' }}>
        <div style={{ fontSize: '12px', fontWeight: '600', color: '#6b7280', marginBottom: '8px' }}>
          {title}
        </div>
        <div style={{ fontSize: '11px', color: '#9ca3af' }}>No data</div>
      </div>
    );
  }
  
  return (
    <div style={{ minWidth: '200px' }}>
      <div style={{ fontSize: '12px', fontWeight: '600', color: '#6b7280', marginBottom: '8px' }}>
        {title}
      </div>
      <div style={{ 
        display: 'flex', 
        height: '24px', 
        borderRadius: '4px', 
        overflow: 'hidden',
        marginBottom: '8px'
      }}>
        {data.map((item, idx) => {
          const percentage = (item.value / total) * 100;
          return percentage > 0 ? (
            <div
              key={idx}
              style={{
                width: `${percentage}%`,
                backgroundColor: item.color,
                transition: 'width 0.3s ease'
              }}
              title={`${item.label}: ${item.value} (${percentage.toFixed(1)}%)`}
            />
          ) : null;
        })}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {data.map((item, idx) => {
          const percentage = (item.value / total) * 100;
          return (
            <div key={idx} style={{ display: 'flex', alignItems: 'center', fontSize: '11px' }}>
              <div style={{
                width: '10px',
                height: '10px',
                backgroundColor: item.color,
                borderRadius: '2px',
                marginRight: '6px',
                flexShrink: 0
              }} />
              <span style={{ color: '#6b7280', flex: 1 }}>{item.label}:</span>
              <span style={{ color: '#1f2937', fontWeight: '500' }}>
                {item.value} ({percentage.toFixed(1)}%)
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const DetailRow = ({ label, value, status, frontierType, isCode }) => {
  const statusColors = {
    'new': '#ef4444',
    'changed': '#f97316',
    'unchanged': '#22c55e'
  };
  
  const frontierTypeColors = {
    'strong_frontier': '#059669',
    'weak_frontier': '#d97706',
    'non_frontier': '#9ca3af',
    // Alternative naming conventions
    'strong': '#059669',
    'weak': '#d97706',
    'non-frontier': '#9ca3af'
  };

  const displayColor = frontierType 
    ? frontierTypeColors[frontierType] || '#1f2937'
    : (status ? statusColors[status] || '#1f2937' : '#1f2937');
  
  return (
    <div style={{ display: 'flex', fontSize: '14px' }}>
      <span style={{ 
        fontWeight: '500', 
        color: '#6b7280', 
        minWidth: '100px' 
      }}>
        {label}:
      </span>
      <span style={{ 
        color: displayColor,
        fontWeight: (status || frontierType) ? '600' : '400',
        fontFamily: isCode ? 'monospace' : 'inherit',
        backgroundColor: isCode ? '#f3f4f6' : 'transparent',
        padding: isCode ? '2px 6px' : '0',
        borderRadius: isCode ? '3px' : '0'
      }}>
        {value}
      </span>
    </div>
  );
};

export default DetailPane;
