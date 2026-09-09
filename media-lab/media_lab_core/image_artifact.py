"""Independent decode gate for generated images: a single-frame PNG of exactly the requested supported size."""
import hashlib
import io

from PIL import Image

MAX_BYTES = 20 * 1024**2
SIZES = {(1024, 1024), (1280, 768), (768, 1280)}


def inspect_png(data):
    if type(data) is not bytes or not 64 <= len(data) <= MAX_BYTES:
        raise ValueError('Image output has an invalid size.')
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError('Image output is not a PNG.')
    try:
        with Image.open(io.BytesIO(data)) as image:
            if image.format != 'PNG' or getattr(image, 'n_frames', 1) != 1 or image.size not in SIZES:
                raise ValueError('Image output must be a single-frame PNG of a supported size.')
            image.load()
            width, height = image.size
    except (OSError, Image.DecompressionBombError) as error:
        raise ValueError('Image output could not be decoded.') from error
    return {'mimeType': 'image/png', 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(), 'width': width, 'height': height}
