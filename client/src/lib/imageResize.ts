/**
 * Turn any photo into a small square JPEG for a profile picture: centre-cropped,
 * 256×256, around 20–40 KB — whatever size the original was. Done in the
 * browser, so a 12 MB phone photo never has to be uploaded at all.
 */
const SIZE = 256;
const QUALITY = 0.85;
/** Anything bigger than this is almost certainly not a photo anyone meant to pick. */
const MAX_INPUT_BYTES = 30 * 1024 * 1024;

export class PictureError extends Error {
  constructor(public code: 'not_an_image' | 'too_large') { super(code); }
}

export async function squarePicture(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new PictureError('not_an_image');
  if (file.size > MAX_INPUT_BYTES) throw new PictureError('too_large');

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new PictureError('not_an_image'));
      el.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    if (!side) throw new PictureError('not_an_image');
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(
      img,
      (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side,
      0, 0, SIZE, SIZE
    );
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
    if (!blob) throw new PictureError('not_an_image');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}
