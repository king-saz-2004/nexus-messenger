import { buildLinkPreview } from '../services/linkPreview/metadata.js';
import { assertSafeHttpUrl } from '../services/linkPreview/urlSafety.js';

type CheckResult = {
  name: string;
  status: 'pass' | 'fail' | 'skip';
  details?: Record<string, unknown>;
};

const checks: CheckResult[] = [];

const record = (name: string, passed: boolean, details?: Record<string, unknown>) => {
  checks.push({ name, status: passed ? 'pass' : 'fail', details });
  const status = passed ? 'PASS' : 'FAIL';
  console.log(`${status} ${name}`, details ? JSON.stringify(details) : '');
};

const skip = (name: string, details?: Record<string, unknown>) => {
  checks.push({ name, status: 'skip', details });
  console.log(`SKIP ${name}`, details ? JSON.stringify(details) : '');
};

const assertPreview = async (
  name: string,
  url: string,
  validate: (preview: Awaited<ReturnType<typeof buildLinkPreview>>) => boolean
) => {
  try {
    const preview = await buildLinkPreview(url);
    record(name, validate(preview), {
      title: preview?.title ?? null,
      image: preview?.image ?? null,
      siteName: preview?.siteName ?? null
    });
  } catch (error) {
    record(name, false, { error: error instanceof Error ? error.message : String(error) });
  }
};

await assertPreview(
  'Afraa product URL has cached image',
  process.env.LINK_PREVIEW_CHECK_AFRAA_URL ??
    'https://afraa.shop/product/afp-98474-98475-98476-98477-galaxy-a56-12gb-256gb-2025/',
  preview => Boolean(preview?.image?.startsWith('/link-preview/image/'))
);

await assertPreview(
  'Aparat URL still has cached image',
  process.env.LINK_PREVIEW_CHECK_APARAT_URL ?? 'https://www.aparat.com/v/qqriy8f?refererRef=channel_page',
  preview => Boolean(preview?.image?.startsWith('/link-preview/image/'))
);

const youtubeCheckUrl = process.env.LINK_PREVIEW_CHECK_YOUTUBE_URL;
if (youtubeCheckUrl) {
  await assertPreview(
    'YouTube oEmbed still works',
    youtubeCheckUrl,
    preview => Boolean(preview?.title && preview.siteName === 'YouTube')
  );
} else {
  skip('YouTube oEmbed still works', {
    reason: 'Set LINK_PREVIEW_CHECK_YOUTUBE_URL to run this live-network check.'
  });
}

await assertPreview(
  'Simple OpenGraph page keeps image path when available',
  process.env.LINK_PREVIEW_CHECK_OG_URL ?? 'https://github.com/microsoft/TypeScript',
  preview => Boolean(preview?.title && preview.image?.startsWith('/link-preview/image/'))
);

await assertPreview(
  'Page with no image still returns metadata',
  process.env.LINK_PREVIEW_CHECK_NO_IMAGE_URL ?? 'https://example.com/',
  preview => Boolean(preview?.title && !preview.image)
);

record('Private/internal IP URL is blocked', (await buildLinkPreview('http://127.0.0.1:4000/')) === null);
record('Malformed URL is rejected', assertSafeHttpUrl('not a url') === null);

const failed = checks.filter(check => check.status === 'fail');
if (failed.length > 0) {
  console.error(`link preview manual check failed: ${failed.length}/${checks.length}`);
  process.exitCode = 1;
}
