/** Remove API secrets from profile objects before persisting to disk. */
export function stripTelegramSecretsFromProfile(profile) {
  if (!profile?.telegram) return profile;
  const telegramRest = { ...profile.telegram };
  delete telegramRest.apiId;
  delete telegramRest.apiHash;
  delete telegramRest.session;
  return { ...profile, telegram: telegramRest };
}

export function stripTelegramSecretsFromAllProfiles(config) {
  if (!config?.profiles) return config;
  for (const id of Object.keys(config.profiles)) {
    config.profiles[id] = stripTelegramSecretsFromProfile(config.profiles[id]);
  }
  return config;
}
