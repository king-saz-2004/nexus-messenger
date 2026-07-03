import { request, resolveResourceUrl } from './baseClient';

export const linkPreviewApi = {
  getLinkPreview: async (url: string, signal?: AbortSignal) => {
    const payload = await request<{
      preview: {
        url: string;
        title: string | null;
        description: string | null;
        image: string | null;
        siteName: string | null;
      } | null;
      disabled?: boolean;
    }>(`/link-preview?url=${encodeURIComponent(url)}`, { signal });
    if (payload.preview?.image) {
      payload.preview.image = resolveResourceUrl(payload.preview.image);
    }
    return payload;
  }
};
