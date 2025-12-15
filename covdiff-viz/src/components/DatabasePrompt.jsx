import React from 'react';
import { useDatabaseContext } from '../context/DatabaseContext';
import '../styles/DatabasePrompt.css';

const DatabasePrompt = () => {
  const { showMasterDbPrompt, openMasterDatabase, setShowMasterDbPrompt } = useDatabaseContext();

  if (!showMasterDbPrompt) return null;

  return (
    <div className="database-prompt-overlay">
      <div className="database-prompt-dialog">
        <h2>Select Master Database</h2>
        <p>Please select the master.db file to get started.</p>
        <div className="database-prompt-actions">
          <button onClick={openMasterDatabase} className="btn-primary">
            Select Master Database
          </button>
        </div>
      </div>
    </div>
  );
};

export default DatabasePrompt;
