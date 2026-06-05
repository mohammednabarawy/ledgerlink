const fs = require('fs');
const content = fs.readFileSync('src/App.jsx', 'utf8');

const startIndex = content.indexOf('{/* Accounts / Profiles Manager Modal */}');
const nextModalIndex = content.indexOf('{/* Review Modal */}');
if (startIndex === -1 || nextModalIndex === -1) {
  console.log('Could not find modal boundaries');
  process.exit(1);
}

const originalModal = content.substring(startIndex, nextModalIndex);

const bodyStartStr = '<div className="review-body p-6 flex flex-col md:flex-row gap-6 custom-scrollbar">';
const bodyStartIndex = originalModal.indexOf(bodyStartStr);

let newModal = `{/* Settings Modal */}
      {profileModalOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="review-modal max-w-4xl w-[90vw] h-[80vh] flex flex-col">
            <div className="review-header shrink-0">
              <div className="flex items-center gap-2">
                <Settings size={20} className="text-emerald-400" />
                <h2 className="font-bold text-lg">Settings</h2>
              </div>
              <button className="icon-button" onClick={() => setProfileModalOpen(false)}>
                <X size={18} />
              </button>
            </div>
            
            <div className="flex flex-1 overflow-hidden">
              {/* Sidebar */}
              <div className="w-48 bg-slate-900/50 border-r border-white/10 flex flex-col p-3 gap-1 overflow-y-auto shrink-0">
                <button
                  className={\`px-3 py-2 text-left rounded-lg text-sm font-semibold transition-colors \${settingsTab === 'profiles' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'}\`}
                  onClick={() => setSettingsTab('profiles')}
                >
                  {t('profiles')}
                </button>
                <button
                  className={\`px-3 py-2 text-left rounded-lg text-sm font-semibold transition-colors \${settingsTab === 'transcription' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'}\`}
                  onClick={() => setSettingsTab('transcription')}
                >
                  Transcription
                </button>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto custom-scrollbar bg-slate-950/50">
                {settingsTab === 'profiles' && (
` + originalModal.substring(bodyStartIndex, originalModal.indexOf('</form>') + 7) + `
            </div>
          </div>
                )}
                
                {settingsTab === 'transcription' && (
                  <div className="p-6 max-w-2xl">
                    <h3 className="text-lg font-bold text-slate-100 mb-4">Local Transcription Models</h3>
                    <p className="text-sm text-slate-400 mb-6">Download models for local audio and video transcription. Larger models are more accurate but require more memory and processing power.</p>
                    
                    <div className="space-y-3">
                      {['tiny', 'base', 'small', 'medium', 'large'].map(size => {
                        const isDownloading = modelDownloadProgress?.modelSize === size;
                        const isDownloaded = downloadedModels[size];
                        return (
                          <div key={size} className="p-4 rounded-lg border border-white/10 bg-slate-900 flex flex-col gap-3">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <Mic2 size={18} className={isDownloaded ? 'text-emerald-400' : 'text-slate-500'} />
                                <div>
                                  <span className="font-semibold text-slate-200 capitalize">{size} Model</span>
                                  <span className="text-xs text-slate-500 ml-2">whisper.cpp (ggml)</span>
                                </div>
                              </div>
                              {isDownloaded ? (
                                <span className="text-xs font-semibold text-emerald-400 bg-emerald-400/10 px-2.5 py-1 rounded border border-emerald-500/20">Downloaded</span>
                              ) : isDownloading ? (
                                <span className="text-xs font-semibold text-sky-400 bg-sky-400/10 px-2.5 py-1 rounded border border-sky-500/20">Downloading...</span>
                              ) : (
                                <button
                                  onClick={() => window.api.downloadWhisperModel(size)}
                                  className="text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-lg transition-colors"
                                >
                                  Download
                                </button>
                              )}
                            </div>
                            
                            {isDownloading && (
                              <div className="w-full">
                                <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                                  <span>{Math.round((modelDownloadProgress.downloadedBytes || 0) / 1024 / 1024)} MB</span>
                                  <span>{Math.round((modelDownloadProgress.progress || 0) * 100)}%</span>
                                </div>
                                <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                                  <div 
                                    className="h-full bg-sky-500 transition-all duration-300" 
                                    style={{ width: \`\${Math.max(0, Math.min(100, (modelDownloadProgress.progress || 0) * 100))}%\` }}
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
`;

const finalContent = content.substring(0, startIndex) + newModal + content.substring(nextModalIndex);
fs.writeFileSync('src/App.jsx', finalContent);
console.log('Settings UI updated successfully');
