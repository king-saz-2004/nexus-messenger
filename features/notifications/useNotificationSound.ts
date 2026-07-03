import { useEffect } from 'react';

let sharedAudioContext: AudioContext | null = null;

const getAudioContext = () => {
  if (typeof window === 'undefined') return null;
  if (!sharedAudioContext) {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioCtx) {
      sharedAudioContext = new AudioCtx();
    }
  }
  return sharedAudioContext;
};

const playNotificationSound = () => {
  try {
    const audioContext = getAudioContext();
    if (!audioContext) return;

    if (audioContext.state === 'suspended') {
      audioContext.resume().catch(() => {});
    }

    const playTone = (frequency: number, startTime: number, duration: number) => {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(frequency, startTime);

      gain.gain.setValueAtTime(0.12, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration - 0.02);

      osc.connect(gain);
      gain.connect(audioContext.destination);

      osc.start(startTime);
      osc.stop(startTime + duration);
    };

    const now = audioContext.currentTime;
    playTone(587.33, now, 0.12); // D5
    playTone(880, now + 0.08, 0.24); // A5
  } catch (error) {
    console.error('Failed to play notification sound:', error);
  }
};

export const useNotificationSound = () => {
  useEffect(() => {
    const handleAudioGesture = () => {
      const audioContext = getAudioContext();
      if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume().catch(() => {});
      }
      window.removeEventListener('click', handleAudioGesture);
      window.removeEventListener('keydown', handleAudioGesture);
      window.removeEventListener('touchstart', handleAudioGesture);
    };

    window.addEventListener('click', handleAudioGesture);
    window.addEventListener('keydown', handleAudioGesture);
    window.addEventListener('touchstart', handleAudioGesture);

    return () => {
      window.removeEventListener('click', handleAudioGesture);
      window.removeEventListener('keydown', handleAudioGesture);
      window.removeEventListener('touchstart', handleAudioGesture);
    };
  }, []);

  return playNotificationSound;
};
