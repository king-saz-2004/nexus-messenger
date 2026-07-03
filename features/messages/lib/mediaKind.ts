export type SendMediaKind = 'voice' | 'audio' | 'photo' | 'video';

export const gbToBytes = (gb: number): number => Math.round(gb * 1000) * 1024 * 1024;

export const getMediaKindFromFile = (file: File): SendMediaKind => {
  const mime = file.type.toLowerCase();
  if (mime.startsWith('image/')) return 'photo';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext) {
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext)) {
      return 'photo';
    }
    if (['mp4', 'webm', 'mov', 'avi', 'mkv', 'flv', 'm4v', '3gp'].includes(ext)) {
      return 'video';
    }
    if (['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus'].includes(ext)) {
      return 'audio';
    }
  }
  return 'photo';
};
