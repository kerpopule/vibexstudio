"""Bounded request contract shared by the image queue and the isolated renderer (Z-Image-Turbo)."""
import json

SIZES = ('1024*1024', '1280*768', '768*1280')
MIN_STEPS, MAX_STEPS = 4, 16


def decode_request(data):
    if type(data) is not bytes or len(data) > 65536:
        raise ValueError('Invalid image request size.')
    request = json.loads(data)
    if (type(request) is not dict or set(request) != {'prompt', 'size', 'steps', 'seed'}
            or type(request['prompt']) is not str or not request['prompt'].strip() or len(request['prompt']) > 600
            or request['size'] not in SIZES
            or type(request['steps']) is not int or not MIN_STEPS <= request['steps'] <= MAX_STEPS
            or type(request['seed']) is not int or not 0 <= request['seed'] < 2**32):
        raise ValueError('Invalid image prompt, size, steps or seed.')
    return request
