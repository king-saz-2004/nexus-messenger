import { MediaLimits } from '../../types';
import { request, requestBlob } from './baseClient';

export const mediaApi = {
  fetchMediaBlob: (pathOrUrl: string, signal?: AbortSignal, onProgress?: (percent: number) => void) =>
    requestBlob(pathOrUrl, signal, onProgress),
  getMediaLimits: () => request<MediaLimits>('/media/limits')
};
