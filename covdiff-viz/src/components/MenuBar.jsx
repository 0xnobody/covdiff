import React, { useState, useRef } from 'react';
import { useDatabaseContext } from '../context/DatabaseContext';
import logoIcon from '../assets/logo.ico';

const MenuBar = () => {
  const [activeMenu, setActiveMenu] = useState(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const { openCovdiffFile } = useDatabaseContext();
  const fileInputRef = useRef(null);
  const isElectron = window.electron?.isElectron === true;

  const handleMenuClick = (menuName) => {
    setActiveMenu(activeMenu === menuName ? null : menuName);
  };

  const handleOpenCovdiffFile = () => {
    console.log('handleOpenCovdiffFile called');
    closeMenu();
    try {
      openCovdiffFile();
    } catch (error) {
      console.error('Error opening covdiff file:', error);
    }
  };

  const handleMinimize = () => {
    if (window.electron) {
      window.electron.send('window-minimize');
    }
  };

  const handleMaximize = () => {
    if (window.electron) {
      window.electron.send('window-maximize');
      setIsMaximized(!isMaximized);
    }
  };

  const handleClose = () => {
    if (window.electron) {
      window.electron.send('window-close');
    }
  };

  const closeMenu = () => {
    setActiveMenu(null);
  };

  return (
    <div
      onClick={closeMenu}
      style={{
        height: '30px',
        background: '#2d2d30',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        WebkitAppRegion: 'drag',
        userSelect: 'none',
        borderBottom: '1px solid #1e1e1e',
      }}
    >
      {/* Left section: Logo and menus */}
      <div style={{ display: 'flex', alignItems: 'center', height: '100%' }}>
        {/* Logo placeholder */}
        <div
          style={{
            width: '30px',
            height: '30px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            WebkitAppRegion: 'no-drag',
            padding: '4px',
          }}
        >
          <img 
            src={logoIcon} 
            alt="CovDiff Logo" 
            style={{ 
              width: '100%', 
              height: '100%',
              objectFit: 'contain'
            }} 
          />
        </div>

        {/* Menu items */}
        <MenuItem
          label="File"
          isActive={activeMenu === 'File'}
          onClick={() => handleMenuClick('File')}
          onClose={closeMenu}
        >
          <MenuDropdown>
            <MenuDropdownItem onClick={handleOpenCovdiffFile}>
              Open covdiff...
            </MenuDropdownItem>
          </MenuDropdown>
        </MenuItem>
      </div>

      {/* Right section: Window controls */}
      {isElectron && (
        <div style={{ display: 'flex', height: '100%', WebkitAppRegion: 'no-drag' }}>
          <WindowControl onClick={handleMinimize} icon="─" />
          <WindowControl onClick={handleMaximize} icon={isMaximized ? '❐' : '□'} />
          <WindowControl onClick={handleClose} icon="✕" isClose />
        </div>
      )}
    </div>
  );
};

const MenuItem = ({ label, isActive, onClick, children, onClose }) => {
  const [isHovered, setIsHovered] = useState(false);

  const handleClick = (e) => {
    e.stopPropagation();
    onClick();
  };

  const handleContainerClick = (e) => {
    e.stopPropagation();
  };

  return (
    <div
      onClick={handleContainerClick}
      style={{
        position: 'relative',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        onClick={handleClick}
        style={{
          padding: '0 12px',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          cursor: 'pointer',
          color: '#ffffff',
          fontSize: '13px',
          background: isActive || isHovered ? '#3e3e42' : 'transparent',
          WebkitAppRegion: 'no-drag',
        }}
      >
        {label}
      </div>
      {isActive && React.cloneElement(children, { onClose })}
    </div>
  );
};

const MenuDropdown = ({ children, onClose }) => {
  const handleDropdownClick = (e) => {
    e.stopPropagation();
  };

  return (
    <>
      {/* Backdrop to close menu when clicking outside */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 999,
        }}
        onClick={onClose}
      />
      <div
        onClick={handleDropdownClick}
        style={{
          position: 'absolute',
          top: '30px',
          left: 0,
          minWidth: '200px',
          background: '#252526',
          border: '1px solid #454545',
          boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
          zIndex: 1000,
        }}
      >
        {children}
      </div>
    </>
  );
};

const MenuDropdownItem = ({ children, onClick }) => {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={onClick}
      style={{
        padding: '6px 20px',
        color: '#cccccc',
        fontSize: '13px',
        cursor: 'pointer',
        background: isHovered ? '#094771' : 'transparent',
      }}
    >
      {children}
    </div>
  );
};

const MenuDropdownSeparator = () => {
  return (
    <div
      style={{
        height: '1px',
        background: '#454545',
        margin: '4px 0',
      }}
    />
  );
};

const WindowControl = ({ onClick, icon, isClose }) => {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        width: '46px',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        color: '#ffffff',
        fontSize: '14px',
        background: isHovered ? (isClose ? '#e81123' : '#3e3e42') : 'transparent',
      }}
    >
      {icon}
    </div>
  );
};

export default MenuBar;
