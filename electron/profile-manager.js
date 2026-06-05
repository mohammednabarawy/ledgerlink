import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { stripTelegramSecretsFromProfile, stripTelegramSecretsFromAllProfiles } from './secrets.js';

function safeName(name, fallback = 'Account') {
  return (name || fallback)
    .replace(/[<>:"/\\|?*]/g, '_')
    .split('')
    .map(char => char.charCodeAt(0) < 32 ? '_' : char)
    .join('')
    .trim() || fallback;
}

export class ProfileManager {
  constructor(userDataPath) {
    this.userDataPath = userDataPath;
    this.profilesPath = path.join(userDataPath, 'profiles.json');
    this.telegramSessionsDir = path.join(userDataPath, 'TelegramSessions');
    this.legacySettingsPath = path.join(userDataPath, 'archiver-settings.json');
    this.config = {
      schemaVersion: 1,
      activeProfileId: 'default',
      settings: {
        transcription: {
          modelSize: 'tiny'
        },
        appearance: {
          theme: 'system'
        }
      },
      profiles: {}
    };
    this.load();
    this.migrateTelegramSessions();
    this.sanitizeStoredSecrets();
  }

  telegramSessionPath(profileId = this.config.activeProfileId) {
    return path.join(this.telegramSessionsDir, `${safeName(profileId, 'default')}.session`);
  }

  migrateTelegramSessions() {
    fs.mkdirSync(this.telegramSessionsDir, { recursive: true });
    let changed = false;
    for (const [id, profile] of Object.entries(this.config.profiles)) {
      const session = profile?.telegram?.session;
      if (session && String(session).length > 0) {
        fs.writeFileSync(this.telegramSessionPath(id), String(session), 'utf8');
        delete profile.telegram.session;
        changed = true;
      }
    }
    if (changed) this.save();
  }

  sanitizeStoredSecrets() {
    const before = JSON.stringify(this.config.profiles);
    stripTelegramSecretsFromAllProfiles(this.config);
    if (JSON.stringify(this.config.profiles) !== before) {
      this.save();
    }
  }

  migrateVault(vaultPath) {
    if (!vaultPath) return;
    const activeProfile = this.getActiveProfile();
    if (!activeProfile) return;

    const profileFolder = safeName(activeProfile.name);
    const newProfilePath = path.join(vaultPath, profileFolder);

    // Migrate WhatsApp Archive
    const legacyWA = path.join(vaultPath, 'WhatsApp Archive');
    const newWA = path.join(newProfilePath, 'WhatsApp Archive');
    if (fs.existsSync(legacyWA) && !fs.existsSync(newWA)) {
      try {
        fs.mkdirSync(newProfilePath, { recursive: true });
        fs.renameSync(legacyWA, newWA);
        console.log(`Successfully migrated WhatsApp Archive to: ${newWA}`);
      } catch (err) {
        console.error('Failed to migrate WhatsApp Archive structure:', err);
      }
    }

    // Migrate Telegram Archive
    const legacyTG = path.join(vaultPath, 'Telegram Archive');
    const newTG = path.join(newProfilePath, 'Telegram Archive');
    if (fs.existsSync(legacyTG) && !fs.existsSync(newTG)) {
      try {
        fs.mkdirSync(newProfilePath, { recursive: true });
        fs.renameSync(legacyTG, newTG);
        console.log(`Successfully migrated Telegram Archive structure to: ${newTG}`);
      } catch (err) {
        console.error('Failed to migrate Telegram Archive structure:', err);
      }
    }
  }

  load() {
    try {
      if (fs.existsSync(this.profilesPath)) {
        const data = JSON.parse(fs.readFileSync(this.profilesPath, 'utf8'));
        this.config = { ...this.config, ...data };

        // Promote profile vault path to root if global vaultPath is missing
        if (!this.config.vaultPath) {
          let firstVaultPath = null;
          for (const pId in this.config.profiles) {
            if (this.config.profiles[pId].vaultPath) {
              firstVaultPath = this.config.profiles[pId].vaultPath;
              break;
            }
          }
          if (firstVaultPath) {
            this.config.vaultPath = firstVaultPath;
            this.save();
          }
        }

        // Keep profiles in sync with the global vault path
        if (this.config.vaultPath) {
          let needsSave = false;
          for (const pId in this.config.profiles) {
            if (this.config.profiles[pId].vaultPath !== this.config.vaultPath) {
              this.config.profiles[pId].vaultPath = this.config.vaultPath;
              needsSave = true;
            }
          }
          if (needsSave) {
            this.save();
          }
        }
      } else {
        this.migrateLegacySettings();
      }
    } catch (error) {
      console.error('Failed to load profiles config, creating default:', error);
      this.createDefaultProfile();
    }
  }

  save() {
    try {
      fs.writeFileSync(this.profilesPath, JSON.stringify(this.config, null, 2), 'utf8');
    } catch (error) {
      console.error('Failed to save profiles config:', error);
    }
  }

  migrateLegacySettings() {
    let legacySettings = null;
    try {
      if (fs.existsSync(this.legacySettingsPath)) {
        legacySettings = JSON.parse(fs.readFileSync(this.legacySettingsPath, 'utf8'));
      }
    } catch (e) {
      console.error('Error reading legacy settings:', e);
    }

    const defaultProfile = {
      id: 'default',
      name: 'Default Account',
      icon: 'user',
      color: '#10b981',
      vaultPath: legacySettings?.vaultPath || null,
      whatsapp: {
        enabled: true,
        authDataPath: 'WhatsAppAuth/default',
        watcher: {
          globalEnabled: legacySettings?.globalEnabled || false,
          enabledChatIds: Array.isArray(legacySettings?.enabledChatIds) ? legacySettings.enabledChatIds : [],
        }
      },
      telegram: {
        enabled: false,
        session: '',
        watcher: {
          globalEnabled: false,
          enabledChatIds: []
        }
      },
      ocr: {
        language: 'eng+ara',
        autoScan: false,
        confidenceThreshold: 60
      }
    };

    this.config.profiles = { 'default': defaultProfile };
    this.config.activeProfileId = 'default';
    this.save();

    // Migrate WhatsApp authentication folder if it exists
    const legacyAuthPath = path.join(this.userDataPath, 'WhatsAppAuth');
    const newAuthPath = path.join(this.userDataPath, 'WhatsAppAuth', 'default');

    if (fs.existsSync(legacyAuthPath) && !fs.existsSync(newAuthPath)) {
      try {
        // Create the new default subdirectory
        fs.mkdirSync(newAuthPath, { recursive: true });
        
        // Move all items from WhatsAppAuth to WhatsAppAuth/default
        const items = fs.readdirSync(legacyAuthPath);
        for (const item of items) {
          if (item === 'default') continue; // Don't move the destination folder into itself
          const src = path.join(legacyAuthPath, item);
          const dest = path.join(newAuthPath, item);
          fs.renameSync(src, dest);
        }
        console.log('WhatsApp auth folder migrated successfully to WhatsAppAuth/default');
      } catch (err) {
        console.error('Failed to migrate WhatsApp auth directory:', err);
      }
    }

    // Clean up legacy settings file safely
    try {
      if (fs.existsSync(this.legacySettingsPath)) {
        fs.unlinkSync(this.legacySettingsPath);
      }
    } catch (err) {
      console.error('Failed to remove legacy settings file:', err);
    }
  }

  createDefaultProfile() {
    this.config.profiles = {
      'default': {
        id: 'default',
        name: 'Default Account',
        icon: 'user',
        color: '#10b981',
        vaultPath: null,
        whatsapp: {
          enabled: true,
          authDataPath: 'WhatsAppAuth/default',
          watcher: {
            globalEnabled: false,
            enabledChatIds: [],
          }
        },
        telegram: {
          enabled: false,
          session: '',
          watcher: {
            globalEnabled: false,
            enabledChatIds: []
          }
        },
        ocr: {
          language: 'eng+ara',
          autoScan: false,
          confidenceThreshold: 60
        }
      }
    };
    this.config.activeProfileId = 'default';
    this.save();
  }

  getActiveProfile() {
    const activeId = this.config.activeProfileId;
    const profile = this.config.profiles[activeId] || this.config.profiles['default'];
    return profile ? stripTelegramSecretsFromProfile(profile) : profile;
  }

  getActiveProfileId() {
    return this.config.activeProfileId;
  }

  /** Persist Telegram auth session on the stored profile (not a stripped copy). */
  setTelegramSession(session, enabled = true) {
    const id = this.config.activeProfileId;
    const profile = this.config.profiles[id];
    if (!profile) return null;
    if (!profile.telegram) profile.telegram = { watcher: { globalEnabled: false, enabledChatIds: [] } };
    fs.mkdirSync(this.telegramSessionsDir, { recursive: true });
    const sessionPath = this.telegramSessionPath(id);
    if (session) {
      fs.writeFileSync(sessionPath, String(session), 'utf8');
    } else if (fs.existsSync(sessionPath)) {
      fs.unlinkSync(sessionPath);
    }
    delete profile.telegram.session;
    profile.telegram.enabled = !!enabled;
    this.save();
    return stripTelegramSecretsFromProfile(profile);
  }

  getTelegramSession(profileId = this.config.activeProfileId) {
    const filePath = this.telegramSessionPath(profileId);
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf8').trim();
    }
    const profileSession = this.config.profiles[profileId]?.telegram?.session;
    return profileSession ? String(profileSession) : '';
  }

  hasTelegramSession(profileId = this.config.activeProfileId) {
    return this.getTelegramSession(profileId).length > 0;
  }

  listProfiles() {
    return Object.values(this.config.profiles).map(stripTelegramSecretsFromProfile);
  }

  createProfile(name, vaultPath = null, icon = 'user', color = '#10b981') {
    const id = crypto.randomUUID();
    const newProfile = {
      id,
      name,
      icon,
      color,
      vaultPath: this.config.vaultPath || vaultPath,
      whatsapp: {
        enabled: true,
        authDataPath: `WhatsAppAuth/${id}`,
        watcher: {
          globalEnabled: false,
          enabledChatIds: []
        }
      },
      telegram: {
        enabled: false,
        session: '',
        watcher: {
          globalEnabled: false,
          enabledChatIds: []
        }
      },
      ocr: {
        language: 'eng+ara',
        autoScan: false,
        confidenceThreshold: 60
      }
    };

    this.config.profiles[id] = newProfile;
    this.save();
    return stripTelegramSecretsFromProfile(newProfile);
  }

  updateProfile(id, updates) {
    if (!this.config.profiles[id]) return null;
    
    // Deep merge updates for simple structures
    const profile = this.config.profiles[id];
    
    if (updates.name !== undefined) profile.name = updates.name;
    if (updates.icon !== undefined) profile.icon = updates.icon;
    if (updates.color !== undefined) profile.color = updates.color;
    if (updates.vaultPath !== undefined) {
      this.config.vaultPath = updates.vaultPath;
      // Sync all profiles
      for (const pId in this.config.profiles) {
        this.config.profiles[pId].vaultPath = updates.vaultPath;
      }
    }
    
    if (updates.whatsapp) {
      profile.whatsapp = { ...profile.whatsapp, ...updates.whatsapp };
      if (updates.whatsapp.watcher) {
        profile.whatsapp.watcher = { ...profile.whatsapp.watcher, ...updates.whatsapp.watcher };
      }
    }
    
    if (updates.telegram) {
      const telegramUpdates = { ...updates.telegram };
      delete telegramUpdates.apiId;
      delete telegramUpdates.apiHash;
      profile.telegram = { ...profile.telegram, ...telegramUpdates };
      if (updates.telegram.watcher) {
        profile.telegram.watcher = { ...profile.telegram.watcher, ...updates.telegram.watcher };
      }
      delete profile.telegram.apiId;
      delete profile.telegram.apiHash;
    }

    if (updates.ocr) {
      profile.ocr = { ...profile.ocr, ...updates.ocr };
    }

    this.save();
    return stripTelegramSecretsFromProfile(profile);
  }

  deleteProfile(id) {
    if (id === 'default' || !this.config.profiles[id]) return false;
    
    // Clean up WhatsApp auth directories for this profile
    const profileAuthPath = path.join(this.userDataPath, 'WhatsAppAuth', id);
    if (fs.existsSync(profileAuthPath)) {
      try {
        fs.rmSync(profileAuthPath, { recursive: true, force: true });
      } catch (err) {
        console.error(`Failed to delete auth directory for profile ${id}:`, err);
      }
    }

    const telegramSessionPath = this.telegramSessionPath(id);
    if (fs.existsSync(telegramSessionPath)) {
      try {
        fs.unlinkSync(telegramSessionPath);
      } catch (err) {
        console.error(`Failed to delete Telegram session for profile ${id}:`, err);
      }
    }

    delete this.config.profiles[id];
    if (this.config.activeProfileId === id) {
      this.config.activeProfileId = 'default';
    }
    this.save();
    return true;
  }

  switchProfile(id) {
    if (!this.config.profiles[id]) return null;
    this.config.activeProfileId = id;
    this.save();
    return this.config.profiles[id];
  }

  getGlobalSettings() {
    return this.config.settings || { transcription: { modelSize: 'tiny' } };
  }

  updateGlobalSettings(updates) {
    if (!this.config.settings) {
      this.config.settings = { transcription: { modelSize: 'tiny' } };
    }
    
    if (updates.transcription) {
      this.config.settings.transcription = { ...this.config.settings.transcription, ...updates.transcription };
    }
    
    if (updates.appearance) {
      this.config.settings.appearance = { ...this.config.settings.appearance, ...updates.appearance };
    }

    this.save();
    return this.config.settings;
  }
}
