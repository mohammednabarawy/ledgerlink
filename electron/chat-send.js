/**
 * Send outbound chat messages via WhatsApp Web or Telegram.
 */

export async function sendWhatsAppMessage(client, chatId, text, replyToMessageId = null) {
  if (!client) throw new Error('WhatsApp client not initialized');
  const chat = await client.getChatById(chatId);
  if (!chat) throw new Error('Chat not found');

  if (replyToMessageId) {
    const messages = await chat.fetchMessages({ limit: 100 });
    const quoted = messages.find((m) => m.id?._serialized === replyToMessageId);
    if (quoted?.reply) {
      const sent = await quoted.reply(text);
      return { success: true, messageId: sent?.id?._serialized || null };
    }
  }

  const sent = await chat.sendMessage(text);
  return { success: true, messageId: sent?.id?._serialized || null };
}
