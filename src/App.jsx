import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  AlertCircle,
  Archive,
  Bell,
  BellOff,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Eye,
  FileText,
  Folder,
  HardDrive,
  Loader2,
  LogOut,
  Maximize2,
  MessageCircle,
  Mic2,
  Minimize2,
  Minus,
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
  Cpu,
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

function AccountAvatar({ imageUrl, label, fallbackIcon: FallbackIcon, fallbackClassName = '', onImageError }) {
  const [broken, setBroken] = useState(false);
  const initial = (label || '?').trim().charAt(0).toUpperCase();

  if (imageUrl && !broken) {
    return (
      <img
        src={imageUrl}
        alt={label || ''}
        className="w-full h-full object-cover"
        onError={() => {
          setBroken(true);
          onImageError?.();
        }}
      />
    );
  }

  if (initial && initial !== '?') {
    return (
      <span className="text-sm font-bold text-slate-200 select-none" aria-hidden="true">
        {initial}
      </span>
    );
  }

  return FallbackIcon ? <FallbackIcon size={20} className={fallbackClassName} /> : null;
}

function ChatIcon({ chat, className = '', messagingReady = true }) {
  const [lazyAvatar, setLazyAvatar] = useState({ chatId: null, url: null });
  const [brokenAvatarId, setBrokenAvatarId] = useState(null);
  const isTelegramChat = chat.id?.startsWith('tg:');
  const canLazyLoad = chat.id && (chat.isGroup !== undefined || isTelegramChat);
  const avatarUrl = chat.avatarUrl || (lazyAvatar.chatId === chat.id ? lazyAvatar.url : null);
  const broken = brokenAvatarId === chat.id;

  useEffect(() => {
    let active = true;
    if (avatarUrl || !canLazyLoad || !messagingReady || !window.api?.getChatAvatar) {
      return undefined;
    }

    window.api.getChatAvatar(chat.id).then((url) => {
      if (active && url) {
        setLazyAvatar({ chatId: chat.id, url });
        setBrokenAvatarId(null);
      }
    }).catch(() => {});

    return () => {
      active = false;
    };
  }, [avatarUrl, chat.id, canLazyLoad, messagingReady]);

  const label = chat.name || '';
  const initial = label.trim().charAt(0).toUpperCase();

  if (avatarUrl && !broken) {
    return (
      <img
        src={avatarUrl}
        alt={label}
        className={`w-full h-full object-cover shrink-0 ${className}`}
        onError={() => {
          setBrokenAvatarId(chat.id);
          if (window.api?.getChatAvatar) {
            window.api.getChatAvatar(chat.id).then((url) => {
              if (url) {
                setLazyAvatar({ chatId: chat.id, url });
                setBrokenAvatarId(null);
              }
            }).catch(() => {});
          }
        }}
      />
    );
  }

  if (initial) {
    return (
      <span className={`text-sm font-semibold text-slate-300 select-none ${className}`} aria-hidden="true">
        {initial}
      </span>
    );
  }

  if (chat?.archived) return <Archive size={18} className={className} />;
  return chat?.isGroup ? <Users size={18} className={className} /> : <User size={18} className={className} />;
}

function App() {
  const { lang, t, toggleLanguage } = useLanguage();
  const isRtl = lang === 'ar';

  // Active messaging account in sidebar (whatsapp | telegram)
  const [activePlatform, setActivePlatform] = useState('whatsapp');
  const activePlatformRef = useRef(activePlatform);
  activePlatformRef.current = activePlatform;

  // Profile States
  const [profiles, setProfiles] = useState([]);
  const [activeProfile, setActiveProfile] = useState(null);
  const [titlebarAccountOpen, setTitlebarAccountOpen] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [globalSettingsModalOpen, setGlobalSettingsModalOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState('vault');
  const [globalSettings, setGlobalSettings] = useState({ transcription: { modelSize: 'tiny' } });
  const [downloadedModels, setDownloadedModels] = useState({});
  const [modelDownloadProgress, setModelDownloadProgress] = useState(null);
  const [settingsVaultPath, setSettingsVaultPath] = useState('');
  const [settingsOcrLanguage, setSettingsOcrLanguage] = useState('eng+ara');
  const [settingsOcrThreshold, setSettingsOcrThreshold] = useState(60);
  const [settingsOcrAutoScan, setSettingsOcrAutoScan] = useState(false);
  const [settingsTelegramApiId, setSettingsTelegramApiId] = useState('');
  const [settingsTelegramApiHash, setSettingsTelegramApiHash] = useState('');
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [editingProfile, setEditingProfile] = useState(null);

  const [profName, setProfName] = useState('');
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
  const [tgChatListVersion, setTgChatListVersion] = useState(0);

  // Archiving States
  const [isWorking, setIsWorking] = useState(false);
  const [archiveProgress, setArchiveProgress] = useState(0);
  const [archiveStatus, setArchiveStatus] = useState('');
  const [archiveError, setArchiveError] = useState(null);
  const [lastResult, setLastResult] = useState(null);

  // OCR States
  const [ocrScanningMap, setOcrScanningMap] = useState({});
  const [ocrResultsMap, setOcrResultsMap] = useState({});
  const [ocrProgress, setOcrProgress] = useState(null);
  const [backgroundOcrStatusMap, setBackgroundOcrStatusMap] = useState({});
  const [localServiceCapabilities, setLocalServiceCapabilities] = useState(null);
  const ocrSettings = activeProfile?.ocr || {};

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
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);

  // Load profiles list and active profile
  const loadProfiles = useCallback(async () => {
    if (!window.api) return;
    try {
      const active = await window.api.getActiveProfile();
      const list = await window.api.getProfiles();
      const settings = await window.api.getGlobalSettings();
      const models = await window.api.getWhisperModels();
      setActiveProfile(active);
      setProfiles(list);
      setGlobalSettings(settings || { transcription: { modelSize: 'tiny' } });
      setDownloadedModels(models || {});
      setVaultPath(active?.vaultPath || null);
    } catch (e) {
      console.error('Failed to load profiles and settings:', e);
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
  const refreshWhatsAppAccount = useCallback(async () => {
    if (!window.api?.getWhatsAppAccountInfo) return;
    try {
      const info = await window.api.getWhatsAppAccountInfo();
      if (info) setAccountInfo(info);
    } catch (e) {
      console.warn('Failed to load WhatsApp account info:', e);
    }
  }, []);

  const refreshTelegramAccount = useCallback(async () => {
    if (!window.api?.getTelegramAccountInfo) return;
    try {
      const info = await window.api.getTelegramAccountInfo();
      if (info) setTgAccountInfo(info);
    } catch (e) {
      console.warn('Failed to load Telegram account info:', e);
    }
  }, []);

  const checkWAStatus = useCallback(async () => {
    if (!window.api) return;
    const status = await window.api.getWhatsAppStatus();
    if (status.state === 'READY' || status.state === 'AUTHENTICATED') {
      setIsAuthenticated(true);
      if (status.info) setAccountInfo(status.info);
      await refreshWhatsAppAccount();
      if (activePlatform === 'whatsapp') fetchChats();
    } else if (status.state === 'QR') {
      setQrCode(status.qr);
      setIsAuthenticated(false);
      setAccountInfo(null);
    } else if (status.state === 'DISCONNECTED') {
      setIsAuthenticated(false);
      setAccountInfo(null);
      window.api.connectWhatsApp();
    }
  }, [fetchChats, activePlatform, refreshWhatsAppAccount]);

  // Handle Telegram status check
  const checkTGStatus = useCallback(async () => {
    if (!window.api) return;
    const status = await window.api.getTelegramStatus();
    setTgStatus(status);
    if (status.state === 'READY') {
      setIsTGAuthenticated(true);
      if (status.accountInfo) setTgAccountInfo(status.accountInfo);
      await refreshTelegramAccount();
      if (activePlatform === 'telegram') fetchChats();
    } else if (status.state === 'STARTING') {
      setIsTGAuthenticated(false);
    } else if (status.state === 'NEED_PHONE' || status.state === 'NEED_CODE' || status.state === 'NEED_2FA') {
      setIsTGAuthenticated(false);
    } else {
      setIsTGAuthenticated(false);
      if (status.state === 'DISCONNECTED') {
        setTgAccountInfo(null);
        const hasSession = status.hasStoredSession ?? await window.api.hasTelegramSession?.().catch(() => false);
        if (hasSession) {
          window.api.connectTelegram().catch(() => {});
        }
      }
    }
  }, [fetchChats, activePlatform, refreshTelegramAccount]);

  useEffect(() => {
    if (isAuthenticated) refreshWhatsAppAccount();
  }, [isAuthenticated, refreshWhatsAppAccount]);

  useEffect(() => {
    if (isTGAuthenticated) refreshTelegramAccount();
  }, [isTGAuthenticated, refreshTelegramAccount]);

  const selectPlatform = useCallback((platform) => {
    setActivePlatform(platform);
    setChats([]);
    setSelectedChat(null);
    setChatQuery('');
    setArchiveError(null);
    setLastResult(null);
    window.api?.getWatcherStatus?.(platform).then(setWatcherStatus).catch(() => {});
    if (platform === 'whatsapp') {
      checkWAStatus();
    } else {
      checkTGStatus();
    }
  }, [checkWAStatus, checkTGStatus]);

  // Initial load
  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  // Load chats when switching messaging account
  useEffect(() => {
    if (!window.api) return;
    window.api.getWatcherStatus?.(activePlatform).then(setWatcherStatus).catch(() => {});
    if (activePlatform === 'whatsapp' && isAuthenticated) {
      fetchChats();
    } else if (activePlatform === 'telegram' && isTGAuthenticated) {
      fetchChats();
    }
  }, [activePlatform, isAuthenticated, isTGAuthenticated, fetchChats]);

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
      refreshWhatsAppAccount();
    });

    window.api.onWhatsAppAccountInfo?.((info) => {
      if (info) setAccountInfo(info);
    });

    window.api.onAuthenticated(() => {
      setIsAuthenticated(true);
      refreshWhatsAppAccount();
    });

    window.api.onArchiveProgress((data) => {
      setArchiveProgress(data.progress);
      setArchiveStatus(data.status);
      if (data.progress === 100) setIsWorking(false);
    });

    window.api.onArchiveError((error) => {
      setArchiveError(error);
      setIsWorking(false);
    });
    window.api.onOCRProgress?.((data) => {
      setOcrProgress(data);
    });
    window.api.onBackgroundOCRStatus?.((data) => {
      if (!data?.chatId) return;
      setBackgroundOcrStatusMap(prev => ({ ...prev, [data.chatId]: data }));
    });
    window.api.onModelDownloadProgress?.((data) => {
      setModelDownloadProgress(data);
      if (data.progress === 1) {
        setTimeout(() => setModelDownloadProgress(null), 2000);
        window.api.getWhisperModels().then(setDownloadedModels).catch(() => {});
      }
    });
    window.api.getWindowState?.().then((state) => setIsWindowMaximized(!!state.maximized)).catch(() => {});
    window.api.onWindowState?.((state) => setIsWindowMaximized(!!state.maximized));

    window.api.onWatcherStatus?.((status) => {
      if (activePlatformRef.current === 'whatsapp') setWatcherStatus(status);
    });
    window.api.onTelegramWatcherStatus?.((status) => {
      if (activePlatformRef.current === 'telegram') setWatcherStatus(status);
    });
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
        if (status.accountInfo) setTgAccountInfo(status.accountInfo);
        if (activePlatform === 'telegram') fetchChats();
      } else {
        setIsTGAuthenticated(false);
      }
    });

    window.api.onTelegramReady?.((info) => {
      if (info) setTgAccountInfo(info);
      setIsTGAuthenticated(true);
      setTgSubmitting(false);
      setTgChatListVersion((v) => v + 1);
      if (activePlatform === 'telegram') fetchChats();
      refreshTelegramAccount();
    });

    window.api.onTelegramAccountInfo?.((info) => {
      if (info) setTgAccountInfo(info);
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
  }, [fetchChats, activePlatform, refreshWhatsAppAccount, refreshTelegramAccount, t]);

  // Connect messaging accounts once profile is loaded
  useEffect(() => {
    if (!activeProfile || !window.api) return;
    checkWAStatus();
    checkTGStatus();
  }, [activeProfile, checkWAStatus, checkTGStatus]);

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
  const selectedBackgroundOcr = selectedChat ? backgroundOcrStatusMap[selectedChat.id] : null;
  const documentOcrReady = !!localServiceCapabilities?.documentOcr?.pdf?.available;
  const transcriptionReady = !!localServiceCapabilities?.transcription?.engines?.some(engine => engine.available);
  const transcriptionEngine = localServiceCapabilities?.transcription?.engines?.find(engine => engine.available)
    || localServiceCapabilities?.transcription?.engines?.[0];

  useEffect(() => {
    if (!selectedChat || !window.api?.getBackgroundOCRStatus) return;
    window.api.getBackgroundOCRStatus(selectedChat.id)
      .then((status) => {
        if (status?.chatId) {
          setBackgroundOcrStatusMap(prev => ({ ...prev, [status.chatId]: status }));
        }
      })
      .catch(() => {});
  }, [selectedChat]);

  useEffect(() => {
    if (!window.api?.getLocalServiceCapabilities) return;
    window.api.getLocalServiceCapabilities()
      .then(setLocalServiceCapabilities)
      .catch(() => {});
  }, []);

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

  const openAppSettings = useCallback((tab = 'vault') => {
    setSettingsTab(tab);
    setSettingsVaultPath(activeProfile?.vaultPath || vaultPath || '');
    setSettingsOcrLanguage(activeProfile?.ocr?.language || 'eng+ara');
    setSettingsOcrThreshold(activeProfile?.ocr?.confidenceThreshold ?? 60);
    setSettingsOcrAutoScan(!!activeProfile?.ocr?.autoScan);
    setSettingsTelegramApiId(globalSettings?.telegram?.apiId || '');
    setSettingsTelegramApiHash(globalSettings?.telegram?.apiHash || '');
    setGlobalSettingsModalOpen(true);
  }, [activeProfile, vaultPath, globalSettings]);

  const handleSettingsVaultBrowse = async () => {
    if (!window.api || !activeProfile) return;
    const selected = await window.api.selectVault();
    if (!selected) return;
    setSettingsVaultPath(selected);
    const updated = await window.api.updateProfile(activeProfile.id, { vaultPath: selected });
    setVaultPath(selected);
    setActiveProfile(updated);
    setProfiles((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    if (watcherStatus.globalEnabled) {
      window.api.setWatcherGlobalEnabled?.(true, selected, activePlatform).then(setWatcherStatus).catch(() => {});
    }
  };

  const handleSaveSettingsOcr = async () => {
    if (!window.api || !activeProfile) return;
    setSettingsSaving(true);
    try {
      const updated = await window.api.updateProfile(activeProfile.id, {
        ocr: {
          language: settingsOcrLanguage,
          confidenceThreshold: Number(settingsOcrThreshold) || 60,
          autoScan: !!settingsOcrAutoScan,
        },
      });
      setActiveProfile(updated);
      setProfiles((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    } catch (err) {
      console.error('Failed to save OCR settings:', err);
    } finally {
      setSettingsSaving(false);
    }
  };

  const handleSaveSettingsTelegram = async () => {
    if (!window.api) return;
    const apiId = settingsTelegramApiId.trim();
    const apiHash = settingsTelegramApiHash.trim();
    if (!apiId || !apiHash) return;

    setSettingsSaving(true);
    try {
      const updated = await window.api.updateGlobalSettings({
        telegram: { apiId, apiHash },
      });
      setGlobalSettings(updated);
    } catch (err) {
      console.error('Failed to save Telegram API settings:', err);
    } finally {
      setSettingsSaving(false);
    }
  };

  const telegramCredentialsConfigured = Boolean(
    globalSettings?.telegram?.apiId?.trim() && globalSettings?.telegram?.apiHash?.trim(),
  );

  const handleLogout = async (platform = activePlatform) => {
    if (platform === 'whatsapp') {
      await window.api.logout();
      setIsAuthenticated(false);
      setAccountInfo(null);
      setQrCode(null);
      if (activePlatform === 'whatsapp') {
        setChats([]);
        setSelectedChat(null);
      }
    } else {
      await window.api.logoutTelegram?.();
      setIsTGAuthenticated(false);
      setTgAccountInfo(null);
      setTgStatus({ state: 'DISCONNECTED' });
      setTgError(null);
      if (activePlatform === 'telegram') {
        setChats([]);
        setSelectedChat(null);
      }
    }
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
    setOcrProgress({
      chatId: selectedChat.id,
      messageId,
      status: t('preparingOCR'),
      progress: 0,
      phase: 'prepare',
    });
    try {
      const res = await window.api.ocrScanMessage(selectedChat.id, messageId, vaultPath);
      if (res.success && res.ocrData) {
        setOcrResultsMap(prev => ({ ...prev, [messageId]: res.ocrData }));
        setReviewMessages(prev => prev.map(m => m.id === messageId ? { ...m, ocr: res.ocrData } : m));
        setOcrProgress(prev => ({
          ...prev,
          chatId: selectedChat.id,
          messageId,
          status: t('ocrComplete'),
          progress: 100,
          phase: 'complete',
        }));
      } else {
        setOcrProgress(prev => ({
          ...prev,
          chatId: selectedChat.id,
          messageId,
          status: res.error || t('ocrFailed'),
          progress: 100,
          phase: 'error',
          error: res.error || t('ocrFailed'),
        }));
        alert(res.error || 'OCR scanning failed.');
      }
    } catch (err) {
      setOcrProgress(prev => ({
        ...prev,
        chatId: selectedChat.id,
        messageId,
        status: err.message || t('ocrFailed'),
        progress: 100,
        phase: 'error',
        error: err.message || t('ocrFailed'),
      }));
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

  const handleStartBackgroundOCR = async () => {
    if (!selectedChat || !vaultPath || !window.api?.startBackgroundOCRForChat) return;
    const status = await window.api.startBackgroundOCRForChat(selectedChat.id, vaultPath);
    if (status?.chatId) {
      setBackgroundOcrStatusMap(prev => ({ ...prev, [status.chatId]: status }));
    }
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

      await checkWAStatus();
      await checkTGStatus();
      window.api.getWatcherStatus?.(activePlatform).then(setWatcherStatus).catch(() => {});
    } catch (err) {
      console.error('Error switching profile:', err);
    } finally {
      setIsLoadingChats(false);
    }
  };

  const handleOpenProfilesModal = () => {
    setTitlebarAccountOpen(false);
    setEditingProfile(null);
    setProfName('');
    setProfIcon('user');
    setProfColor('#10b981');
    setProfileModalOpen(true);
  };

  const handleCreateProfile = async (e) => {
    e.preventDefault();
    if (!profName.trim() || !window.api) return;

    try {
      const newP = await window.api.createProfile(profName, null, profIcon, profColor);
      await window.api.updateProfile(newP.id, {
        ocr: { language: 'eng+ara', confidenceThreshold: 60, autoScan: false },
      });
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
    setProfIcon(profile.icon || 'user');
    setProfColor(profile.color || '#10b981');
  };

  const handleUpdateProfile = async (e) => {
    e.preventDefault();
    if (!editingProfile || !profName.trim() || !window.api) return;

    try {
      const updated = await window.api.updateProfile(editingProfile.id, {
        name: profName,
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
  const reviewHasOcrCandidates = reviewMessages.some(message => message.type === 'image');
  const activePlatformLabel = activePlatform === 'whatsapp' ? 'WhatsApp' : 'Telegram';
  const desktopStatus = isWorking
    ? archiveStatus || t('startingArchive')
    : ocrProgress?.phase && ocrProgress.phase !== 'complete'
      ? ocrProgress.status || t('processingOCR')
      : `${activePlatformLabel} · ${isPlatformAuthenticated ? t('connected') : t('loginNeeded')} · ${vaultPath ? t('vaultReady') : t('noVaultSelected')}`;

  return (
    <div className="h-screen w-screen bg-slate-950 text-slate-100 overflow-hidden selection:bg-emerald-500/30 font-sans flex flex-col" dir={isRtl ? 'rtl' : 'ltr'}>
      <header className="desktop-titlebar">
        <div className="desktop-drag-region">
          <div className="desktop-brand">
            <img src="/ledgerlink_logo.png" alt="" className="h-5 w-5 rounded object-cover" />
            <span className="font-semibold">LedgerLink</span>
            <span className="desktop-title-meta">{activePlatformLabel}</span>
          </div>
        </div>
        <div className="desktop-titlebar-actions">
          <div className="relative">
            <button
              type="button"
              className="titlebar-account-trigger"
              onClick={() => setTitlebarAccountOpen((open) => !open)}
              aria-expanded={titlebarAccountOpen}
              aria-haspopup="listbox"
            >
              <span className="titlebar-account-avatar">
                {activeProfile && (
                  <ProfileIcon name={activeProfile.icon || 'user'} color={activeProfile.color || '#10b981'} className="w-3.5 h-3.5" />
                )}
              </span>
              <span className="max-w-[140px] truncate">{activeProfile?.name || t('defaultAccount')}</span>
              <ChevronDown size={14} className={`shrink-0 transition-transform ${titlebarAccountOpen ? 'rotate-180' : ''}`} />
            </button>
            {titlebarAccountOpen && (
              <>
                <button
                  type="button"
                  className="titlebar-account-backdrop"
                  aria-label={t('close')}
                  onClick={() => setTitlebarAccountOpen(false)}
                />
                <div className="titlebar-account-menu" role="listbox">
                  <p className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">{t('profiles')}</p>
                  {profiles.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      role="option"
                      aria-selected={activeProfile?.id === p.id}
                      onClick={() => {
                        setTitlebarAccountOpen(false);
                        handleSwitchProfile(p.id);
                      }}
                      className={`titlebar-account-item ${activeProfile?.id === p.id ? 'active' : ''}`}
                    >
                      <ProfileIcon name={p.icon || 'user'} color={p.color || '#10b981'} className="w-3.5 h-3.5" />
                      <span className="truncate">{p.name}</span>
                      {activeProfile?.id === p.id && <Check size={14} className="shrink-0 text-emerald-400" />}
                    </button>
                  ))}
                  <div className="border-t border-white/10 mt-1 pt-1">
                    <button
                      type="button"
                      className="titlebar-account-item w-full"
                      onClick={handleOpenProfilesModal}
                    >
                      <Users size={14} />
                      <span>{t('manageProfiles')}</span>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
          <button type="button" className="titlebar-settings-btn" onClick={() => openAppSettings('vault')} aria-label={t('appSettings')}>
            <Settings size={15} />
          </button>
        </div>
        <div className="desktop-window-controls">
          <button type="button" onClick={() => window.api?.minimizeWindow?.()} aria-label={t('minimizeWindow')}>
            <Minus size={15} />
          </button>
          <button type="button" onClick={() => window.api?.toggleMaximizeWindow?.().then((state) => setIsWindowMaximized(!!state.maximized))} aria-label={isWindowMaximized ? t('restoreWindow') : t('maximizeWindow')}>
            {isWindowMaximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button type="button" className="close" onClick={() => window.api?.closeWindow?.()} aria-label={t('closeWindow')}>
            <X size={15} />
          </button>
        </div>
      </header>
      <div className="desktop-workspace">
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
              {/* WhatsApp + Telegram accounts (sidebar) */}
              <section className="space-y-2">
                <h2 className="section-label">{t('connectedAccounts')}</h2>
                <p className="text-[11px] text-slate-500 leading-snug">{t('tapAccountToViewChats')}</p>
                <div className="space-y-2">
                  <div className={`account-card ${
                    activePlatform === 'whatsapp'
                      ? 'active-whatsapp'
                      : ''
                  } ${isAuthenticated ? 'connected' : 'waiting'}`}>
                    <button
                      type="button"
                      onClick={() => selectPlatform('whatsapp')}
                      className="account-select"
                      aria-pressed={activePlatform === 'whatsapp'}
                    >
                      <div className="account-avatar text-emerald-400">
                        {isAuthenticated ? (
                          <AccountAvatar
                            imageUrl={accountInfo?.profilePicUrl}
                            label={accountInfo?.pushname || 'WhatsApp'}
                            fallbackIcon={MessageCircle}
                            onImageError={refreshWhatsAppAccount}
                          />
                        ) : (
                          <MessageCircle size={20} />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold truncate">WhatsApp</p>
                          <span className={`account-state ${isAuthenticated ? 'online' : 'pending'}`}>
                            {isAuthenticated ? t('connected') : t('loginNeeded')}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 truncate">
                          {accountInfo?.pushname || (isAuthenticated ? t('connectedSecurely') : t('waitingForLogin'))}
                        </p>
                        {activePlatform === 'whatsapp' && (
                          <p className="text-[11px] text-slate-500 truncate mt-0.5">
                            {watcherStatus.globalEnabled ? t('watcherOn') : t('watcherOff')}
                          </p>
                        )}
                      </div>
                    </button>
                    {isAuthenticated && (
                      <button
                        type="button"
                        onClick={() => handleLogout('whatsapp')}
                        className="account-logout"
                        aria-label={t('logoutWhatsApp')}
                        title={t('logoutWhatsApp')}
                      >
                        <LogOut size={16} />
                      </button>
                    )}
                  </div>

                  <div className={`account-card ${
                    activePlatform === 'telegram'
                      ? 'active-telegram'
                      : ''
                  } ${isTGAuthenticated ? 'connected' : 'waiting'}`}>
                    <button
                      type="button"
                      onClick={() => selectPlatform('telegram')}
                      className="account-select"
                      aria-pressed={activePlatform === 'telegram'}
                    >
                      <div className="account-avatar text-sky-400">
                        {isTGAuthenticated ? (
                          <AccountAvatar
                            imageUrl={tgAccountInfo?.profilePicUrl}
                            label={tgAccountInfo?.displayName || tgAccountInfo?.username || 'Telegram'}
                            fallbackIcon={Send}
                            fallbackClassName="rotate-[-20deg]"
                            onImageError={refreshTelegramAccount}
                          />
                        ) : (
                          <Send size={18} className="rotate-[-20deg]" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold truncate">Telegram</p>
                          <span className={`account-state ${isTGAuthenticated ? 'online' : 'pending'}`}>
                            {isTGAuthenticated ? t('connected') : t('loginNeeded')}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 truncate">
                          {tgAccountInfo?.displayName || tgAccountInfo?.username || (isTGAuthenticated ? t('connectedSecurely') : t('waitingForLogin'))}
                        </p>
                        {activePlatform === 'telegram' && isTGAuthenticated && (
                          <p className="text-[11px] text-slate-500 truncate mt-0.5">
                            {watcherStatus.globalEnabled ? t('watcherOn') : t('watcherOff')}
                          </p>
                        )}
                      </div>
                    </button>
                    {isTGAuthenticated && (
                      <button
                        type="button"
                        onClick={() => handleLogout('telegram')}
                        className="account-logout"
                        aria-label={t('logoutTelegram')}
                        title={t('logoutTelegram')}
                      >
                        <LogOut size={16} />
                      </button>
                    )}
                  </div>
                </div>
              </section>

              {watcherEvent && (
                <section className="space-y-2">
                  <h2 className="section-label">{t('lastWatcherEvent')}</h2>
                  <div className="surface-button text-xs text-slate-300">
                    <p className="font-semibold text-slate-100">{watcherEvent.status}</p>
                    <p className="truncate">{watcherEvent.error || watcherEvent.chatId}</p>
                  </div>
                </section>
              )}
            </div>

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

                {!telegramCredentialsConfigured && (
                  <div className="mb-5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 space-y-3">
                    <p className="text-sm text-amber-100/90">{t('telegramApiRequired')}</p>
                    <button
                      type="button"
                      onClick={() => openAppSettings('telegram')}
                      className="toolbar-button w-full justify-center text-xs"
                    >
                      <Settings size={14} />
                      {t('openTelegramSettings')}
                    </button>
                  </div>
                )}

                {tgStatus.state === 'STARTING' && (
                  <div className="empty-state py-4">
                    <Loader2 size={24} className="animate-spin text-emerald-300" />
                    <p>{t('reconnectingTelegram')}</p>
                    <p className="text-xs text-slate-500">{t('storedTelegramSession')}</p>
                  </div>
                )}

                {/* Step 1: Input Phone */}
                {telegramCredentialsConfigured && (tgStatus.state === 'DISCONNECTED' || tgStatus.state === 'NEED_PHONE') && (
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
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="font-semibold text-sm uppercase tracking-wide text-slate-300">
                        {activePlatform === 'whatsapp' ? 'WhatsApp' : 'Telegram'} · {t('chats')}
                      </h2>
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
                          key={chat.id.startsWith('tg:') ? `${chat.id}-${tgChatListVersion}` : chat.id}
                          onClick={() => setSelectedChat(chat)}
                          disabled={isWorking}
                          className={`chat-row ${selectedChat?.id === chat.id ? 'active' : ''}`}
                        >
                          <div className="chat-row-icon">
                            <ChatIcon
                              chat={chat}
                              messagingReady={chat.id.startsWith('tg:') ? isTGAuthenticated : isAuthenticated}
                            />
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
                          <div className="chat-row-icon">
                            <ChatIcon
                              chat={selectedChat}
                              messagingReady={selectedChat.id?.startsWith('tg:') ? isTGAuthenticated : isAuthenticated}
                            />
                          </div>
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
                      <button disabled={!selectedChat || reviewLoading} onClick={handleReviewChat} className="toolbar-button">
                        <Search size={18} />
                        {t('openOCR')}
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

                    <div className="mt-5 rounded-lg border border-white/10 bg-slate-950/45 p-4">
                      <div className="flex flex-col gap-4">
                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                          <div className="min-w-0">
                            <h3 className="text-sm font-semibold text-slate-100">{t('backgroundServices')}</h3>
                            <p className="text-xs text-slate-400">
                              {t('ocrLanguage')}: {ocrSettings.language || 'eng+ara'} · {t('ocrConfidence')}: {ocrSettings.confidenceThreshold ?? 60}%
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button disabled={!selectedChat || !vaultPath} onClick={handleStartBackgroundOCR} className="toolbar-button">
                              <Search size={16} />
                              {t('scanArchiveBacklog')}
                            </button>
                            <button disabled={!selectedChat || reviewLoading} onClick={handleReviewChat} className="toolbar-button">
                              <Eye size={16} />
                              {t('openOCR')}
                            </button>
                          </div>
                        </div>
                        <div className={`background-service-panel ${selectedBackgroundOcr?.status === 'running' ? 'running' : ''}`}>
                          <div className="grid gap-2 md:grid-cols-3">
                            <div className="service-readiness-row">
                              <FileText size={15} className={documentOcrReady ? 'text-emerald-300' : 'text-amber-300'} />
                              <div className="min-w-0">
                                <span className="block truncate text-xs font-semibold text-slate-200">{t('documentOcr')}</span>
                                <span className="block truncate text-[11px] text-slate-500">
                                  {documentOcrReady ? t('ready') : (localServiceCapabilities?.documentOcr?.pdf?.reason || t('checkingServices'))}
                                </span>
                              </div>
                            </div>
                            <div className="service-readiness-row">
                              <Mic2 size={15} className={transcriptionReady ? 'text-emerald-300' : 'text-slate-500'} />
                              <div className="min-w-0">
                                <span className="block truncate text-xs font-semibold text-slate-200">{t('localTranscription')}</span>
                                <span className="block truncate text-[11px] text-slate-500">
                                  {transcriptionReady ? transcriptionEngine?.label : (transcriptionEngine?.reason || t('preparedForTranscription'))}
                                </span>
                              </div>
                            </div>
                            <div className="service-readiness-row">
                              <Cpu size={15} className="text-sky-300" />
                              <div className="min-w-0">
                                <span className="block truncate text-xs font-semibold text-slate-200">{t('hardware')}</span>
                                <span className="block truncate text-[11px] text-slate-500">
                                  {localServiceCapabilities?.transcription?.hardware?.gpuNames?.[0] || t('cpuFallback')}
                                </span>
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-slate-100">{t('ocrBacklog')}</p>
                              <p className="truncate text-xs text-slate-400">
                                {selectedBackgroundOcr?.current || t('backgroundOcrIdle')}
                              </p>
                            </div>
                            <span className="text-sm font-bold text-slate-100">{Math.round(selectedBackgroundOcr?.progress || 0)}%</span>
                          </div>
                          <div className="ocr-progress-track" aria-hidden="true">
                            <div style={{ width: `${Math.max(0, Math.min(100, selectedBackgroundOcr?.progress || 0))}%` }} />
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-400 md:grid-cols-4">
                            <span>{t('processed')}: {selectedBackgroundOcr?.done || 0}</span>
                            <span>{t('pending')}: {Math.max(0, (selectedBackgroundOcr?.total || 0) - (selectedBackgroundOcr?.done || 0) - (selectedBackgroundOcr?.failed || 0))}</span>
                            <span>{t('failed')}: {selectedBackgroundOcr?.failed || 0}</span>
                            <span>{t('documentOcrPending')}: {selectedBackgroundOcr?.documentPending || 0}</span>
                            <span>{t('documentOcrDone')}: {selectedBackgroundOcr?.documentDone || 0}</span>
                            <span>{t('transcriptionReady')}: {selectedBackgroundOcr?.transcriptionPending || 0}</span>
                          </div>
                        </div>
                      </div>
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
      </div>
      <footer className="desktop-statusbar">
        <span className={`desktop-status-dot ${isPlatformAuthenticated ? 'online' : ''}`} />
        <span className="truncate">{desktopStatus}</span>
        <span className="ms-auto truncate">{watcherStatus.globalEnabled ? t('watcherOn') : t('watcherOff')}</span>
      </footer>

      {/* Accounts / Profiles Manager Modal */}
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

                  <p className="text-[11px] text-slate-500 leading-snug">
                    {t('profileSettingsHint')}
                  </p>

                  <div className="pt-2 flex gap-2">
                    {editingProfile && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingProfile(null);
                          setProfName('');
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

      {/* Global Settings Modal */}
      {globalSettingsModalOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="modal-settings-title">
          <div className="review-modal max-w-2xl">
            <div className="review-header shrink-0">
              <div className="flex items-center gap-2">
                <Settings size={20} className="text-emerald-400" />
                <h2 id="modal-settings-title" className="font-bold text-lg">{t('appSettings')}</h2>
              </div>
              <button className="icon-button" onClick={() => setGlobalSettingsModalOpen(false)} aria-label={t('close')}>
                <X size={18} />
              </button>
            </div>

            <div className="flex flex-1 overflow-hidden h-[600px] max-h-[80vh]">
              <div className="w-48 bg-slate-900/50 border-r border-white/10 flex flex-col p-3 gap-1 overflow-y-auto shrink-0">
                {(['vault', 'ocr', 'transcription', 'telegram']).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    className={`px-3 py-2 text-left rounded-lg text-sm font-semibold transition-colors ${settingsTab === tab ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'}`}
                    onClick={() => setSettingsTab(tab)}
                  >
                    {tab === 'vault'
                      ? t('obsidianVault')
                      : tab === 'ocr'
                        ? t('ocrSettings')
                        : tab === 'transcription'
                          ? t('settingsTranscription')
                          : t('telegramApiCredentials')}
                  </button>
                ))}
              </div>
              <div className="flex-1 overflow-y-auto custom-scrollbar bg-slate-950/50 p-6">
                {settingsTab === 'vault' && (
                  <div className="space-y-6 max-w-2xl">
                    <div>
                      <h3 className="text-lg font-bold text-slate-100">{t('obsidianVault')}</h3>
                      <p className="text-slate-400 text-sm mt-1">{t('settingsVaultDesc')}</p>
                    </div>
                    {!activeProfile ? (
                      <p className="text-sm text-amber-300/90">{t('settingsSelectAccount')}</p>
                    ) : (
                      <div className="surface-card p-5 space-y-4">
                        <p className="text-xs text-slate-500">
                          {t('activeProfile')}: <span className="font-semibold text-slate-300">{activeProfile.name}</span>
                        </p>
                        <div className="space-y-1">
                          <label className="text-sm font-semibold text-slate-200">{t('storageLocation')}</label>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              readOnly
                              value={settingsVaultPath}
                              placeholder={t('noVaultSelected')}
                              className="flex-1 px-3 py-2 text-sm bg-slate-900 border border-white/10 rounded-lg outline-none text-slate-300 truncate"
                            />
                            <button
                              type="button"
                              onClick={handleSettingsVaultBrowse}
                              className="px-3 text-sm font-semibold bg-slate-800 hover:bg-slate-700 border border-white/15 rounded-lg shrink-0"
                            >
                              {t('browseVault')}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {settingsTab === 'ocr' && (
                  <div className="space-y-6 max-w-2xl">
                    <div>
                      <h3 className="text-lg font-bold text-slate-100">{t('ocrSettings')}</h3>
                      <p className="text-slate-400 text-sm mt-1">{t('settingsOcrDesc')}</p>
                    </div>
                    {!activeProfile ? (
                      <p className="text-sm text-amber-300/90">{t('settingsSelectAccount')}</p>
                    ) : (
                      <div className="surface-card p-5 space-y-4">
                        <p className="text-xs text-slate-500">
                          {t('activeProfile')}: <span className="font-semibold text-slate-300">{activeProfile.name}</span>
                        </p>
                        <div className="space-y-1">
                          <label className="text-sm font-semibold text-slate-200">{t('ocrLanguage')}</label>
                          <select
                            value={settingsOcrLanguage}
                            onChange={(e) => setSettingsOcrLanguage(e.target.value)}
                            className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                          >
                            <option value="eng+ara">English + Arabic</option>
                            <option value="ara">Arabic</option>
                            <option value="eng">English</option>
                          </select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-sm font-semibold text-slate-200">{t('ocrConfidence')}</label>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            value={settingsOcrThreshold}
                            onChange={(e) => setSettingsOcrThreshold(e.target.value)}
                            className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                          />
                        </div>
                        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
                          <input
                            type="checkbox"
                            checked={settingsOcrAutoScan}
                            onChange={(e) => setSettingsOcrAutoScan(e.target.checked)}
                            className="h-4 w-4 accent-emerald-500"
                          />
                          {t('ocrAutoScan')}
                        </label>
                        <button
                          type="button"
                          onClick={handleSaveSettingsOcr}
                          disabled={settingsSaving}
                          className="primary-command w-full sm:w-auto disabled:opacity-50"
                        >
                          {settingsSaving ? <Loader2 size={16} className="animate-spin" /> : null}
                          {t('save')}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {settingsTab === 'telegram' && (
                  <div className="space-y-6 max-w-2xl">
                    <div>
                      <h3 className="text-lg font-bold text-slate-100">{t('telegramApiCredentials')}</h3>
                      <p className="text-slate-400 text-sm mt-1">{t('settingsTelegramDesc')}</p>
                    </div>

                    <div className="surface-card p-5 space-y-4">
                      <p className="text-xs text-slate-500 leading-relaxed">{t('telegramApiHint')}</p>
                      <div className="space-y-1">
                        <label className="text-sm font-semibold text-slate-200">{t('telegramApiId')}</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={settingsTelegramApiId}
                          onChange={(e) => setSettingsTelegramApiId(e.target.value)}
                          placeholder="12345678"
                          className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-sm font-semibold text-slate-200">{t('telegramApiHash')}</label>
                        <input
                          type="password"
                          value={settingsTelegramApiHash}
                          onChange={(e) => setSettingsTelegramApiHash(e.target.value)}
                          placeholder="abcdef1234567890abcdef1234567890"
                          className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 font-mono"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={handleSaveSettingsTelegram}
                        disabled={settingsSaving || !settingsTelegramApiId.trim() || !settingsTelegramApiHash.trim()}
                        className="primary-command w-full sm:w-auto disabled:opacity-50"
                      >
                        {settingsSaving ? <Loader2 size={16} className="animate-spin" /> : null}
                        {t('save')}
                      </button>
                    </div>
                  </div>
                )}

                {settingsTab === 'transcription' && (
                  <div className="space-y-6 max-w-2xl">
                    <div>
                      <h3 className="text-lg font-bold text-slate-100">{t('settingsTranscription')}</h3>
                      <p className="text-slate-400 text-sm mt-1">{t('settingsTranscriptionDesc')}</p>
                    </div>

                    <div className="surface-card p-5">
                      <div className="space-y-1 mb-4">
                        <label className="text-sm font-semibold text-slate-200">{t('settingsTranscriptionModel')}</label>
                        <p className="text-xs text-slate-400">{t('settingsTranscriptionModelHint')}</p>
                      </div>

                      <div className="space-y-3">
                        {['tiny', 'base', 'small', 'medium', 'large'].map((size) => {
                          const isDownloaded = downloadedModels[size];
                          const isDownloading = modelDownloadProgress?.modelSize === size;
                          const isSelected = globalSettings.transcription?.modelSize === size;

                          return (
                            <div key={size} className={`flex items-center justify-between p-3 rounded-lg border ${isSelected ? 'border-emerald-500/50 bg-emerald-500/5' : 'border-white/10 bg-slate-900/50'}`}>
                              <div className="flex items-center gap-3">
                                <button
                                  type="button"
                                  onClick={() => {
                                    const newSettings = { ...globalSettings, transcription: { ...globalSettings.transcription, modelSize: size } };
                                    setGlobalSettings(newSettings);
                                    window.api.updateGlobalSettings(newSettings);
                                  }}
                                  className={`w-4 h-4 rounded-full border border-slate-500 flex items-center justify-center ${isSelected ? 'border-emerald-500' : ''}`}
                                >
                                  {isSelected && <div className="w-2 h-2 rounded-full bg-emerald-500" />}
                                </button>
                                <div>
                                  <span className="text-sm font-semibold text-slate-200 capitalize">{size} {t('settingsModelLabel')}</span>
                                  <span className="block text-xs text-slate-500">
                                    {size === 'tiny' ? t('settingsModelTiny') : size === 'large' ? t('settingsModelLarge') : t('settingsModelBalanced')}
                                  </span>
                                </div>
                              </div>

                              <div className="flex items-center gap-3">
                                {isDownloading ? (
                                  <div className="text-right">
                                    <span className="text-xs font-bold text-sky-400">{Math.round((modelDownloadProgress.progress || 0) * 100)}%</span>
                                    <div className="w-24 h-1.5 bg-slate-800 rounded-full mt-1 overflow-hidden">
                                      <div className="h-full bg-sky-500" style={{ width: `${Math.max(0, Math.min(100, modelDownloadProgress.progress * 100))}%` }} />
                                    </div>
                                  </div>
                                ) : isDownloaded ? (
                                  <span className="text-xs font-semibold text-emerald-400 bg-emerald-400/10 px-2 py-1 rounded">{t('settingsModelDownloaded')}</span>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => window.api.downloadWhisperModel(size)}
                                    className="text-xs font-semibold text-slate-300 bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded border border-white/10 transition-colors"
                                  >
                                    {t('settingsModelDownload')}
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
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
              {ocrProgress && ocrProgress.chatId === selectedChat?.id && (
                <div className={`ocr-progress-card ${ocrProgress.phase === 'error' ? 'error' : ''}`} role={ocrProgress.phase === 'error' ? 'alert' : 'status'}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      {ocrProgress.phase === 'complete' ? (
                        <CheckCircle2 size={16} className="text-emerald-300" />
                      ) : ocrProgress.phase === 'error' ? (
                        <AlertCircle size={16} className="text-rose-300" />
                      ) : (
                        <Loader2 size={16} className="animate-spin text-emerald-300" />
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-100">{t('ocrProgress')}</p>
                        <p className="truncate text-xs text-slate-400">{ocrProgress.status || t('processingOCR')}</p>
                        <p className="truncate text-[11px] text-slate-500">
                          {t('ocrLanguage')}: {ocrSettings.language || 'eng+ara'} · {t('ocrConfidence')}: {ocrSettings.confidenceThreshold ?? 60}%
                        </p>
                      </div>
                    </div>
                    <span className="text-sm font-bold text-slate-100">{Math.round(ocrProgress.progress || 0)}%</span>
                  </div>
                  <div className="ocr-progress-track" aria-hidden="true">
                    <div style={{ width: `${Math.max(0, Math.min(100, ocrProgress.progress || 0))}%` }} />
                  </div>
                </div>
              )}
              {reviewLoading ? (
                <div className="empty-state"><Loader2 size={28} className="animate-spin text-emerald-300" /><p>{t('loadingMessages')}</p></div>
              ) : reviewError ? (
                <div role="alert" className="error-banner"><AlertCircle size={18} /><span>{reviewError}</span></div>
              ) : (
                <>
                  {!reviewHasOcrCandidates && (
                    <div className="ocr-empty-state">
                      <Search size={20} className="text-emerald-300" />
                      <div>
                        <p className="font-semibold text-slate-100">{t('noOcrImages')}</p>
                        <p className="text-xs text-slate-400">{t('archiveImagesFirst')}</p>
                      </div>
                    </div>
                  )}
                  {reviewMessages.map((message) => (
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
                                <Search size={12} className="text-emerald-300" />
                              )}
                              {ocrScanningMap[message.id] ? t('processingOCR') : t('runOCR')}
                            </button>
                            {ocrProgress?.messageId === message.id && (
                              <div className={`ocr-inline-progress ${ocrProgress.phase === 'error' ? 'error' : ''}`} role={ocrProgress.phase === 'error' ? 'alert' : 'status'}>
                                <div className="flex items-center justify-between gap-2">
                                  <span className="truncate">{ocrProgress.status || t('processingOCR')}</span>
                                  <strong>{Math.round(ocrProgress.progress || 0)}%</strong>
                                </div>
                                <div className="ocr-progress-track" aria-hidden="true">
                                  <div style={{ width: `${Math.max(0, Math.min(100, ocrProgress.progress || 0))}%` }} />
                                </div>
                                <p className="truncate text-[11px] text-slate-500">
                                  {t('ocrLanguage')}: {ocrSettings.language || 'eng+ara'}
                                </p>
                              </div>
                            )}
                             
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
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
