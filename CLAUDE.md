# mixxtape — 작업 규칙

친구들이 한 곡씩 몰래 넣어 같이 완성하는 블라인드 플레이리스트. `draft` 브랜치에서 새로 시작(2026-11-11). 이전 기록은 `main`·`v1` 브랜치.

## SSoT

| 무엇                                   | 원본                                                                                          |
| -------------------------------------- | --------------------------------------------------------------------------------------------- |
| 비전·원칙·결정 기록·리서치·디자인 태도 | Notion [mixxtape](https://app.notion.com/p/damhong/mixxtape-3f20e0600bce810296edc52af16b4c3a) |
| 화면·인터랙션·UI 문구·토큰             | `public/` (`style.css`의 `:root`)                                                             |
| API·블라인드 규칙                      | `src/worker.js`                                                                               |
| DB 스키마                              | `migrations/`                                                                                 |

결정을 바꾸거나 새로 내리면 Notion Decision Log에 한 줄 남긴다.

## 구성

지금은 **GitHub Pages 체험판**(급해서 서버는 보류): `draft`에 푸시하면 `public/`이 배포되고, `app.js`의 `LOCAL` 분기가 이 기기 localStorage를 서버처럼 쓴다. 친구 기기와는 공유되지 않는다.
서버(`src/worker.js` + D1)는 준비만 해둔 상태. 붙이면 `LOCAL` 분기가 꺼지고 같은 화면이 `/api`를 쓴다. 빌드 단계 없음, 프런트는 바닐라 JS.

- 블라인드는 서버가 지킨다: 개봉 전 응답에는 곡·닉네임을 싣지 않는다(내 곡만 예외)
- 로그인 없음: 참여자는 기기 토큰, 만든 사람은 관리 링크(`#k=열쇠`). 둘 다 해시로만 저장
- 개봉: 꽉 차면 / 마감이 지나면(읽을 때 판정) / 만든 사람이 강제로
- UI는 무채색, 색은 코인(곡)만. 제스처엔 버튼·키보드 대안, 모션 줄이기 존중

## 명령어

```bash
npm install
npm run db:local   # 로컬 D1에 스키마 적용
npm run dev        # http://localhost:8787
npm run db:remote  # 실제 D1에 스키마 적용
npm run deploy
```
