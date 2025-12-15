import React, { useRef, useEffect } from 'react';
import '../styles/FilterControls.css';

const FilterControls = ({ 
  statusFilters, 
  onStatusChange, 
  minSize, 
  onMinSizeChange,
  availableStatuses = ['new', 'changed', 'old'],
  statusLabels = {},  // Custom labels for statuses
  isOpen,
  onClose,
  buttonRef
}) => {
  const dialogRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event) => {
      if (
        dialogRef.current && 
        !dialogRef.current.contains(event.target) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target)
      ) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose, buttonRef]);

  if (!isOpen) return null;

  return (
    <div className="filter-dialog" ref={dialogRef}>
      <div className="filter-group">
        <label className="filter-label">Status:</label>
        <div className="filter-checkboxes">
          {availableStatuses.map(status => (
            <label key={status} className="checkbox-label">
              <input
                type="checkbox"
                checked={statusFilters[status]}
                onChange={(e) => onStatusChange(status, e.target.checked)}
              />
              <span className={`status-label status-${status}`}>
                {statusLabels[status] || status}
              </span>
            </label>
          ))}
        </div>
      </div>
      
      <div className="filter-group">
        <label className="filter-label" htmlFor="min-size">Min Size (bytes):</label>
        <div className="size-filter">
          <input
            id="min-size"
            type="number"
            min="0"
            value={minSize}
            onChange={(e) => onMinSizeChange(parseInt(e.target.value) || 0)}
            className="size-input"
          />
        </div>
      </div>
    </div>
  );
};

export default FilterControls;
