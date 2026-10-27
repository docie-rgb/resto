# resto

resto 프로젝트 진행 기록 블로그입니다. GitHub Pages(Jekyll)로 배포됩니다.

- 주소: https://docie-rgb.github.io/resto/

## 글 쓰는 법

1. `_posts/` 폴더에 `YYYY-MM-DD-제목.md` 형식으로 파일을 만듭니다. (예: `_posts/2026-10-30-week-1.md`)
2. 파일 맨 위에 다음 머리말을 넣고, 아래에 마크다운으로 본문을 씁니다.

   ```markdown
   ---
   title: 1주차 진행 상황
   summary: 목록에 표시될 한 줄 요약 (선택)
   tags: [진행상황, 회고]
   ---

   본문...
   ```

3. 커밋하고 push하면 1~2분 뒤 사이트에 반영됩니다.

   ```bash
   git add .
   git commit -m "글: 1주차 진행 상황"
   git push
   ```

- 파일 이름의 날짜가 오늘보다 미래이면 그날이 될 때까지 글이 보이지 않습니다.
- 이미지는 `assets/img/`에 넣고 본문에서 `![설명]({{ site.baseurl }}/assets/img/파일.png)`처럼 씁니다.

## 구조

| 경로 | 내용 |
| --- | --- |
| `_posts/` | 블로그 글 |
| `about.md` | 소개 페이지 |
| `_config.yml` | 사이트 제목, 설명 등 설정 |
| `_layouts/` | 페이지 틀 (HTML) |
| `assets/css/style.css` | 디자인 |
| `tetris/` | 테트리스 게임 |
| `battleship/` | 배틀쉽 게임 ([설명](battleship/README.md)) |
| `simon/` | 따라하며 누르기 게임 요청서 (PRD) |

## 게임

블로그 상단 메뉴에서 바로 플레이할 수 있고, 각 폴더의 `index.html`을 브라우저로 열어도 실행됩니다. 서버나 설치가 필요 없습니다.

| 게임 | 주소 |
| --- | --- |
| 테트리스 | https://docie-rgb.github.io/resto/tetris/ |
| 배틀쉽 | https://docie-rgb.github.io/resto/battleship/ |

배틀쉽 로직 테스트는 `battleship/test.html`을 브라우저로 열면 자동으로 실행됩니다.

## 배포

GitHub Pages가 `main` 브랜치의 루트 폴더를 Jekyll로 빌드해 배포합니다.
처음 한 번만 저장소 **Settings → Pages**에서 Source를 `Deploy from a branch`, Branch를 `main` / `/ (root)`로 지정하면, 이후에는 push할 때마다 자동으로 반영됩니다.
