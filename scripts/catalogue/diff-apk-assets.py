"""对比新旧 APK 里的网页资源，定位「模型变糙」「动画全失效」这两处回归。

用法：python diff-apk-assets.py <old.apk> <new.apk>
输出：两包 assets/public 的条目差异、关键文件（模型/JS/动画样例）的大小与 CRC。
"""
import sys
import zipfile

old_apk, new_apk = sys.argv[1], sys.argv[2]
P = 'assets/public/'


def index(path):
    out = {}
    with zipfile.ZipFile(path) as z:
        for i in z.infolist():
            if i.filename.startswith(P):
                out[i.filename[len(P):]] = (i.file_size, i.CRC)
    return out


a = index(old_apk)
b = index(new_apk)
print(f'旧包 {len(a)} 条，新包 {len(b)} 条')

only_old = sorted(set(a) - set(b))
only_new = sorted(set(b) - set(a))
print(f'只在旧包: {len(only_old)}  只在新包: {len(only_new)}')
print('  旧包独有样例:', only_old[:8])
print('  新包独有样例:', only_new[:8])

# 关键文件对比
keys = [k for k in set(a) | set(b)
        if k.startswith(('models/', 'index.html')) or (k.startswith('assets/') and k.endswith('.js'))]
print('\n=== 关键文件（大小 / CRC 是否相同）===')
for k in sorted(keys):
    sa, ca = a.get(k, (None, None))
    sb, cb = b.get(k, (None, None))
    same = 'same' if (ca is not None and ca == cb) else 'DIFF'
    print(f'  {same:4}  {k:52} 旧={sa} 新={sb}')

# 动画/静帧覆盖率
clip_a = [k for k in a if k.startswith('exercise-media/clip/')]
clip_b = [k for k in b if k.startswith('exercise-media/clip/')]
still_a = [k for k in a if k.startswith('exercise-media/still/')]
still_b = [k for k in b if k.startswith('exercise-media/still/')]
print(f'\n动画：旧 {len(clip_a)}  新 {len(clip_b)}    静帧：旧 {len(still_a)}  新 {len(still_b)}')
sizes_b = [b[k][0] for k in clip_b]
if sizes_b:
    print(f'新包动画大小 min={min(sizes_b)} 中位={sorted(sizes_b)[len(sizes_b)//2]} max={max(sizes_b)}')
zeros = [k for k in clip_b if b[k][0] < 2000]
print(f'新包里小于 2KB 的动画（可疑）：{len(zeros)}', zeros[:5])
