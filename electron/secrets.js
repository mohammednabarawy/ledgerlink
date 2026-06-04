/** Remove API secrets from profile objects before persisting to disk. */
export function stripTelegramSecretsFromProfile(profile) {
  if (!profile?.telegram) return profile;
  const { apiId, apiHash, ...telegramRest } = profile.telegram;
  return { ...profile, telegram: telegramRest };
}

export function stripTelegramSecretsFromAllProfiles(config) {
  if (!config?.profiles) return config;
  for (const id of Object.keys(config.profiles)) {
    config.profiles[id] = stripTelegramSecretsFromProfile(config.profiles[id]);
  }
  return config;
}
