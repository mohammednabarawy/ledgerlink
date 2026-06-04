import { useCallback, useEffect, useMemo, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  AlertCircle,
  Archive,
  Bell,
  BellOff,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Eye,
  Folder,
  HardDrive,
  Loader2,
  LogOut,
  MessageCircle,
  RefreshCw,
  Search,
  Smartphone,
  User,
  Users,
  Wrench,
  X,
  Plus,
  Settings,
  Briefcase,
  Wallet,
  Trash2,
  Check,
  Send,
} from 'lucide-react';
import { useLanguage } from './LanguageContext';

const chatFilters = ['all', 'groups', 'contacts', 'archived'];

const PROFILE_COLORS = [
  { name: 'Emerald', value: '#10b981' },
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Purple', value: '#8b5cf6' },
  { name: 'Amber', value: '#f59e0b' },
  { name: 'Rose', value: '#f43f5e' },
];

const PROFILE_ICONS = [
  { name: 'user', component: User },
  { name: 'briefcase', component: Briefcase },
  { name: 'wallet', component: Wallet },
];

function ProfileIcon({ name, color, className = 'w-5 h-5' }) {
  const iconObj = PROFILE_ICONS.find(i => i.name === name) || PROFILE_ICONS[0];
  const IconComponent = iconObj.component;
  return <IconComponent className={className} style={{ color: color }} />;
}

function formatChatDate(timestamp) {
  if (!timestamp) return '';
  return new Date(timestamp * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function ChatIcon({ chat, className = '' }) {
  const [prevId, setPrevId] = useState(chat.id);
  const [avatarUrl, setAvatarUrl] = useState(chat.avatarUrl || null);
  const [loading, setLoading] = useState(false);

  if (chat.id !== prevId) {
    setPrevId(chat.id);
    setAvatarUrl(chat.avatarUrl || null);
    setLoading(false);
  }

  useEffect(() => {
    let active = true;
    if (!avatarUrl && chat.id && !loading && chat.isGroup !== undefined) {
      Promise.resolve().then(() => {
        if (active) setLoading(true);
      });
      window.api.getChatAvatar(chat.id).then(url => {
        if (active && url) setAvatarUrl(url);
        if (active) setLoading(false);
      }).catch(() => {
        if (active) setLoading(false);
      });
    }
    return () => {
      active = false;
    };
  }, [avatarUrl, chat.id, chat.isGroup, loading]);

  if (avatarUrl) {
    return <img src={avatarUrl} alt={chat.name || ''} className={`w-full h-full object-cover shrink-0 ${className}`} />;
  }
  if (chat?.archived) return <Archive size={18} className={className} />;
  return chat?.isGroup ? <Users size={18} className={className} /> : <User size={18} className={className} />;
}

function App() {
  const { lang, t, toggleLanguage } = useLanguage();
  const isRtl = lang === 'ar';

  // Platform Selector State
  const [activePlatform, setActivePlatform] = useState('whatsapp'); // 'whatsapp' | 'telegram'

  // Profile States
  const [profiles, setProfiles] = useState([]);
  const [activeProfile, setActiveProfile] = useState(null);
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState(null);

  // Profile Form States
  const [profName, setProfName] = useState('');
  const [profVault, setProfVault] = useState('');
  const [profIcon, setProfIcon] = useState('user');
  const [profColor, setProfColor] = useState('#10b981');

  // Vault and WA States
  const [vaultPath, setVaultPath] = useState(null);
  const [qrCode, setQrCode] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false); // WhatsApp authenticated
  const [accountInfo, setAccountInfo] = useState(null); // WhatsApp account info
  const [chats, setChats] = useState([]);
  const [selectedChat, setSelectedChat] = useState(null);
  const [isLoadingChats, setIsLoadingChats] = useState(false);
  const [chatQuery, setChatQuery] = useState('');
  const [chatFilter, setChatFilter] = useState('all');

  // Telegram States
  const [isTGAuthenticated, setIsTGAuthenticated] = useState(false);
  const [tgAccountInfo, setTgAccountInfo] = useState(null);
  const [tgStatus, setTgStatus] = useState({ state: 'DISCONNECTED' });
  const [tgError, setTgError] = useState(null);
  const [tgPhone, setTgPhone] = useState('');
  const [tgCode, setTgCode] = useState('');
  const [tgPassword, setTgPassword] = useState('');
  const [tgSubmitting, setTgSubmitting] = useState(false);

  // Archiving States
  const [isWorking, setIsWorking] = useState(false);
  const [archiveProgress, setArchiveProgress] = useState(0);
  const [archiveStatus, setArchiveStatus] = useState('');
  const [archiveError, setArchiveError] = useState(null);
  const [lastResult, setLastResult] = useState(null);

  // OCR States
  const [ocrScanningMap, setOcrScanningMap] = useState({});
  const [ocrResultsMap, setOcrResultsMap] = useState({});

  // Watcher States
  const [watcherStatus, setWatcherStatus] = useState({ globalEnabled: false, enabledChatIds: [] });
  const [watcherEvent, setWatcherEvent] = useState(null);

  // Review Modal States
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewMessages, setReviewMessages] = useState([]);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState(null);

  // Layout States
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isChatsCollapsed, setIsChatsCollapsed] = useState(false);

  // Load profiles list and active profile
  const loadProfiles = useCallback(async () => {
    if (!window.api) return;
    try {
      const active = await window.api.getActiveProfile();
      const list = await window.api.getProfiles();
      setActiveProfile(active);
      setProfiles(list);
      setVaultPath(active?.vaultPath || null);
    } catch (e) {
      console.error('Failed to load profiles:', e);
    }
  }, []);

  const fetchChats = useCallback(async () => {
    if (!window.api) return;
    setIsLoadingChats(true);
    
    // First, load from local disk cache for instant display
    try {
      const cached = await window.api.getCachedChats(activePlatform);
      if (cached && cached.length > 0) {
        setChats(cached.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)));
        setIsLoadingChats(false); // Instantly hide loader since we have cached data
      }
    } catch (e) {
      console.warn('Failed to load chats from cache:', e);
    }

    // Fetch fresh chats in the background
    try {
      let chatList = [];
      if (activePlatform === 'whatsapp') {
        chatList = await window.api.getChats();
      } else {
        chatList = await window.api.getTelegramChats();
      }
      setChats(chatList.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)));
    } catch (error) {
      setChats(prev => {
        if (prev.length === 0) {
          setArchiveError(error.message || t('chatsLoadError'));
        }
        return prev;
      });
    } finally {
      setIsLoadingChats(false);
    }
  }, [activePlatform, t]);

  // Handle WhatsApp connect/status checks
  const checkWAStatus = useCallback(async () => {
    if (!window.api) return;
    const status = await window.api.getWhatsAppStatus();
    if (status.state === 'READY') {
      setIsAuthenticated(true);
      setAccountInfo(status.info);
      if (activePlatform === 'whatsapp') fetchChats();
      window.api.getWatcherStatus?.('whatsapp').then(setWatcherStatus).catch(() => {});
    } else if (status.state === 'AUTHENTICATED') {
      setIsAuthenticated(true);
    } else if (status.state === 'QR') {
      setQrCode(status.qr);
      setIsAuthenticated(false);
    } else if (status.state === 'DISCONNECTED') {
      setIsAuthenticated(false);
      window.api.connectWhatsApp();
    }
  }, [fetchChats, activePlatform]);

  // Handle Telegram status check
  const checkTGStatus = useCallback(async () => {
    if (!window.api) return;
    const status = await window.api.getTelegramStatus();
    setTgStatus(status);
    if (status.state === 'READY') {
      setIsTGAuthenticated(true);
      if (activePlatform === 'telegram') fetchChats();
      window.api.getWatcherStatus?.('telegram').then(setWatcherStatus).catch(() => {});
    } else {
      setIsTGAuthenticated(false);
      if (activePlatform === 'telegram' && status.state === 'DISCONNECTED') {
        window.api.connectTelegram();
      }
    }
  }, [fetchChats, activePlatform]);

  // Initial load
  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  // Platform switcher effects
  useEffect(() => {
    setChats([]);
    setSelectedChat(null);
    if (activePlatform === 'whatsapp') {
      checkWAStatus();
      window.api.getWatcherStatus?.('whatsapp').then(setWatcherStatus).catch(() => {});
    } else {
      checkTGStatus();
      window.api.getWatcherStatus?.('telegram').then(setWatcherStatus).catch(() => {});
    }
  }, [activePlatform, checkWAStatus, checkTGStatus]);

  // Watch for profile or authentication adjustments
  useEffect(() => {
    if (!window.api) return;

    window.api.onQR((qr) => {
      setQrCode(qr);
      setIsAuthenticated(false);
    });

    window.api.onReady((info) => {
      if (info) setAccountInfo(info);
      setIsAuthenticated(true);
      if (activePlatform === 'whatsapp') fetchChats();
      window.api.getWatcherStatus?.('whatsapp').then(setWatcherStatus).catch(() => {});
    });

    window.api.onAuthenticated(() => setIsAuthenticated(true));

    window.api.onArchiveProgress((data) => {
      setArchiveProgress(data.progress);
      setArchiveStatus(data.status);
      if (data.progress === 100) setIsWorking(false);
    });

    window.api.onArchiveError((error) => {
      setArchiveError(error);
      setIsWorking(false);
    });

    window.api.onWatcherStatus?.((status) => setWatcherStatus(status));
    window.api.onWatcherEvent?.((event) => setWatcherEvent(event));

    window.api.onDisconnected((reason) => {
      console.log('WhatsApp disconnected in UI:', reason);
      setIsAuthenticated(false);
      setAccountInfo(null);
      setQrCode(null);
      if (activePlatform === 'whatsapp') {
        setChats([]);
        setSelectedChat(null);
      }
      setIsWorking(false);
    });

    // Telegram Events
    window.api.onTelegramStatus?.((status) => {
      setTgStatus(status);
      if (status.state === 'READY') {
        setIsTGAuthenticated(true);
        if (activePlatform === 'telegram') fetchChats();
        window.api.getWatcherStatus?.('telegram').then(setWatcherStatus).catch(() => {});
      } else {
        setIsTGAuthenticated(false);
      }
    });

    window.api.onTelegramReady?.((info) => {
      setTgAccountInfo(info);
      setIsTGAuthenticated(true);
      setTgSubmitting(false);
      if (activePlatform === 'telegram') fetchChats();
      window.api.getWatcherStatus?.('telegram').then(setWatcherStatus).catch(() => {});
    });

    window.api.onTelegramError?.((err) => {
      const msg = typeof err === 'string' && err.includes('API_ID_INVALID') ? t('telegramApiInvalid') : err;
      setTgError(msg);
      setTgSubmitting(false);
    });

    window.api.onTelegramNeedPhone?.(() => {
      setTgStatus({ state: 'NEED_PHONE' });
      setTgSubmitting(false);
    });
    window.api.onTelegramNeedCode?.(() => {
      setTgStatus({ state: 'NEED_CODE' });
      setTgSubmitting(false);
    });
    window.api.onTelegramNeed2FA?.(() => {
      setTgStatus({ state: 'NEED_2FA' });
      setTgSubmitting(false);
    });

    window.api.onTelegramDisconnected?.(() => {
      setIsTGAuthenticated(false);
      setTgAccountInfo(null);
      if (activePlatform === 'telegram') {
        setChats([]);
        setSelectedChat(null);
      }
    });

    return () => window.api.removeListeners();
  }, [fetchChats, activePlatform]);

  // Connect once profiles are loaded
  useEffect(() => {
    if (activeProfile) {
      if (activePlatform === 'whatsapp') {
        checkWAStatus();
      } else {
        checkTGStatus();
      }
    }
  }, [activeProfile, activePlatform, checkWAStatus, checkTGStatus]);

  const filteredChats = useMemo(() => {
    const query = chatQuery.trim().toLowerCase();
    return chats.filter((chat) => {
      const matchesQuery = !query || chat.name?.toLowerCase().includes(query);
      const matchesFilter = chatFilter === 'all'
        || (chatFilter === 'groups' && chat.isGroup)
        || (chatFilter === 'contacts' && !chat.isGroup)
        || (chatFilter === 'archived' && chat.archived);
      return matchesQuery && matchesFilter;
    });
  }, [chats, chatFilter, chatQuery]);

  const selectedWatcherEnabled = !!(selectedChat && watcherStatus.enabledChatIds?.includes(selectedChat.id));

  const runJob = async (label, job) => {
    if (!selectedChat || !vaultPath || isWorking) return;
    setIsWorking(true);
    setArchiveError(null);
    setLastResult(null);
    setArchiveProgress(0);
    setArchiveStatus(label);
    try {
      const result = await job();
      setLastResult(result);
    } catch (error) {
      setArchiveError(error.message || t('archivingError'));
      setIsWorking(false);
    }
  };

  const handleSelectVault = async () => {
    if (!window.api) return;
    const selected = await window.api.selectVault();
    if (selected) {
      setVaultPath(selected);
      // Update profile's vaultPath
      if (activeProfile) {
        const updated = await window.api.updateProfile(activeProfile.id, { vaultPath: selected });
        setActiveProfile(updated);
        setProfiles(profiles.map(p => p.id === updated.id ? updated : p));
      }
      if (watcherStatus.globalEnabled) {
        window.api.setWatcherGlobalEnabled?.(true, selected).then(setWatcherStatus).catch(() => {});
      }
    }
  };

  const handleBrowseProfileVault = async () => {
    if (!window.api) return;
    const selected = await window.api.selectVault();
    if (selected) {
      setProfVault(selected);
    }
  };

  const handleLogout = async () => {
    if (activePlatform === 'whatsapp') {
      await window.api.logout();
      setIsAuthenticated(false);
      setAccountInfo(null);
      setQrCode(null);
    } else {
      await window.api.logoutTelegram?.();
      setIsTGAuthenticated(false);
      setTgAccountInfo(null);
    }
    setChats([]);
    setSelectedChat(null);
  };

  const handleReviewChat = async () => {
    if (!window.api || !selectedChat) return;
    setReviewOpen(true);
    setReviewLoading(true);
    setReviewError(null);
    try {
      // Review loads same messages list DTO
      const messages = await window.api.getChatMessages(selectedChat.id, { limit: 300 });
      setReviewMessages(messages);
      
      const initialOcr = {};
      messages.forEach(msg => {
        if (msg.ocr) {
          initialOcr[msg.id] = msg.ocr;
        }
      });
      setOcrResultsMap(initialOcr);
    } catch (error) {
      setReviewError(error.message || t('reviewError'));
    } finally {
      setReviewLoading(false);
    }
  };

  const handleRunOCRForMessage = async (messageId) => {
    if (!selectedChat || !vaultPath || !window.api) return;
    setOcrScanningMap(prev => ({ ...prev, [messageId]: true }));
    try {
      const res = await window.api.ocrScanMessage(selectedChat.id, messageId, vaultPath);
      if (res.success && res.ocrData) {
        setOcrResultsMap(prev => ({ ...prev, [messageId]: res.ocrData }));
        setReviewMessages(prev => prev.map(m => m.id === messageId ? { ...m, ocr: res.ocrData } : m));
      } else {
        alert(res.error || 'OCR scanning failed.');
      }
    } catch (err) {
      alert(err.message || 'OCR scanning failed.');
    } finally {
      setOcrScanningMap(prev => ({ ...prev, [messageId]: false }));
    }
  };

  const handleWatcherToggle = async () => {
    if (!selectedChat || !vaultPath || !window.api) return;
    const next = !selectedWatcherEnabled;
    const status = await window.api.setWatcherChatEnabled(selectedChat.id, vaultPath, next);
    setWatcherStatus(status);
  };

  const handleSwitchProfile = async (id) => {
    setProfileDropdownOpen(false);
    setIsLoadingChats(true);
    try {
      const switched = await window.api.switchProfile(id);
      setActiveProfile(switched);
      setVaultPath(switched.vaultPath);
      
      // Clear UI states
      setChats([]);
      setSelectedChat(null);
      setQrCode(null);
      setIsAuthenticated(false);
      setAccountInfo(null);
      setIsTGAuthenticated(false);
      setTgAccountInfo(null);

      // Connect new profile on the active platform
      if (activePlatform === 'whatsapp') {
        await checkWAStatus();
      } else {
        await checkTGStatus();
      }
    } catch (err) {
      console.error('Error switching profile:', err);
    } finally {
      setIsLoadingChats(false);
    }
  };

  const handleOpenProfilesModal = () => {
    setProfileDropdownOpen(false);
    setEditingProfile(null);
    setProfName('');
    setProfVault(activeProfile?.vaultPath || '');
    setProfIcon('user');
    setProfColor('#10b981');
    setProfileModalOpen(true);
  };

  const handleCreateProfile = async (e) => {
    e.preventDefault();
    if (!profName.trim() || !window.api) return;

    try {
      const newP = await window.api.createProfile(profName, profVault || null, profIcon, profColor);
      const list = await window.api.getProfiles();
      setProfiles(list);
      
      // Switch to new profile
      handleSwitchProfile(newP.id);
      setProfileModalOpen(false);
    } catch (err) {
      console.error('Error creating profile:', err);
    }
  };

  const handleEditProfile = (profile) => {
    setEditingProfile(profile);
    setProfName(profile.name);
    setProfVault(profile.vaultPath || '');
    setProfIcon(profile.icon || 'user');
    setProfColor(profile.color || '#10b981');
  };

  const handleUpdateProfile = async (e) => {
    e.preventDefault();
    if (!editingProfile || !profName.trim() || !window.api) return;

    try {
      const updated = await window.api.updateProfile(editingProfile.id, {
        name: profName,
        vaultPath: profVault || null,
        icon: profIcon,
        color: profColor,
      });

      const list = await window.api.getProfiles();
      setProfiles(list);

      if (activeProfile?.id === editingProfile.id) {
        setActiveProfile(updated);
        setVaultPath(updated.vaultPath);
      }

      setEditingProfile(null);
      setProfName('');
      setProfVault('');
    } catch (err) {
      console.error('Error updating profile:', err);
    }
  };

  const handleDeleteProfile = async (id) => {
    if (id === 'default' || !window.api) return;
    if (confirm(t('deleteProfile') + '?')) {
      try {
        await window.api.deleteProfile(id);
        const list = await window.api.getProfiles();
        setProfiles(list);
        if (activeProfile?.id === id) {
          handleSwitchProfile('default');
        }
      } catch (err) {
        console.error('Error deleting profile:', err);
      }
    }
  };

  // Telegram Auth Actions
  const handleTelegramPhoneSubmit = async (e) => {
    e.preventDefault();
    if (!tgPhone.trim() || !window.api || tgSubmitting) return;
    setTgError(null);
    setTgSubmitting(true);
    setTgStatus((prev) => ({ ...prev, state: 'STARTING' }));
    try {
      window.api.connectTelegram().catch((err) => {
        console.error('Telegram connect failed:', err);
        const msg = err?.message?.includes?.('API_ID_INVALID') ? t('telegramApiInvalid') : (err?.message || 'Failed to connect to Telegram');
        setTgError(msg);
        setTgSubmitting(false);
      });
      await window.api.submitTelegramPhone(tgPhone.trim());
    } catch (err) {
      const msg = err?.message?.includes?.('API_ID_INVALID') ? t('telegramApiInvalid') : (err?.message || 'Failed to send phone number');
      setTgError(msg);
      setTgSubmitting(false);
    }
  };

  const handleTelegramCodeSubmit = async (e) => {
    e.preventDefault();
    if (!tgCode.trim() || !window.api || tgSubmitting) return;
    setTgError(null);
    setTgSubmitting(true);
    try {
      await window.api.submitTelegramCode(tgCode.trim());
    } catch (err) {
      setTgError(err?.message || 'Failed to send verification code');
    } finally {
      setTgSubmitting(false);
    }
  };

  const handleTelegram2FASubmit = async (e) => {
    e.preventDefault();
    if (!tgPassword.trim() || !window.api || tgSubmitting) return;
    setTgError(null);
    setTgSubmitting(true);
    try {
      await window.api.submitTelegram2FA(tgPassword.trim());
    } catch (err) {
      setTgError(err?.message || 'Failed to send password');
    } finally {
      setTgSubmitting(false);
    }
  };

  const commandDisabled = !selectedChat || !vaultPath || isWorking;
  const isPlatformAuthenticated = activePlatform === 'whatsapp' ? isAuthenticated : isTGAuthenticated;

  return (
    <div className="h-screen w-screen bg-slate-950 text-slate-100 overflow-hidden selection:bg-emerald-500/30 font-sans flex" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Sidebar Panel */}
      <aside
        className={`transition-[width] duration-300 ease-in-out h-full flex flex-col z-20 relative glass-panel shrink-0 ${
          isSidebarCollapsed ? 'w-16' : 'w-[280px]'
        }`}
      >
        {isSidebarCollapsed ? (
          <button className="h-full w-full flex justify-center pt-6 hover:bg-white/5 cursor-pointer text-slate-400 hover:text-emerald-300" onClick={() => setIsSidebarCollapsed(false)} aria-label={t('expandSidebar')}>
            {isRtl ? <ChevronLeft size={24} /> : <ChevronRight size={24} />}
          </button>
        ) : (
          <div className="flex flex-col h-full w-full overflow-hidden">
            {/* Header / Logo */}
            <div className="p-5 border-b border-white/10">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-lg overflow-hidden flex items-center justify-center shrink-0 bg-slate-950 border border-white/10">
                    <img src="/ledgerlink_logo.png" alt="LedgerLink Logo" className="w-full h-full object-cover" />
                  </div>
                  <div className="min-w-0">
                    <h1 className="font-bold text-lg truncate">{t('appTitle')}</h1>
                    <p className="text-xs text-slate-400 truncate">{t('appSubtitle')}</p>
                  </div>
                </div>
                <button className="icon-button" onClick={() => setIsSidebarCollapsed(true)} aria-label={t('collapseSidebar')}>
                  {isRtl ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
                </button>
              </div>
              <button onClick={toggleLanguage} className="mt-3 w-full toolbar-button justify-center gap-2">
                <span className="text-lg leading-none">{lang === 'en' ? '🇸🇦' : '🇺🇸'}</span>
                <span>{lang === 'en' ? 'العربية' : 'English'}</span>
              </button>
            </div>

            <div className="p-5 flex-1 flex flex-col gap-5 overflow-y-auto custom-scrollbar">
              {/* Profile / Account Selector Dropdown */}
              <section className="space-y-2 relative">
                <h2 className="section-label">{t('activeProfile')}</h2>
                <div className="relative">
                  <button
                    onClick={() => setProfileDropdownOpen(!profileDropdownOpen)}
                    className="surface-button w-full flex items-center justify-between gap-2 text-start focus:ring-2 focus:ring-emerald-500/50"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded bg-slate-900 border border-white/10 flex items-center justify-center shrink-0">
                        {activeProfile && (
                          <ProfileIcon name={activeProfile.icon || 'user'} color={activeProfile.color || '#10b981'} className="w-4 h-4" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <span className="text-sm font-semibold block truncate">
                          {activeProfile?.name || t('defaultAccount')}
                        </span>
                      </div>
                    </div>
                    <ChevronRight size={16} className={`text-slate-400 transition-transform ${profileDropdownOpen ? 'rotate-90' : ''}`} />
                  </button>

                  {profileDropdownOpen && (
                    <div className="absolute top-full left-0 right-0 mt-2 bg-slate-900 border border-white/10 rounded-lg shadow-2xl z-30 py-1.5 overflow-hidden">
                      <div className="max-h-60 overflow-y-auto custom-scrollbar">
                        {profiles.map((p) => (
                          <button
                            key={p.id}
                            onClick={() => handleSwitchProfile(p.id)}
                            className={`w-full text-start px-3 py-2 text-xs flex items-center justify-between hover:bg-white/5 ${
                              activeProfile?.id === p.id ? 'text-emerald-400 font-semibold' : 'text-slate-300'
                            }`}
                          >
                            <div className="flex items-center gap-2 truncate">
                              <ProfileIcon name={p.icon || 'user'} color={p.color || '#10b981'} className="w-3.5 h-3.5" />
                              <span className="truncate">{p.name}</span>
                            </div>
                            {activeProfile?.id === p.id && <Check size={14} className="text-emerald-400" />}
                          </button>
                        ))}
                      </div>
                      <div className="border-t border-white/10 mt-1.5 pt-1.5 px-1.5">
                        <button
                          onClick={handleOpenProfilesModal}
                          className="w-full flex items-center justify-center gap-2 py-1.5 text-xs text-slate-400 hover:text-emerald-300 hover:bg-white/5 rounded"
                        >
                          <Settings size={14} />
                          {t('manageProfiles')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </section>

              {/* Storage Location */}
              <section className="space-y-2">
                <h2 className="section-label">{t('storageLocation')}</h2>
                <button onClick={handleSelectVault} className="surface-button w-full text-start">
                  <div className="flex items-center gap-2 text-emerald-300">
                    <HardDrive size={16} />
                    <span className="font-semibold text-sm">{t('obsidianVault')}</span>
                  </div>
                  <p className="text-xs text-slate-400 mt-2 truncate">{vaultPath || t('noVaultSelected')}</p>
                </button>
              </section>

              {/* Messaging platform Connection */}
              <section className="space-y-2">
                <h2 className="section-label">
                  {activePlatform === 'whatsapp' ? t('whatsappConnection') : t('telegramConnection')}
                </h2>
                <div className={`surface-panel ${isPlatformAuthenticated ? 'border-emerald-500/30' : 'border-amber-500/30'}`}>
                  <div className="w-10 h-10 rounded-full overflow-hidden flex items-center justify-center shrink-0 bg-slate-800 border border-white/10">
                    {activePlatform === 'whatsapp' ? (
                      isAuthenticated && accountInfo?.profilePicUrl ? (
                        <img src={accountInfo.profilePicUrl} alt={accountInfo.pushname || 'Account'} className="w-full h-full object-cover" />
                      ) : isAuthenticated ? (
                        <CheckCircle2 size={20} className="text-emerald-400" />
                      ) : (
                        <Smartphone size={20} className="text-amber-400" />
                      )
                    ) : (
                      isTGAuthenticated ? (
                        <CheckCircle2 size={20} className="text-emerald-400" />
                      ) : (
                        <Smartphone size={20} className="text-amber-400" />
                      )
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate">
                      {activePlatform === 'whatsapp' 
                        ? (accountInfo?.pushname || (isAuthenticated ? t('connectedSecurely') : t('waitingForLogin')))
                        : (tgAccountInfo?.username || (isTGAuthenticated ? t('connectedSecurely') : t('waitingForLogin')))}
                    </p>
                    <p className="text-xs text-slate-400 truncate">
                      {activePlatform === 'whatsapp' 
                        ? (watcherStatus.globalEnabled ? t('watcherOn') : t('watcherOff'))
                        : t('watcherOff')}
                    </p>
                  </div>
                </div>
              </section>

              {activePlatform === 'whatsapp' && watcherEvent && (
                <section className="space-y-2">
                  <h2 className="section-label">{t('lastWatcherEvent')}</h2>
                  <div className="surface-button text-xs text-slate-300">
                    <p className="font-semibold text-slate-100">{watcherEvent.status}</p>
                    <p className="truncate">{watcherEvent.error || watcherEvent.chatId}</p>
                  </div>
                </section>
              )}
            </div>

            {isPlatformAuthenticated && (
              <div className="p-4 border-t border-white/10">
                <button onClick={handleLogout} className="toolbar-button w-full justify-center text-rose-400 hover:bg-rose-500/10 hover:border-rose-500/30">
                  <LogOut size={16} />
                  {t('disconnectAccount')}
                </button>
              </div>
            )}
          </div>
        )}
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 h-full flex overflow-hidden relative">
        {!isPlatformAuthenticated ? (
          <div className="flex-1 flex items-center justify-center p-8 bg-slate-950">
            {activePlatform === 'whatsapp' ? (
              /* WhatsApp Login */
              <div className="surface-card max-w-md w-full p-10 text-center">
                <div className="w-14 h-14 rounded-xl bg-slate-800 mx-auto flex items-center justify-center mb-5 border border-white/10">
                  <Smartphone size={30} className="text-emerald-300" />
                </div>
                <h2 className="text-2xl font-bold mb-2">{t('linkDevice')}</h2>
                <p className="text-sm text-slate-400 mb-8">{t('linkInstructions')}</p>
                {qrCode ? (
                  <div className="bg-white p-4 rounded-lg inline-block border-2 border-emerald-500">
                    <QRCodeSVG value={qrCode} size={220} />
                  </div>
                ) : (
                  <div className="w-[252px] h-[252px] mx-auto bg-slate-900 border border-white/10 rounded-lg flex items-center justify-center">
                    <Loader2 size={32} className="animate-spin text-emerald-300" />
                  </div>
                )}
              </div>
            ) : (
              /* Telegram Login Multi-Step Form */
              <div className="surface-card max-w-md w-full p-10">
                <div className="w-14 h-14 rounded-xl bg-slate-800 mx-auto flex items-center justify-center mb-5 border border-white/10 text-emerald-300">
                  <Send size={26} className="rotate-[-20deg]" />
                </div>
                <h2 className="text-2xl font-bold text-center mb-2">{t('connectTelegram')}</h2>
                <p className="text-sm text-slate-400 text-center mb-6">
                  Sign in with your phone number to authorize Telegram chat archiving.
                </p>

                {tgError && (
                  <div role="alert" className="error-banner mb-5 p-3 rounded-lg text-xs">
                    <AlertCircle size={14} className="shrink-0" />
                    <span>{tgError}</span>
                  </div>
                )}

                {/* Step 1: Input Phone */}
                {(tgStatus.state === 'DISCONNECTED' || tgStatus.state === 'STARTING' || tgStatus.state === 'NEED_PHONE') && (
                  <form onSubmit={handleTelegramPhoneSubmit} className="space-y-4">
                    <div className="space-y-1">
                      <label className="text-xs text-slate-400">{t('phoneNumber')}</label>
                      <input
                        type="text"
                        required
                        placeholder="+966XXXXXXXXX"
                        value={tgPhone}
                        onChange={(e) => setTgPhone(e.target.value)}
                        className="w-full px-3 py-2 text-sm bg-slate-900 border border-white/10 rounded-lg outline-none text-slate-100 focus:ring-1 focus:ring-emerald-500"
                      />
                    </div>
                    <button type="submit" disabled={tgSubmitting} className="primary-command w-full justify-center py-2.5 font-bold disabled:opacity-60">
                      {tgSubmitting || tgStatus.state === 'STARTING' ? <Loader2 size={16} className="animate-spin" /> : t('submit')}
                    </button>
                  </form>
                )}

                {/* Step 2: Input Code */}
                {tgStatus.state === 'NEED_CODE' && (
                  <form onSubmit={handleTelegramCodeSubmit} className="space-y-4">
                    <div className="space-y-1">
                      <label className="text-xs text-slate-400">{t('verificationCode')}</label>
                      <input
                        type="text"
                        required
                        placeholder="12345"
                        value={tgCode}
                        onChange={(e) => setTgCode(e.target.value)}
                        className="w-full px-3 py-2 text-sm bg-slate-900 border border-white/10 rounded-lg outline-none text-slate-100 focus:ring-1 focus:ring-emerald-500 text-center font-mono tracking-widest text-lg"
                      />
                    </div>
                    <button type="submit" disabled={tgSubmitting} className="primary-command w-full justify-center py-2.5 font-bold disabled:opacity-60">
                      {tgSubmitting ? <Loader2 size={16} className="animate-spin" /> : t('submit')}
                    </button>
                  </form>
                )}

                {/* Step 3: Input Password (2FA) */}
                {tgStatus.state === 'NEED_2FA' && (
                  <form onSubmit={handleTelegram2FASubmit} className="space-y-4">
                    <div className="space-y-1">
                      <label className="text-xs text-slate-400">{t('twoFactorPassword')}</label>
                      <input
                        type="password"
                        required
                        value={tgPassword}
                        onChange={(e) => setTgPassword(e.target.value)}
                        className="w-full px-3 py-2 text-sm bg-slate-900 border border-white/10 rounded-lg outline-none text-slate-100 focus:ring-1 focus:ring-emerald-500"
                      />
                    </div>
                    <button type="submit" disabled={tgSubmitting} className="primary-command w-full justify-center py-2.5 font-bold disabled:opacity-60">
                      {tgSubmitting ? <Loader2 size={16} className="animate-spin" /> : t('submit')}
                    </button>
                  </form>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 h-full flex overflow-hidden">
            {/* Chats List Panel */}
            <section
              className={`transition-[width] duration-300 ease-in-out h-full flex flex-col border-e border-white/10 bg-slate-950 shrink-0 ${
                isChatsCollapsed ? 'w-16' : 'w-[340px]'
              }`}
            >
              {isChatsCollapsed ? (
                <button className="h-full w-full flex justify-center pt-6 hover:bg-white/5 cursor-pointer text-slate-400 hover:text-emerald-300" onClick={() => setIsChatsCollapsed(false)} aria-label={t('expandChats')}>
                  {isRtl ? <ChevronLeft size={24} /> : <ChevronRight size={24} />}
                </button>
              ) : (
                <div className="flex flex-col h-full w-full overflow-hidden">
                  <div className="p-4 border-b border-white/10 space-y-3">
                    {/* Platform Selector Tabs */}
                    <div className="flex bg-slate-900 p-0.5 rounded-lg border border-white/5">
                      <button
                        onClick={() => setActivePlatform('whatsapp')}
                        className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-semibold rounded-md transition-all ${
                          activePlatform === 'whatsapp' 
                            ? 'bg-emerald-600 text-white shadow-sm' 
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <MessageCircle size={14} />
                        WhatsApp
                      </button>
                      <button
                        onClick={() => setActivePlatform('telegram')}
                        className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-semibold rounded-md transition-all ${
                          activePlatform === 'telegram' 
                            ? 'bg-sky-600 text-white shadow-sm' 
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <Send size={14} className="rotate-[-20deg]" />
                        Telegram
                      </button>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-1">
                      <h2 className="font-semibold text-sm uppercase tracking-wide text-slate-300">{t('chats')}</h2>
                      <div className="flex gap-2">
                        <button onClick={fetchChats} className="icon-button" aria-label={t('refreshChats')}>
                          <RefreshCw size={17} className={isLoadingChats ? 'animate-spin' : ''} />
                        </button>
                        <button onClick={() => setIsChatsCollapsed(true)} className="icon-button" aria-label={t('collapseChats')}>
                          {isRtl ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
                        </button>
                      </div>
                    </div>
                    <label className="search-field">
                      <Search size={16} />
                      <input value={chatQuery} onChange={(event) => setChatQuery(event.target.value)} placeholder={t('searchChats')} />
                    </label>
                    <div className="segmented-control">
                      {chatFilters.map((filter) => (
                        <button key={filter} onClick={() => setChatFilter(filter)} className={chatFilter === filter ? 'active' : ''}>
                          {t(filter)}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
                    {isLoadingChats && !chats.length ? (
                      <div className="p-3 space-y-2">
                        {[0, 1, 2, 3, 4].map((item) => <div key={item} className="skeleton-row" />)}
                      </div>
                    ) : filteredChats.length ? (
                      filteredChats.map((chat) => (
                        <button
                          key={chat.id}
                          onClick={() => setSelectedChat(chat)}
                          disabled={isWorking}
                          className={`chat-row ${selectedChat?.id === chat.id ? 'active' : ''}`}
                        >
                          <div className="chat-row-icon">
                            <ChatIcon chat={chat} />
                            <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full border border-slate-950 bg-slate-900 flex items-center justify-center">
                              {activePlatform === 'whatsapp' ? (
                                <span className="text-[9px] text-emerald-400">W</span>
                              ) : (
                                <span className="text-[9px] text-sky-400">T</span>
                              )}
                            </div>
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate font-medium">{chat.name || t('unnamedChat')}</span>
                              {chat.unreadCount > 0 && <span className="status-pill">{chat.unreadCount}</span>}
                            </div>
                            <div className="flex items-center justify-between gap-2 text-xs text-slate-500 mt-1">
                              <span>{chat.typeLabel || (chat.isGroup ? t('group') : t('contact'))}</span>
                              <span>{formatChatDate(chat.timestamp)}</span>
                            </div>
                          </div>
                        </button>
                      ))
                    ) : (
                      <div className="empty-state">
                        <Search size={28} />
                        <p>{t('noChatsFound')}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </section>

            {/* Workspace Panel */}
            <section className="flex-1 h-full flex flex-col overflow-y-auto custom-scrollbar p-6 bg-slate-950/80">
              {!selectedChat ? (
                <div className="m-auto text-center max-w-md">
                  <div className="w-20 h-20 rounded-2xl bg-slate-900 border border-white/10 mx-auto flex items-center justify-center mb-6">
                    {activePlatform === 'whatsapp' ? (
                      <MessageCircle size={34} className="text-emerald-300" />
                    ) : (
                      <Send size={34} className="text-sky-300 rotate-[-20deg]" />
                    )}
                  </div>
                  <h2 className="text-2xl font-bold mb-2">{t('selectWorkspace')}</h2>
                  <p className="text-sm text-slate-400">{t('selectWorkspaceDesc')}</p>
                </div>
              ) : (
                <div className="max-w-4xl w-full mx-auto space-y-5">
                  <section className="surface-card p-6">
                    <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-3 mb-3">
                          <div className="chat-row-icon"><ChatIcon chat={selectedChat} /></div>
                          <div className="min-w-0">
                            <h2 className="text-2xl font-bold truncate">{selectedChat.name}</h2>
                            <p className="text-sm text-slate-400">{selectedChat.typeLabel || (selectedChat.isGroup ? t('group') : t('contact'))} · {formatChatDate(selectedChat.timestamp)}</p>
                          </div>
                        </div>
                        <p className="text-xs text-slate-500 truncate">{vaultPath || t('noVaultSelected')}</p>
                      </div>
                      
                      <button onClick={handleWatcherToggle} disabled={!vaultPath || isWorking} className={`toolbar-button ${selectedWatcherEnabled ? 'watch-on' : ''}`}>
                        {selectedWatcherEnabled ? <Bell size={17} /> : <BellOff size={17} />}
                        {selectedWatcherEnabled ? t('autoArchiveOn') : t('autoArchiveOff')}
                      </button>
                    </div>

                    <div className="command-grid mt-6">
                      <button 
                        disabled={commandDisabled} 
                        onClick={() => runJob(
                          t('startingArchive'), 
                          () => activePlatform === 'whatsapp' 
                            ? window.api.archiveChat(selectedChat.id, vaultPath)
                            : window.api.archiveTelegramChat(selectedChat.id, vaultPath)
                        )} 
                        className="primary-command"
                        style={{ backgroundColor: activePlatform === 'telegram' ? '#0284c7' : undefined }}
                      >
                        <Download size={18} />
                        {t('startArchive')}
                      </button>
                      <button disabled={!selectedChat || reviewLoading} onClick={handleReviewChat} className="toolbar-button">
                        <Eye size={18} />
                        {t('reviewChat')}
                      </button>
                      
                      {activePlatform === 'whatsapp' && (
                        <>
                          <button disabled={commandDisabled} onClick={() => runJob(t('repairingArchive'), () => window.api.repairArchive(selectedChat.id, vaultPath))} className="toolbar-button">
                            <Wrench size={18} />
                            {t('repairArchive')}
                          </button>
                          <button disabled={commandDisabled} onClick={() => runJob(t('waitingForFile'), () => window.api.importHistory(selectedChat.name, vaultPath))} className="toolbar-button">
                            <Folder size={18} />
                            {t('importExport')}
                          </button>
                        </>
                      )}
                      
                      <button disabled={!vaultPath} onClick={() => window.api.openInObsidian(vaultPath)} className="toolbar-button">
                        <ExternalLink size={18} />
                        {t('openInObsidian')}
                      </button>
                    </div>
                  </section>

                  {(isWorking || archiveProgress === 100 || archiveError || lastResult) && (
                    <section className="surface-card p-6">
                      <div className="flex items-end justify-between gap-4 mb-4">
                        <div className="min-w-0">
                          <h3 className="font-semibold">{t('archiveProgress')}</h3>
                          <p className="text-sm text-emerald-300 truncate">{archiveStatus}</p>
                        </div>
                        <span className="text-2xl font-bold">{Math.round(archiveProgress)}%</span>
                      </div>
                      <div className="progress-track" style={{ backgroundColor: activePlatform === 'telegram' ? 'rgba(2, 132, 199, 0.2)' : undefined }}>
                        <div style={{ 
                          width: `${archiveProgress}%`,
                          backgroundColor: activePlatform === 'telegram' ? '#0284c7' : undefined 
                        }} />
                      </div>
                      {archiveError && (
                        <div role="alert" className="error-banner">
                          <AlertCircle size={18} />
                          <span>{archiveError}</span>
                        </div>
                      )}
                      {lastResult && !archiveError && (
                        <div className="success-banner">
                          <CheckCircle2 size={18} />
                          <span>{t('vaultUpdated')}</span>
                        </div>
                      )}
                    </section>
                  )}
                </div>
              )}
            </section>
          </div>
        )}
      </main>

      {/* Accounts / Profiles Manager Modal */}
      {profileModalOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="modal-profiles-title">
          <div className="review-modal max-w-2xl">
            <div className="review-header">
              <div className="flex items-center gap-2">
                <Settings size={20} className="text-emerald-400" />
                <h2 id="modal-profiles-title" className="font-bold text-lg">{t('manageProfiles')}</h2>
              </div>
              <button className="icon-button" onClick={() => setProfileModalOpen(false)} aria-label={t('close')}>
                <X size={18} />
              </button>
            </div>
            
            <div className="review-body p-6 flex flex-col md:flex-row gap-6 custom-scrollbar">
              {/* Profiles List */}
              <div className="flex-1 space-y-3">
                <h3 className="text-xs uppercase font-bold tracking-wider text-slate-500">{t('profiles')}</h3>
                <div className="space-y-2 overflow-y-auto max-h-[300px] pr-2 custom-scrollbar">
                  {profiles.map((p) => (
                    <div
                      key={p.id}
                      className={`p-3 rounded-lg border flex items-center justify-between gap-3 ${
                        editingProfile?.id === p.id 
                          ? 'bg-emerald-500/5 border-emerald-500' 
                          : activeProfile?.id === p.id 
                            ? 'bg-slate-900 border-white/20' 
                            : 'bg-slate-900/50 border-white/5'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded border border-white/10 bg-slate-950 flex items-center justify-center shrink-0">
                          <ProfileIcon name={p.icon || 'user'} color={p.color || '#10b981'} className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold truncate flex items-center gap-1.5">
                            {p.name}
                            {activeProfile?.id === p.id && (
                              <span className="text-[10px] bg-emerald-500/20 text-emerald-300 font-normal px-1.5 py-0.5 rounded border border-emerald-500/30">
                                Active
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-slate-500 truncate mt-0.5">{p.vaultPath || 'No vault configured'}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleEditProfile(p)}
                          className="p-1.5 text-slate-400 hover:text-emerald-400 hover:bg-white/5 rounded"
                          title={t('editProfile')}
                        >
                          <Wrench size={14} />
                        </button>
                        {p.id !== 'default' && (
                          <button
                            onClick={() => handleDeleteProfile(p.id)}
                            className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-white/5 rounded"
                            title={t('deleteProfile')}
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                
                {/* Create New Trigger */}
                {!editingProfile && (
                  <button
                    onClick={() => {
                      setEditingProfile(null);
                      setProfName('');
                      setProfVault('');
                      setProfIcon('user');
                      setProfColor('#10b981');
                    }}
                    className="w-full py-2.5 border border-dashed border-white/10 hover:border-emerald-500/50 hover:bg-emerald-500/5 rounded-lg flex items-center justify-center gap-2 text-sm font-semibold text-slate-300 hover:text-emerald-400 transition-colors"
                  >
                    <Plus size={16} />
                    {t('createProfile')}
                  </button>
                )}
              </div>

              {/* Edit / Create Panel */}
              <div className="w-full md:w-[260px] border-t md:border-t-0 md:border-s border-white/10 pt-5 md:pt-0 md:ps-6">
                <h3 className="text-xs uppercase font-bold tracking-wider text-slate-500 mb-3">
                  {editingProfile ? t('editProfile') : t('createProfile')}
                </h3>
                <form onSubmit={editingProfile ? handleUpdateProfile : handleCreateProfile} className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">{t('profileName')}</label>
                    <input
                      type="text"
                      required
                      value={profName}
                      onChange={(e) => setProfName(e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-slate-900 border border-white/10 rounded-lg focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 outline-none text-slate-100"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">{t('obsidianVault')}</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        readOnly
                        value={profVault}
                        placeholder="No vault path chosen"
                        className="flex-1 px-3 py-2 text-xs bg-slate-900/50 border border-white/15 rounded-lg outline-none text-slate-300 truncate"
                      />
                      <button
                        type="button"
                        onClick={handleBrowseProfileVault}
                        className="px-2.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 border border-white/15 rounded-lg shrink-0"
                      >
                        ...
                      </button>
                    </div>
                  </div>

                  {/* Icon Selector */}
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400 block mb-1">{t('profileIcon')}</label>
                    <div className="flex gap-2">
                      {PROFILE_ICONS.map((ico) => {
                        const IconComp = ico.component;
                        return (
                          <button
                            key={ico.name}
                            type="button"
                            onClick={() => setProfIcon(ico.name)}
                            className={`p-2 rounded-lg border flex-1 flex justify-center transition-all ${
                              profIcon === ico.name 
                                ? 'bg-emerald-500/10 border-emerald-500 text-emerald-400' 
                                : 'bg-slate-900 border-white/10 text-slate-400 hover:border-white/20'
                            }`}
                          >
                            <IconComp size={16} />
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Color Selector */}
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400 block mb-1">{t('profileColor')}</label>
                    <div className="flex gap-2 justify-between">
                      {PROFILE_COLORS.map((col) => (
                        <button
                          key={col.value}
                          type="button"
                          onClick={() => setProfColor(col.value)}
                          className="w-7 h-7 rounded-full border border-slate-950 flex items-center justify-center relative shadow"
                          style={{ backgroundColor: col.value }}
                        >
                          {profColor === col.value && (
                            <Check size={14} className="text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]" />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="pt-2 flex gap-2">
                    {editingProfile && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingProfile(null);
                          setProfName('');
                          setProfVault('');
                        }}
                        className="flex-1 py-2 text-xs font-semibold bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300"
                      >
                        {t('cancel')}
                      </button>
                    )}
                    <button
                      type="submit"
                      className="flex-1 py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 rounded-lg text-white font-medium"
                    >
                      {editingProfile ? t('save') : t('save')}
                    </button>
                  </div>
                </form>
            </div>
          </div>
        </div>
      </div>
    )}

      {/* Review Modal */}
      {reviewOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="review-title">
          <div className="review-modal">
            <div className="review-header">
              <div className="min-w-0">
                <h2 id="review-title" className="font-bold truncate">{selectedChat?.name}</h2>
                <p className="text-xs text-slate-400">{t('originalChatStream')}</p>
              </div>
              <button className="icon-button" onClick={() => setReviewOpen(false)} aria-label={t('close')}>
                <X size={18} />
              </button>
            </div>
            <div className="review-body custom-scrollbar">
              {reviewLoading ? (
                <div className="empty-state"><Loader2 size={28} className="animate-spin text-emerald-300" /><p>{t('loadingMessages')}</p></div>
              ) : reviewError ? (
                <div role="alert" className="error-banner"><AlertCircle size={18} /><span>{reviewError}</span></div>
              ) : (
                reviewMessages.map((message) => (
                  <article key={message.id} className={`message-row ${message.fromMe ? 'from-me' : ''}`}>
                    <div className="message-meta">
                      <span className="font-semibold">{message.senderName}</span>
                      <span>{message.displayTime}</span>
                    </div>
                    <div className="message-body">
                      {message.hasMedia && <p className="media-placeholder">{t('mediaMessage')} · {message.type}</p>}
                      {message.body ? <p>{message.body}</p> : !message.hasMedia && <p className="text-slate-500">{t('emptyMessage')}</p>}
                      
                      {message.type === 'image' && (
                        <div className="mt-2 flex flex-col gap-2">
                          <button
                            onClick={() => handleRunOCRForMessage(message.id)}
                            disabled={ocrScanningMap[message.id]}
                            className="toolbar-button text-xs py-1.5 px-3 self-start flex items-center gap-1.5 bg-slate-800 hover:bg-emerald-500/10 hover:border-emerald-500/30"
                          >
                            {ocrScanningMap[message.id] ? (
                              <Loader2 size={12} className="animate-spin text-emerald-300" />
                            ) : (
                              <Eye size={12} className="text-emerald-300" />
                            )}
                            {ocrScanningMap[message.id] ? t('processingOCR') : t('runOCR')}
                          </button>
                          
                          {ocrResultsMap[message.id] && (
                            <div className="text-xs p-3 rounded bg-slate-900/50 border border-white/5 space-y-1.5 max-w-lg mt-1" dir="auto">
                              <p className="font-semibold text-emerald-400 flex items-center gap-1">
                                <CheckCircle2 size={12} /> {t('ocrSuccess')} ({ocrResultsMap[message.id].confidence}%)
                              </p>
                              {ocrResultsMap[message.id].vendor && <p><strong>Vendor:</strong> {ocrResultsMap[message.id].vendor}</p>}
                              {ocrResultsMap[message.id].date && <p><strong>Date:</strong> {ocrResultsMap[message.id].date}</p>}
                              {ocrResultsMap[message.id].total && <p><strong>Total:</strong> {ocrResultsMap[message.id].currency} {ocrResultsMap[message.id].total}</p>}
                              {ocrResultsMap[message.id].tax && <p><strong>Tax/VAT:</strong> {ocrResultsMap[message.id].currency} {ocrResultsMap[message.id].tax}</p>}
                              <details className="mt-2 text-slate-400">
                                <summary className="cursor-pointer hover:text-slate-300">Raw OCR Text</summary>
                                <pre className="mt-1 whitespace-pre-wrap font-mono text-[10px] bg-slate-950 p-2 rounded leading-relaxed">{ocrResultsMap[message.id].text}</pre>
                              </details>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </article>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
