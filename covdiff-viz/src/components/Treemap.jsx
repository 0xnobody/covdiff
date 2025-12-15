import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { useDatabaseContext } from '../context/DatabaseContext';

/**
 * Calculate coverage percentage color with biased gradient
 */
const getCoverageColor = (item, rawCoverageData) => {
  // For modules, aggregate all functions
  if (item.id.startsWith('mod_')) {
    const binaryId = item.id.replace('mod_', '');
    const module = rawCoverageData?.modules.find(m => m.binary_id.toString() === binaryId);
    
    if (!module) return '#6b7280';
    
    let totalBlocks = 0;
    let newBlocks = 0;
    
    module.functions.forEach(func => {
      totalBlocks += func.blocks.length;
      newBlocks += func.blocks.filter(block => block.status === 'new').length;
    });
    
    if (totalBlocks === 0 || newBlocks === 0) return '#6b7280';
    const coveragePercent = (newBlocks / totalBlocks) * 100;
    return getCoverageGradient(coveragePercent);
  }
  
  // For functions
  if (item.id.startsWith('func_')) {
    const funcData = item._rawData;
    if (!funcData || !funcData.blocks) return '#6b7280';
    
    const totalBlocks = funcData.blocks.length;
    const newBlocks = funcData.blocks.filter(block => block.status === 'new').length;
    
    if (totalBlocks === 0 || newBlocks === 0) return '#6b7280';
    const coveragePercent = (newBlocks / totalBlocks) * 100;
    return getCoverageGradient(coveragePercent);
  }
  
  // For basic blocks, use status-based coloring
  if (item.status === 'new') return '#ef4444';
  return '#6b7280';
};

const getCoverageGradient = (coveragePercent) => {
  if (coveragePercent >= 99.9) {
    return '#b91c1c'; // bright red for 100% coverage
  }
  
  let t;
  if (coveragePercent < 5) {
    return '#fb923c'; // light orange
  } else if (coveragePercent < 10) {
    t = (coveragePercent - 5) / 5;
    return d3.interpolateRgb('#fb923c', '#f97316')(t);
  } else if (coveragePercent < 25) {
    t = (coveragePercent - 10) / 15;
    return d3.interpolateRgb('#f97316', '#ef4444')(t);
  } else {
    return '#dc2626'; // deep red
  }
};

const Treemap = ({ data, onSelect, selectedId, title, onFilterClick, legendType = 'coverage' }) => {
  const svgRef = useRef();
  const containerRef = useRef();
  const { rawCoverageData } = useDatabaseContext();

  useEffect(() => {
    if (!data || data.length === 0) return;

    const container = containerRef.current;
    if (!container) return;
    
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Clear previous content
    d3.select(svgRef.current).selectAll('*').remove();

    const svg = d3.select(svgRef.current)
      .attr('width', width)
      .attr('height', height);

    // Create hierarchy
    const root = d3.hierarchy({ children: data })
      .sum(d => d.size)
      .sort((a, b) => b.value - a.value);

    // Create treemap layout
    const treemap = d3.treemap()
      .size([width, height])
      .padding(2)
      .round(true);

    treemap(root);

    // Create tooltip
    const tooltip = d3.select('body').selectAll('.treemap-tooltip').data([null])
      .join('div')
      .attr('class', 'treemap-tooltip')
      .style('position', 'absolute')
      .style('visibility', 'hidden')
      .style('background-color', 'rgba(0, 0, 0, 0.8)')
      .style('color', 'white')
      .style('padding', '8px 12px')
      .style('border-radius', '4px')
      .style('font-size', '12px')
      .style('pointer-events', 'none')
      .style('z-index', '10000')
      .style('max-width', '300px')
      .style('word-wrap', 'break-word');

    // Create cells
    const cell = svg.selectAll('g')
      .data(root.leaves())
      .join('g')
      .attr('transform', d => `translate(${d.x0},${d.y0})`)
      .style('cursor', 'pointer')
      .on('mousedown', (event, d) => {
        event.preventDefault();
        event.stopPropagation();
        onSelect(d.data);
      })
      .on('mouseover', (event, d) => {
        tooltip
          .style('visibility', 'visible')
          .text(d.data.name);
      })
      .on('mousemove', (event) => {
        tooltip
          .style('top', (event.pageY - 10) + 'px')
          .style('left', (event.pageX + 10) + 'px');
      })
      .on('mouseout', () => {
        tooltip.style('visibility', 'hidden');
      });

    // Add rectangles
    cell.append('rect')
      .attr('width', d => d.x1 - d.x0)
      .attr('height', d => d.y1 - d.y0)
      .attr('fill', d => getCoverageColor(d.data, rawCoverageData))
      .attr('stroke', d => d.data.id === selectedId ? '#1e40af' : '#fff')
      .attr('stroke-width', d => d.data.id === selectedId ? 3 : 1)
      .attr('opacity', 0.8);

    // Add text labels (only if they fit)
    cell.append('text')
      .attr('x', 4)
      .attr('y', 16)
      .text(d => {
        const width = d.x1 - d.x0;
        const height = d.y1 - d.y0;
        // Only show label if rectangle is large enough
        if (width > 40 && height > 20) {
          return d.data.name;
        }
        return '';
      })
      .attr('font-size', '11px')
      .attr('fill', 'white')
      .style('pointer-events', 'none')
      .each(function(d) {
        const text = d3.select(this).text();
        if (text) {
          const textLength = this.getComputedTextLength();
          const rectWidth = d.x1 - d.x0 - 8;
          const rectHeight = d.y1 - d.y0;
          // Hide if text doesn't fit or rect too small
          if (textLength > rectWidth || rectHeight < 20) {
            d3.select(this).text('');
          }
        }
      });

    // Add size labels
    cell.append('text')
      .attr('x', 4)
      .attr('y', 28)
      .text(d => `${(d.data.size / 1024).toFixed(1)}KB`)
      .attr('font-size', '9px')
      .attr('fill', '#e5e7eb')
      .style('pointer-events', 'none');

  }, [data, selectedId, onSelect, rawCoverageData]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 12px',
        borderBottom: '1px solid #e2e8f0',
        backgroundColor: '#f8fafc',
        flexShrink: 0
      }}>
        <h3 style={{ margin: 0, fontSize: '14px', fontWeight: '600', color: '#475569' }}>{title}</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {legendType === 'coverage' ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px', color: '#64748b' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                <div style={{ width: '12px', height: '12px', backgroundColor: '#6b7280', borderRadius: '2px' }}></div>
                <span>0%</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                <div style={{ width: '12px', height: '12px', backgroundColor: '#fb923c', borderRadius: '2px' }}></div>
                <span>&lt;5%</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                <div style={{ width: '12px', height: '12px', backgroundColor: '#f97316', borderRadius: '2px' }}></div>
                <span>10%</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                <div style={{ width: '12px', height: '12px', backgroundColor: '#dc2626', borderRadius: '2px' }}></div>
                <span>25%</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                <div style={{ width: '12px', height: '12px', backgroundColor: '#b91c1c', borderRadius: '2px' }}></div>
                <span>100%</span>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px', color: '#64748b' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                <div style={{ width: '12px', height: '12px', backgroundColor: '#ef4444', borderRadius: '2px' }}></div>
                <span>New</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                <div style={{ width: '12px', height: '12px', backgroundColor: '#6b7280', borderRadius: '2px' }}></div>
                <span>Old</span>
              </div>
            </div>
          )}
          {onFilterClick && (
            <button 
              onClick={onFilterClick}
              className="filter-button"
              style={{
                background: 'none',
                border: 'none',
                padding: '4px 8px',
                cursor: 'pointer',
                color: '#64748b',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '4px'
              }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" style={{ width: '18px', height: '18px' }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 01-.659 1.591l-5.432 5.432a2.25 2.25 0 00-.659 1.591v2.927a2.25 2.25 0 01-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 00-.659-1.591L3.659 7.409A2.25 2.25 0 013 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0112 3z" />
              </svg>
            </button>
          )}
        </div>
      </div>
      <div ref={containerRef} style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
        <svg ref={svgRef} style={{ display: 'block' }}></svg>
      </div>
    </div>
  );
};

export default Treemap;
