import { utils } from 'telegram';

const MIME_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'application/pdf': 'pdf',
};

function findDocumentAttribute(attributes, className) {
  return (attributes || []).find((attr) => attr.className === className);
}

function extensionFromMime(mime, fallback = 'bin') {
  if (!mime) return fallback;
  if (MIME_EXT[mime]) return MIME_EXT[mime];
  const part = mime.split('/')[1]?.split(';')[0];
  return part && /^[a-z0-9]+$/i.test(part) ? part : fallback;
}

function classifyDocument(document) {
  if (!document) {
    return { type: 'document', hasMedia: false };
  }

  const attrs = document.attributes || [];
  const mimeType = document.mimeType || 'application/octet-stream';

  if (findDocumentAttribute(attrs, 'DocumentAttributeSticker')) {
    return { type: 'sticker', hasMedia: true, mimeType };
  }
  const audioAttr = findDocumentAttribute(attrs, 'DocumentAttributeAudio');
  if (audioAttr?.voice) {
    return { type: 'ptt', hasMedia: true, mimeType: mimeType.startsWith('audio/') ? mimeType : 'audio/ogg' };
  }
  const videoAttr = findDocumentAttribute(attrs, 'DocumentAttributeVideo');
  if (videoAttr?.roundMessage) {
    return { type: 'video', hasMedia: true, mimeType: mimeType.startsWith('video/') ? mimeType : 'video/mp4' };
  }
  if (findDocumentAttribute(attrs, 'DocumentAttributeAnimated') || mimeType === 'image/gif') {
    return { type: 'image', hasMedia: true, mimeType: mimeType === 'application/octet-stream' ? 'image/gif' : mimeType };
  }
  if (mimeType.startsWith('image/')) {
    return { type: 'image', hasMedia: true, mimeType };
  }
  if (mimeType.startsWith('audio/')) {
    return { type: 'audio', hasMedia: true, mimeType };
  }
  if (mimeType.startsWith('video/')) {
    return { type: 'video', hasMedia: true, mimeType };
  }
  return { type: 'document', hasMedia: true, mimeType };
}

export function classifyTelegramMedia(rawMsg) {
  const media = rawMsg?.media;
  if (!media) {
    return { type: 'chat', hasMedia: false, mimeType: null };
  }

  const mediaClass = media.className;

  if (mediaClass === 'MessageMediaPhoto') {
    return { type: 'image', hasMedia: true, mimeType: 'image/jpeg' };
  }

  if (mediaClass === 'MessageMediaDocument') {
    return classifyDocument(media.document);
  }

  if (mediaClass === 'MessageMediaWebPage') {
    const webpage = media.webpage;
    if (webpage?.className === 'WebPage') {
      if (webpage.document) {
        return classifyDocument(webpage.document);
      }
      if (webpage.photo) {
        return { type: 'image', hasMedia: true, mimeType: 'image/jpeg' };
      }
    }
    return { type: 'link', hasMedia: false, mimeType: null };
  }

  if (mediaClass === 'MessageMediaGeo' || mediaClass === 'MessageMediaGeoLive') {
    return { type: 'location', hasMedia: false, mimeType: null };
  }

  if (mediaClass === 'MessageMediaVenue') {
    return { type: 'location', hasMedia: false, mimeType: null };
  }

  if (mediaClass === 'MessageMediaContact') {
    return { type: 'vcard', hasMedia: false, mimeType: null };
  }

  if (mediaClass === 'MessageMediaPoll') {
    return { type: 'poll_creation', hasMedia: false, mimeType: null };
  }

  if (mediaClass === 'MessageMediaDice') {
    return { type: 'chat', hasMedia: false, mimeType: null };
  }

  if (mediaClass === 'MessageMediaGame' || mediaClass === 'MessageMediaInvoice') {
    return { type: 'document', hasMedia: true, mimeType: null };
  }

  return { type: 'chat', hasMedia: false, mimeType: null };
}

function resolveFilename(rawMsg, mimeType, type) {
  const media = rawMsg.media;
  let baseName = null;

  const document = media?.document
    || (media?.className === 'MessageMediaWebPage' && media.webpage?.document);

  if (document) {
    const fileAttr = findDocumentAttribute(document.attributes, 'DocumentAttributeFilename');
    if (fileAttr?.fileName) {
      baseName = fileAttr.fileName;
    }
  }

  if (!baseName) {
    const ext = extensionFromMime(mimeType, type === 'ptt' ? 'ogg' : 'bin');
    const prefix = {
      image: 'photo',
      video: 'video',
      audio: 'audio',
      ptt: 'voice',
      document: 'file',
    }[type] || 'media';
    baseName = `${prefix}_${rawMsg.id}.${ext}`;
  }

  baseName = baseName.replace(/[<>:"/\\|?*]/g, '_');
  return `${rawMsg.id}_${baseName}`;
}

function resolvePeerId(entity, fallback = null) {
  try {
    return utils.getPeerId(entity).toString();
  } catch {
    return fallback || entity?.id?.toString?.() || 'unknown';
  }
}

export class TelegramMessageAdapter {
  constructor(tgClient, rawMsg, chatEntity, senderEntity = null, chatPeerId = null) {
    this.tgClient = tgClient;
    this.rawMsg = rawMsg;
    this.chatEntity = chatEntity;
    this.senderEntity = senderEntity;
    this.chatPeerId = chatPeerId || resolvePeerId(chatEntity);

    this.id = {
      _serialized: `tg:${this.chatPeerId}:${rawMsg.id.toString()}`,
      id: rawMsg.id.toString(),
      fromMe: rawMsg.out,
    };

    this.timestamp = rawMsg.date;
    this.fromMe = rawMsg.out;
    this.author = rawMsg.senderId ? `tg:${rawMsg.senderId.toString()}` : null;
    this.from = this.author || this.chatPeerId;
    this.to = rawMsg.out ? this.chatPeerId : 'me';
    this.body = rawMsg.message || '';

    const classified = classifyTelegramMedia(rawMsg);
    this.type = classified.type;
    this.hasMedia = classified.hasMedia;
    this.mediaMimeType = classified.mimeType;

    this.hasQuotedMsg = !!rawMsg.replyTo;
  }

  async getContact() {
    let name;
    let number;

    if (this.senderEntity) {
      name = this.senderEntity.firstName
        ? `${this.senderEntity.firstName} ${this.senderEntity.lastName || ''}`.trim()
        : this.senderEntity.title || this.senderEntity.username || 'Telegram User';
      number = this.senderEntity.phone || this.senderEntity.id.toString();
    } else {
      name = this.fromMe ? 'Me' : 'Telegram Sender';
      number = this.from;
    }

    return {
      name,
      pushname: name,
      shortName: name,
      number,
      id: { _serialized: this.author || number },
    };
  }

  async getQuotedMessage() {
    if (!this.hasQuotedMsg) return null;
    try {
      const replyToMsgId = this.rawMsg.replyTo.replyToMsgId;
      const messages = await this.tgClient.getMessages(this.chatEntity, { ids: [replyToMsgId] });
      if (messages && messages.length > 0) {
        let replySender = null;
        if (messages[0].senderId) {
          try {
            replySender = await this.tgClient.getEntity(messages[0].senderId);
          } catch {
            // ignore
          }
        }
        return new TelegramMessageAdapter(this.tgClient, messages[0], this.chatEntity, replySender);
      }
    } catch (e) {
      console.warn('Failed to fetch quoted Telegram message:', e);
    }
    return { body: 'Replying to an older message' };
  }

  resolveDownloadMeta() {
    const mimeType = this.mediaMimeType || 'application/octet-stream';
    return {
      mimetype: mimeType,
      filename: resolveFilename(this.rawMsg, mimeType, this.type),
    };
  }

  async downloadMedia() {
    if (!this.hasMedia || !this.rawMsg.media) return null;

    try {
      const buffer = await this.tgClient.downloadMedia(this.rawMsg, {
        workers: 4,
      });

      if (!buffer) return null;

      const dataBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(String(buffer), 'binary');
      if (!dataBuffer.length) return null;

      const { mimetype, filename } = this.resolveDownloadMeta();

      return {
        mimetype,
        data: dataBuffer.toString('base64'),
        filename,
      };
    } catch (e) {
      console.error('Failed to download Telegram media:', e?.message || e);
      throw e;
    }
  }
}
