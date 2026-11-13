/** The game's public link: this page without dev/test flags like ?unlockall. */
export const gameUrl = (): string => location.origin + location.pathname;

/**
 * Share a picture with a caption: the native share sheet where the browser can share
 * files (phones, Edge/Chrome on Windows), else download the picture and copy the caption.
 * Call from a click/key handler; share sheets need a recent user gesture.
 */
export async function shareImage(blob: Blob, filename: string, caption: string): Promise<'shared' | 'saved' | 'cancelled'> {
  const text = `${caption} ${gameUrl()}`;
  const file = new File([blob], filename, { type: blob.type || 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text, title: 'Grand Line Survivor' });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled';
      // Any other failure (e.g. the gesture expired): fall through to download.
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  await navigator.clipboard?.writeText(text).catch(() => undefined);
  return 'saved';
}
