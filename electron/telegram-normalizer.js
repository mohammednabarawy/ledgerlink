export class TelegramMessageAdapter {
  constructor(tgClient, rawMsg, chatEntity, senderEntity = null) {
    this.tgClient = tgClient; // GramJS client instance
    this.rawMsg = rawMsg;
    this.chatEntity = chatEntity;
    this.senderEntity = senderEntity;

    this.id = {
      _serialized: `tg:${chatEntity.id.toString()}:${rawMsg.id.toString()}`,
      id: rawMsg.id.toString(),
      fromMe: rawMsg.out,
    };
    
    this.timestamp = rawMsg.date;
    this.fromMe = rawMsg.out;
    this.from = chatEntity.id.toString();
    this.to = rawMsg.out ? chatEntity.id.toString() : 'me';
    this.body = rawMsg.message || '';
    
    // Resolve Message Type
    this.type = 'chat';
    this.hasMedia = false;
    
    if (rawMsg.media) {
      const mediaClass = rawMsg.media.className;
      if (mediaClass === 'MessageMediaPhoto') {
        this.type = 'image';
        this.hasMedia = true;
      } else if (mediaClass === 'MessageMediaDocument') {
        this.hasMedia = true;
        const document = rawMsg.media.document;
        const mimeType = document?.mimeType || '';
        if (mimeType.startsWith('audio/')) {
          this.type = 'audio';
        } else if (mimeType.startsWith('video/')) {
          this.type = 'video';
        } else {
          this.type = 'document';
        }
      } else if (mediaClass === 'MessageMediaGeo' || mediaClass === 'MessageMediaGeoLive') {
        this.type = 'location';
      } else if (mediaClass === 'MessageMediaContact') {
        this.type = 'vcard';
      } else if (mediaClass === 'MessageMediaPoll') {
        this.type = 'poll_creation';
      }
    }

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
      // Fallback
      name = this.fromMe ? 'Me' : 'Telegram Sender';
      number = this.from;
    }

    return {
      name,
      pushname: name,
      shortName: name,
      number,
      id: { _serialized: number }
    };
  }

  async getQuotedMessage() {
    if (!this.hasQuotedMsg) return null;
    try {
      const replyToMsgId = this.rawMsg.replyTo.replyToMsgId;
      const messages = await this.tgClient.getMessages(this.chatEntity, { ids: [replyToMsgId] });
      if (messages && messages.length > 0) {
        // Find sender for reply
        let replySender = null;
        if (messages[0].senderId) {
          try {
            replySender = await this.tgClient.getEntity(messages[0].senderId);
          } catch {
            // Ignore error
          }
        }
        return new TelegramMessageAdapter(this.tgClient, messages[0], this.chatEntity, replySender);
      }
    } catch (e) {
      console.warn('Failed to fetch quoted Telegram message:', e);
    }
    return { body: 'Replying to an older message' };
  }

  async downloadMedia() {
    if (!this.hasMedia || !this.rawMsg.media) return null;
    try {
      const buffer = await this.tgClient.downloadMedia(this.rawMsg.media, {
        workers: 1
      });
      if (!buffer) return null;

      // Extract original filename if available
      let filename = null;
      let mimetype = 'application/octet-stream';
      
      if (this.rawMsg.media.document) {
        mimetype = this.rawMsg.media.document.mimeType || mimetype;
        const attributes = this.rawMsg.media.document.attributes || [];
        const fileAttr = attributes.find(a => a.className === 'DocumentAttributeFilename');
        if (fileAttr) filename = fileAttr.fileName;
      } else if (this.rawMsg.media.className === 'MessageMediaPhoto') {
        mimetype = 'image/jpeg';
        filename = `photo_${this.rawMsg.id.toString()}.jpg`;
      }

      if (!filename) {
        const ext = mimetype.split('/')[1]?.split(';')[0] || 'bin';
        filename = `media_${this.rawMsg.id.toString()}.${ext}`;
      }

      return {
        mimetype,
        data: buffer.toString('base64'),
        filename
      };
    } catch (e) {
      console.error('Failed to download Telegram media:', e);
      throw e;
    }
  }
}
