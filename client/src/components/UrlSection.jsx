import React from 'react';
import { Smartphone, Laptop } from 'lucide-react';

const UrlSection = ({ 
  webpageUrl, 
  setWebpageUrl, 
  selectedDevice, 
  setSelectedDevice, 
  buttonState, 
  handlePreviewUrl, 
  handleDeviceChange,
  isLoading,
  isPreloading,
  detectedAds,
  handleOverlayClick
}) => {
  const deviceConfigs = {
    'macbook-air': { 
      name: 'MacBook Air', 
      icon: Laptop, 
      viewport: '1440×900',
      description: 'Desktop view'
    },
    iphone16: { 
      name: 'iPhone 16', 
      icon: Smartphone, 
      viewport: '393×852',
      description: 'Mobile view'
    }
  };

  return (
    <div className="space-y-4 flex flex-col h-full">
      {/* Website URL */}
      <div className="bg-gray-50 rounded-lg p-4">
        <h2 className="text-xl font-brand mb-4 text-gray-800">Website URL</h2>
        <div className="space-y-3">
          <input
            type="url"
            value={webpageUrl}
            onChange={(e) => setWebpageUrl(e.target.value)}
            placeholder="https://example.com"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-lg"
          />
          
          {/* Device Dropdown */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Preview Device</label>
            <select
              value={selectedDevice}
              onChange={(e) => handleDeviceChange(e.target.value)}
              disabled={isPreloading}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {Object.entries(deviceConfigs).map(([key, config]) => (
                <option key={key} value={key}>
                  {config.name} ({config.viewport})
                </option>
              ))}
            </select>
            {isPreloading && (
              <div className="text-xs text-blue-600 mt-1">
                Preloading both devices...
              </div>
            )}
          </div>
          
          {/* Action Button */}
          <div className="space-y-2">
            <button
              onClick={handlePreviewUrl}
              disabled={isLoading || !webpageUrl}
              className="w-full flex items-center justify-center space-x-2 px-3 py-2 bg-blue-500 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed text-sm transition-all duration-500 hover:scale-105 hover:shadow-lg"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zM7 7h2v2H7V7zm8 0h2v2h-2V7zM7 11h10v6H7v-6zm2 2v2h6v-2H9z"/>
              </svg>
              <span className="text-sm font-medium">Preview URL & Highlight ADs</span>
            </button>
          </div>
        </div>
      </div>

      {/* How to use section */}
      <div className="bg-blue-50 rounded-lg p-4 flex-shrink-0">
        <h3 className="font-brand text-blue-800 mb-3 text-base">How to use:</h3>
        <ol className="text-xs text-blue-700 space-y-2">
          <li className="flex items-start space-x-2">
            <span className="bg-blue-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">1</span>
            <span>Enter a website URL in the text box</span>
          </li>
          <li className="flex items-start space-x-2">
            <span className="bg-blue-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">2</span>
            <span>Select device layout (MacBook Air, iPhone 16)</span>
          </li>
          <li className="flex items-start space-x-2">
            <span className="bg-blue-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">3</span>
            <span>Click "Preview URL & Highlight ADs" to load webpage and detect ads</span>
          </li>
          <li className="flex items-start space-x-2">
            <span className="bg-blue-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">4</span>
            <span>Click on highlighted ad areas to upload and replace with your creatives</span>
          </li>
          <li className="flex items-start space-x-2">
            <span className="bg-blue-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">5</span>
            <span>Download the final screenshot with your creatives</span>
          </li>
        </ol>
      </div>

      {/* List of detected ads section */}
      <div className="bg-green-50 rounded-lg p-4 flex flex-col flex-1 min-h-0">
        <h3 className="font-brand text-green-800 mb-3 text-base flex-shrink-0">List of detected ads:</h3>
        <p className="text-xs text-green-600 mb-3 flex-shrink-0">
          You can drag and drop files directly onto the ad frames in the preview!
        </p>
        {detectedAds && detectedAds.length > 0 ? (
          <div className="flex-1 min-h-0 overflow-y-auto space-y-2">
            {detectedAds.map((ad, index) => (
              <div key={ad.id || index} className="flex items-center justify-between bg-green-100 rounded-lg p-2 border border-green-300">
                <div className="flex-1">
                  <div className="text-xs font-bold text-gray-600">
                    AD Frame #{index + 1}
                  </div>
                  <div className="text-xs text-gray-600">
                    {ad.size?.width || 0} × {ad.size?.height || 0}px
                  </div>
                </div>
                <button
                  onClick={() => handleOverlayClick(ad)}
                  className="ml-3 px-3 py-1 bg-gray-200 text-gray-700 rounded text-xs font-medium hover:bg-gray-300 transition-colors duration-200"
                >
                  Choose Asset
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-green-700 bg-green-100 rounded-lg p-3">
            Please load URL and press "Preview URL & Highlight ADs" button to load ads in this area.
          </div>
        )}
      </div>
    </div>
  );
};

export default UrlSection;
