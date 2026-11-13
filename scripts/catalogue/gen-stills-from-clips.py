# 从动画 WebP 片段的第一帧生成缺失的静帧。
#
# 背景：原素材只给了一部分片段画了静帧（catalogue/media/still 3370 张 + 别名补齐 297 张），
# 其余约 2887 个片段没有静帧。静帧是「只用静帧」的列表（训练页行缩略图、打印页）和
# 卡片预览在动画加载前的兜底，缺了就是一个占位块，看起来像「没有预览」。
#
# 命名与 stage-media.mjs 完全一致：still/<片段文件名>.webp。写到两处：
#   catalogue/media/still                    —— 源，之后每次构建 stage-media.mjs 都会带上
#   app/frontend/dist/exercise-media/still   —— 当前构建产物，立即可用
#
# 用法：
#   python scripts/catalogue/gen-stills-from-clips.py [--dist dist-new]
# 生成完再跑一次别名补齐（把配对编号的静帧也补上）：
#   node scripts/catalogue/stage-media.mjs dist --aliases-only
import os
import sys
from PIL import Image

repo = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
dist = os.path.join(repo, 'app/frontend/dist')
if '--dist' in sys.argv:
    dist = os.path.normpath(os.path.join(repo, 'app/frontend', sys.argv[sys.argv.index('--dist') + 1]))

CLIP = os.path.join(dist, 'exercise-media', 'clip')
STILL_DIST = os.path.join(dist, 'exercise-media', 'still')
STILL_SRC = os.path.join(repo, 'catalogue', 'media', 'still')
for d in (STILL_SRC, STILL_DIST):
    os.makedirs(d, exist_ok=True)

names = sorted(n for n in os.listdir(CLIP) if n.lower().endswith('.webp'))
todo = [n for n in names
        if not os.path.exists(os.path.join(STILL_SRC, n))
        and not os.path.exists(os.path.join(STILL_DIST, n))]
print(f'clips {len(names)}, missing stills {len(todo)}', flush=True)

ok = fail = 0
for i, n in enumerate(todo):
    try:
        im = Image.open(os.path.join(CLIP, n))
        im.seek(0)                     # 第一帧：起始姿势
        frame = im.convert('RGB')      # 片段帧本身不透明（白底），与现有静帧（RGB）一致
        for d in (STILL_SRC, STILL_DIST):
            frame.save(os.path.join(d, n), 'WEBP', quality=80, method=4)
        ok += 1
    except Exception as e:
        fail += 1
        if fail <= 8:
            print('FAIL', n, repr(e), flush=True)
    if (i + 1) % 400 == 0:
        print(f'{i + 1}/{len(todo)}', flush=True)
print(f'done ok={ok} fail={fail}', flush=True)
