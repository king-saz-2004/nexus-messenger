export const mapMessageType = (value: string | null | undefined): 'text' | 'system' | 'image' | 'video' | 'audio' => {
  if (!value) return 'text';
  if (value === 'system') return 'system';
  if (value === 'photo' || value === 'sticker' || value === 'animation') return 'image';
  if (value === 'video' || value === 'video_note') return 'video';
  if (value === 'audio' || value === 'voice') return 'audio';
  return 'text';
};
