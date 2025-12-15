/**
 * Format byte size to human-readable string
 */
export const formatSize = (bytes) => {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

/**
 * Apply filters to data array
 */
export const applyFilters = (data, statusFilters, minSize) => {
  return data.filter(item => {
    // Check status filter
    if (!statusFilters[item.status]) return false;
    // Check min size
    if (item.size < minSize) return false;
    return true;
  });
};
