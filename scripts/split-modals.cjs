const fs = require('fs');
let content = fs.readFileSync('src/App.jsx', 'utf8');

// 1. Add globalSettingsModalOpen state
if (!content.includes('globalSettingsModalOpen')) {
  content = content.replace(
    /const \[profileModalOpen, setProfileModalOpen\] = useState\(false\);/,
    "const [profileModalOpen, setProfileModalOpen] = useState(false);\n  const [globalSettingsModalOpen, setGlobalSettingsModalOpen] = useState(false);"
  );
}

// 2. Add Settings icon to title bar
if (!content.includes('setGlobalSettingsModalOpen(true)')) {
  content = content.replace(
    /<div className="desktop-window-controls">/,
    `<div className="desktop-window-controls">
          <button type="button" onClick={() => setGlobalSettingsModalOpen(true)} aria-label="Settings">
            <Settings size={15} />
          </button>`
  );
}

// 3. We'll reconstruct the Profile Modal to its previous shape and extract the Transcription part to Global Settings.
// Since the previous script messed up the modal structure by wrapping it with Settings, we will rebuild it.

const startIndex = content.indexOf('{/* Settings Modal */}');
const nextModalIndex = content.indexOf('{/* Review Modal */}');
if (startIndex !== -1 && nextModalIndex !== -1) {
  const settingsModalText = content.substring(startIndex, nextModalIndex);
  
  // Extract the original profile body
  const profilesBodyStart = settingsModalText.indexOf('<div className="review-body p-6 flex flex-col md:flex-row gap-6 custom-scrollbar">');
  const profilesBodyEnd = settingsModalText.indexOf('</div>\n          </div>\n                )}');
  const originalProfileBody = settingsModalText.substring(profilesBodyStart, profilesBodyEnd);
  
  // Extract the transcription content
  const transStart = settingsModalText.indexOf('<div className="p-6 max-w-2xl">');
  const transEnd = settingsModalText.indexOf('</div>\n                )}');
  const transContent = settingsModalText.substring(transStart, transEnd);

  // New Profile Modal (Cleaned up, no tabs)
  const newProfileModal = `      {/* Accounts / Profiles Manager Modal */}
      {profileModalOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="modal-profiles-title">
          <div className="review-modal max-w-2xl">
            <div className="review-header">
              <div className="flex items-center gap-2">
                <Users size={20} className="text-emerald-400" />
                <h2 id="modal-profiles-title" className="font-bold text-lg">{t('manageProfiles')}</h2>
              </div>
              <button className="icon-button" onClick={() => setProfileModalOpen(false)} aria-label={t('close')}>
                <X size={18} />
              </button>
            </div>
            
            ${originalProfileBody}
          </div>
        </div>
      )}
`;

  // New Global Settings Modal
  const newGlobalSettingsModal = `      {/* Global Settings Modal */}
      {globalSettingsModalOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="modal-settings-title">
          <div className="review-modal max-w-2xl">
            <div className="review-header shrink-0">
              <div className="flex items-center gap-2">
                <Settings size={20} className="text-emerald-400" />
                <h2 id="modal-settings-title" className="font-bold text-lg">App Settings</h2>
              </div>
              <button className="icon-button" onClick={() => setGlobalSettingsModalOpen(false)} aria-label="Close Settings">
                <X size={18} />
              </button>
            </div>
            
            <div className="flex flex-1 overflow-hidden h-[600px] max-h-[80vh]">
              <div className="w-48 bg-slate-900/50 border-r border-white/10 flex flex-col p-3 gap-1 overflow-y-auto shrink-0">
                <button
                  className={\`px-3 py-2 text-left rounded-lg text-sm font-semibold transition-colors \${settingsTab === 'transcription' || settingsTab === 'profiles' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'}\`}
                  onClick={() => setSettingsTab('transcription')}
                >
                  Transcription
                </button>
              </div>
              <div className="flex-1 overflow-y-auto custom-scrollbar bg-slate-950/50">
                ${transContent}
              </div>
            </div>
          </div>
        </div>
      )}
`;

  content = content.substring(0, startIndex) + newProfileModal + '\n' + newGlobalSettingsModal + '\n      ' + content.substring(nextModalIndex);
  
  // also change the import for icon if needed. 'Users' is already used in App.jsx.
  fs.writeFileSync('src/App.jsx', content);
  console.log('Split modals successfully');
} else {
  console.log('Could not find modal markers.');
}
