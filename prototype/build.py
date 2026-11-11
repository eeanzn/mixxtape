"""prototype/index.html의 폰트 자리표시자(__FONT_400__ 등)를 Pretendard woff2(base64)로 채워 한 파일로 만든다.

- dist/mixxtape.html        : Artifact용 (문서 뼈대는 Artifact가 씌움)
- dist/pages/index.html    : GitHub Pages용 완전한 HTML 문서

사용법: python3 prototype/build.py   (CI: .github/workflows/pages.yml)
"""
import base64, pathlib

here = pathlib.Path(__file__).resolve().parent
dist = here / 'dist'
src = (here / 'index.html').read_text()
for weight, name in [('400', 'Regular'), ('600', 'SemiBold'), ('700', 'Bold'), ('800', 'ExtraBold')]:
    src = src.replace(f'__FONT_{weight}__', base64.b64encode((here / 'fonts' / f'Pretendard-{name}.subset.woff2').read_bytes()).decode())
assert '__FONT_' not in src

(dist / 'pages').mkdir(parents=True, exist_ok=True)
(dist / 'mixxtape.html').write_text(src)
cut = src.index('</style>') + len('</style>')
(dist / 'pages' / 'index.html').write_text(
    '<!doctype html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n'
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
    '<meta property="og:title" content="Mixxtape">\n'
    '<meta property="og:description" content="친구들이 한 곡씩 몰래 넣어 같이 완성하는 블라인드 플레이리스트">\n'
    f'{src[:cut]}\n</head>\n<body>{src[cut:]}\n</body>\n</html>\n')
(dist / 'pages' / '.nojekyll').write_text('')
print(dist / 'mixxtape.html', round(len(src.encode()) / 1024 / 1024, 2), 'MB')
