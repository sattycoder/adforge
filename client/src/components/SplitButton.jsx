import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';

const SplitButton = ({ 
  mainAction, 
  mainLabel, 
  options = [], 
  disabled = false,
  className = ''
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleMainClick = () => {
    if (mainAction && !disabled) {
      mainAction();
    }
  };

  const handleOptionClick = (option) => {
    if (option.action && !disabled) {
      option.action();
    }
    setIsOpen(false);
  };

  return (
    <div className={`relative inline-block ${className}`} ref={dropdownRef}>
      <div className="flex">
        {/* Main button */}
        <button
          onClick={handleMainClick}
          disabled={disabled}
          className={`
            px-4 py-2 text-sm font-medium text-gray-800 bg-gray-100 border border-gray-400 
            rounded-l-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-600 
            focus:border-gray-200 disabled:opacity-50 disabled:cursor-not-allowed
            ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}
          `}
        >
          {mainLabel}
        </button>
        
        {/* Dropdown toggle */}
        <button
          onClick={() => setIsOpen(!isOpen)}
          disabled={disabled}
          className={`
            px-2 py-2 text-sm font-medium text-gray-800 bg-gray-100 border border-l-0 border-gray-400 
            rounded-r-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-600 
            focus:border-gray-200 disabled:opacity-50 disabled:cursor-not-allowed
            ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}
          `}
        >
          <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {/* Dropdown menu */}
      {isOpen && (
        <div className="absolute right-0 z-10 mt-1 w-48 bg-gray-100 border border-gray-400 rounded-md shadow-lg">
          <div className="py-1">
            {options.map((option, index) => (
              <button
                key={index}
                onClick={() => handleOptionClick(option)}
                className="
                  w-full px-4 py-2 text-left text-sm text-gray-800 hover:bg-gray-200 
                  focus:outline-none focus:bg-gray-200 transition-colors
                "
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default SplitButton;
