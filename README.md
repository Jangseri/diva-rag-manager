# DIVA RAG Manager

RAG 학습 자료 관리 웹 애플리케이션.
파일·URL 등록, 추출/인덱싱 상태 추적, 분산 삭제, RAG 검색(BM25 / Vector / Hybrid)을 제공합니다.

Next.js 16 App Router 기반 풀스택 단일 프로젝트이며, 외부 서비스
(docs-extract-system, milvus-indexer, milvus-broker)와 **Redis Streams + HTTP**로 연동됩니다.

---

## 빠른 시작 (로컬 개발)

```bash
npm install

# 환경변수 준비 (DB/Redis/broker 주소 입력)
cp .env.example .env.local
cp .env.example .env          # Prisma CLI 전용

npx prisma generate
npm run dev                   # http://localhost:3000
```

DB가 아직 없다면 `prisma/init_schema.sql` 을 한 번 실행하면 전체 스키마가 만들어집니다.

> Redis에 붙지 않는 환경이라면 `.env.local` 에 `ENABLE_REDIS_CONSUMER="false"` 로 두세요.

### 주요 스크립트

| 명령 | 설명 |
|------|------|
| `npm run dev` | 개발 서버 |
| `npm run build` | 프로덕션 빌드 (standalone) |
| `npm run test` | Vitest watch |
| `npm run test:run` | 테스트 1회 실행 |
| `npm run lint` | ESLint |

---

## 화면

| 경로 | 설명 |
|------|------|
| `/documents` | 학습 자료 목록 — 검색·필터·페이지네이션, 파일/URL 등록, 개별·일괄 삭제 |
| `/documents/[id]` | 상세 — 메타데이터, 원본/추출 결과 미리보기, 다운로드 |
| `/search` | RAG 검색 — BM25 / Vector / Hybrid 3종 결과를 나란히 비교 |

---

## 문서

| 문서 | 내용 |
|------|------|
| [DEVELOPMENT.md](DEVELOPMENT.md) | 아키텍처, 디렉토리 구조, DB 스키마, API 스펙, 상태 전이 |
| [HANDOFF.md](HANDOFF.md) | 외부 시스템 연동 가이드 (Redis 이벤트, milvus-broker, extract API) |
| [DEPLOY.md](DEPLOY.md) | 서버 배포 절차, DB 구축, 운영 명령어, 트러블슈팅 |
| [CHANGELOG.md](CHANGELOG.md) | 변경 이력 |
| [AGENTS.md](AGENTS.md) | AI 코딩 에이전트용 규칙 |

---

## DB 스키마 관리

`prisma/schema.prisma` 와 `prisma/init_schema.sql` 이 **함께** 정답입니다.

- **신규 구축** → `prisma/init_schema.sql` 하나만 실행
- **기존 DB 갱신** → 해당 날짜의 `prisma/migrate_*.sql` 적용
- 스키마를 바꿀 때는 **`schema.prisma` 와 SQL 파일을 같은 커밋에** 넣어주세요.
  (한쪽만 바꾸면 신규 서버 구축 시 코드와 DB가 어긋납니다)

자세한 내용은 [DEPLOY.md](DEPLOY.md#4-db-스키마-생성-최초-1회) 참고.
