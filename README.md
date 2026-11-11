# Mixxtape

> 친구들이 한 곡씩 몰래 넣어 같이 완성하는 블라인드 플레이리스트.

로그인 없이 링크로 들어와 1인 1곡을 넣고, 다 찰 때까지 누가 뭘 넣었는지 아무도 몰라요. 꽉 차면 개봉하고 각자 쓰는 앱으로 가져가요.

- 데모: https://eeanzn.github.io/mixxtape/ (서버 없이 이 기기에만 저장)
- 기획·결정 기록: [Notion · Mixxtape](https://app.notion.com/p/damhong/Mixxtape-3f20e0600bce810296edc52af16b4c3a)
- 지난 버전(V1, 아코디언 피드·Stage 2 앱): [`v1` 브랜치](https://github.com/eeanzn/mixxtape/tree/v1)

| 폴더         | 무엇                                             |
| ------------ | ------------------------------------------------ |
| `prototype/` | V2 1차 프로토타입 (한 파일 HTML) + 빌드 스크립트 |

```bash
python3 prototype/build.py   # → prototype/dist/mixxtape.html (Artifact), prototype/dist/pages/ (GitHub Pages)
```
