import React from 'react';
import { useAppContext } from '../context/AppContext';
import { formatSize } from '../utils/filterUtils';

const DetailPane = () => {
  const { selectedModule, selectedFunction, selectedBasicBlock } = useAppContext();

  const renderDetails = () => {
    if (selectedBasicBlock) {
      return (
        <div>
          <div style={{ display: 'grid', gap: '8px' }}>
            <DetailRow label="RVA" value={selectedBasicBlock.bb_rva || selectedBasicBlock.rva} isCode />
            <DetailRow label="Function Name" value={selectedFunction?.name || 'N/A'} isCode />
            <DetailRow label="Size" value={formatSize(selectedBasicBlock.size)} />
            <DetailRow label="Status" value={selectedBasicBlock.status} status={selectedBasicBlock.status} />
            <DetailRow label="Frontier Type" value={selectedBasicBlock.frontier_type || 'N/A'} />
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
                  { label: 'Unique', value: uniqueNewBB, color: '#3b82f6' },
                  { label: 'Shared', value: sharedNewBB, color: '#8b5cf6' }
                ]}
              />
              <CompositionChart
                title="Frontier Composition"
                data={[
                  { label: 'Strong', value: strongFrontierCount, color: '#10b981' },
                  { label: 'Weak', value: weakFrontierCount, color: '#f59e0b' },
                  { label: 'Non-frontier', value: totalBasicBlocks - frontierCount, color: '#d1d5db' }
                ]}
              />
            </div>
          </div>
        </div>
      );
    }

    if (selectedModule) {
      return (
        <div>
          <div style={{ display: 'grid', gap: '8px' }}>
            <DetailRow label="Name" value={selectedModule.name} isCode />
            <DetailRow label="Size" value={formatSize(selectedModule.size)} />
            <DetailRow label="Status" value={selectedModule.status} status={selectedModule.status} />
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

const DetailRow = ({ label, value, status, isCode }) => {
  const statusColors = {
    'new': '#ef4444',
    'changed': '#f97316',
    'unchanged': '#22c55e'
  };

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
        color: status ? statusColors[status] || '#1f2937' : '#1f2937',
        fontWeight: status ? '600' : '400',
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
