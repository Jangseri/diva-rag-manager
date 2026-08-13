# RAG Manager 배포 가이드

## 사전 요구사항

- Docker, docker-compose 설치
- 다음 서비스 접속 가능:
  - MariaDB 10.11+ (DB명 `extract_document`)
  - Redis (docs-extract-system 이벤트 스트림)
  - milvus-broker (검색 API)
  - extract-unstructured (URL 학습 HTTP API)

> 기존 운영 서버는 아래 구성입니다. **신규 서버 구축 시 IP/계정을 모두 교체**하세요.
>
> | 항목 | 기존 값 |
> |------|---------|
> | 앱 서버 | 192.168.220.223 (seri 계정, uid 1007 / gid 1012) |
> | MariaDB | 192.168.220.223:3306 |
> | Redis | 192.168.220.222:6379 |
> | milvus-broker | 192.168.220.223:8009 |
> | extract-unstructured | 192.168.220.223:9005 |
>
> 교체가 필요한 파일: `.env`, `docker-compose.yml`(`APP_UID`/`APP_GID`/`NEXT_PUBLIC_APP_URL` 은 `.env` 로 주입 가능)

---

## 배포 구조

```
/data/diva/
├── rag-manager/           ← 프로젝트 위치 (여기서 docker-compose 실행)
│   ├── docker-compose.yml
│   ├── docker/Dockerfile
│   ├── .env               ← 민감정보 (git 제외)
│   └── logs/              ← 자동 생성 (rag-manager 로그)
├── origin/                ← 원본 파일 저장 (rag-manager가 생성)
│   └── {clientServiceId}/{tenantId}/{file_id}.{ext}
└── extract/               ← 추출 결과 (docs-extract-system이 저장, rag-manager는 읽기만)
```

> `origin`, `extract` 는 rag-manager 컨테이너와 docs-extract-system이 **함께 접근**하는
> 공유 볼륨입니다. 신규 서버에서도 두 서비스가 같은 경로를 보도록 구성해야 합니다.

---

## 최초 배포 절차

### 1. 서버 접속 및 디렉토리 준비

```bash
ssh <계정>@<앱서버IP>

# 공유 볼륨 디렉토리 생성
sudo mkdir -p /data/diva/origin /data/diva/extract
sudo chown -R <계정>:<그룹> /data/diva

# 이 계정의 uid/gid를 확인해 두세요 (3단계 .env의 APP_UID/APP_GID에 사용)
id <계정>
```

### 2. 프로젝트 파일 배치

```bash
cd /data/diva
git clone <repository-url> rag-manager
# 또는 rsync로 복사
# rsync -av --exclude node_modules --exclude .next --exclude storage ./ <계정>@<앱서버IP>:/data/diva/rag-manager/

cd rag-manager
```

### 3. 환경변수 파일 생성

```bash
cp .env.production.example .env
vi .env  # 실제 DB 비밀번호 등 입력
```

`.env` 내용 예시:
```
DATABASE_URL="mysql://root:<비밀번호>@<DB_HOST>:3306/extract_document"
REDIS_URL="redis://<REDIS_HOST>:6379/0"
MILVUS_BROKER_URL="http://<BROKER_HOST>:8009"
EXTRACT_SERVICE_URL="http://<EXTRACT_HOST>:9005"
NEXT_PUBLIC_APP_URL="http://<앱서버IP>:3000"
APP_UID=1007
APP_GID=1012
```

> 비밀번호 특수문자 URL 인코딩: `!`→`%21`, `@`→`%40`
>
> `APP_UID`/`APP_GID`는 **호스트에서 `/data/diva` 를 소유한 계정**의 uid/gid 입니다.
> 신규 서버에서는 `id <계정명>` 으로 확인해 채우세요. 이 값으로 컨테이너가
> 실행되므로 업로드 파일이 호스트 계정 소유로 생성됩니다.
>
> `MILVUS_COLLECTION_NAME` 은 더 이상 사용하지 않습니다. 컬렉션은 요청의
> `clientServiceId` 로 동적 지정됩니다.

### 4. DB 스키마 생성 (최초 1회)

**신규 서버는 `prisma/init_schema.sql` 하나만 실행하면 됩니다.**
(운영 DB의 실제 DDL을 그대로 옮긴 파일이라 `prisma/schema.prisma` 와 정확히 일치합니다.)

```bash
mysql -h <DB_HOST> -u root -p < prisma/init_schema.sql
```

또는 MariaDB 클라이언트 접속 후:
```sql
SOURCE prisma/init_schema.sql;
```

검증 — 아래 결과가 `tenant_id`, `varchar(100)` 로 나와야 정상입니다:
```sql
USE extract_document;
SHOW COLUMNS FROM document_files LIKE 'tenant_id';
SHOW COLUMNS FROM processed_events LIKE 'event_id';
```

> ⚠️ `prisma/` 하위의 `create_table.sql`, `alter_add_user_key.sql`,
> `migrate_*.sql`, `reset_*.sql` 은 **과거 이력 보존용**입니다.
> 순서대로 실행해도 현재 코드와 맞지 않으니 신규 구축에 사용하지 마세요.
>
> ⚠️ `extract_document` DB는 **docs-extract-system(extract-unstructured)과 공유**합니다.
> 해당 서비스의 테이블(`extraction_task`, `alembic_version`)은 그쪽 저장소의
> Alembic 마이그레이션으로 별도 생성해야 합니다. rag-manager는 생성하지 않습니다.

#### 기존 DB를 현재 코드에 맞추는 경우

구버전 SQL로 만들어진 DB(= `user_key` 컬럼이 있는 DB)라면:
```sql
SOURCE prisma/migrate_20260629_tenant_id.sql;
```

### 5. 빌드 및 실행

```bash
# 이미지 빌드 + 백그라운드 실행
docker compose up -d --build

# 로그 실시간 확인
docker compose logs -f
```

### 6. 동작 확인

```bash
# 헬스체크
curl http://localhost:3000/api/health
```

정상 응답:
```json
{
  "status": "ok",
  "checks": {
    "database": { "status": "ok" },
    "origin_storage": { "status": "ok" },
    "extract_storage": { "status": "ok" },
    "redis": { "status": "ok" },
    "milvus_broker": { "status": "ok" }
  }
}
```

브라우저 접속:
```
http://<앱서버IP>:3000
```

---

## 업데이트 배포

```bash
cd /data/diva/rag-manager

# 1. 최신 코드 받기
git pull

# 2. 재빌드 + 재시작
docker compose up -d --build

# 3. 로그 확인
docker compose logs -f --tail 100
```

---

## 운영 명령어

### 컨테이너 관리

```bash
# 실행 상태 확인
docker compose ps

# 중지
docker compose stop

# 재시작
docker compose restart

# 중지 + 컨테이너 제거
docker compose down

# 완전 재빌드
docker compose up -d --build --force-recreate
```

### 로그 확인

```bash
# 실시간 로그 (컨테이너 전체 stdout)
docker compose logs -f

# 최근 100줄
docker compose logs --tail 100

# Pino 로그 파일 (구조화된 JSON)
tail -f logs/app.log-$(date +%Y-%m-%d)

# 에러만
tail -f logs/error.log-$(date +%Y-%m-%d)

# 특정 테넌트 로그 검색
grep '"tenantId":"<테넌트ID>"' logs/app.log-*
```

### 헬스체크 모니터링

```bash
# 5초마다 상태 확인
watch -n 5 'curl -s http://localhost:3000/api/health | jq'
```

---

## 문제 해결

### 컨테이너가 시작 안 됨

```bash
docker compose logs rag-manager
```

주요 원인:
- `.env` 파일 없음 → `cp .env.production.example .env` 후 내용 입력
- DB 접속 실패 → DATABASE_URL 비밀번호 확인, 방화벽 확인
- 볼륨 권한 문제 → 아래 "파일 업로드 실패" 참고

### DB 컬럼 관련 에러 (P2022 / Unknown column)

`Unknown column 'tenant_id'` 또는 Prisma `P2022` 가 나오면 DB 스키마가 코드보다
구버전입니다. `prisma/migrate_20260629_tenant_id.sql` 을 적용하세요.
신규 구축이면 `prisma/init_schema.sql` 로 다시 만드는 편이 확실합니다.

### 파일 업로드 실패

```bash
# 권한 확인
ls -la /data/diva/origin
```

컨테이너는 `docker-compose.yml` 의 `user:` 설정(`APP_UID:APP_GID`, 기본 1007:1012)으로
실행됩니다. Dockerfile 내부 `nextjs` 유저(uid 1001)는 이 설정에 의해 덮어써집니다.
호스트 디렉토리 소유자를 그 uid/gid에 맞추세요:

```bash
id <계정명>                       # uid/gid 확인
sudo chown -R <uid>:<gid> /data/diva
```

### Redis 연결 실패

```bash
# 호스트에서 Redis 확인
redis-cli -h <REDIS_HOST> ping
```

`PONG` 안 오면 Redis 서버 관리자에게 확인 요청.

### milvus-broker 연결 실패

헬스체크에 `milvus_broker: error` 나와도 업로드/목록은 정상 동작합니다 (검색만 불가). docs-extract-system 개발자에게 서비스 상태 확인 요청.

---

## 보안 체크리스트

- [ ] `.env` 파일이 git에 커밋되지 않았는지 확인 (`.gitignore`에 포함됨)
- [ ] DATABASE_URL 비밀번호는 실제 운영용으로 교체
- [ ] 서버 방화벽에서 3000 포트 필요한 대역만 허용
- [ ] 로그 파일(`logs/`)에 민감정보 기록되지 않는지 주기 점검
- [ ] 공유 볼륨(`/data/diva`) 디스크 용량 모니터링

---

## 백업/복구

### 백업 대상

| 항목 | 경로 | 주기 |
|------|------|------|
| DB | MariaDB `extract_document` | 매일 |
| 원본 파일 | `/data/diva/origin` | 매일 |
| 로그 | `/data/diva/rag-manager/logs` | 주 1회 |

### DB 백업 예시

```bash
mysqldump -h <DB_HOST> -u root -p extract_document > backup-$(date +%Y%m%d).sql
```

### 원본 파일 백업

```bash
tar czf origin-$(date +%Y%m%d).tar.gz /data/diva/origin
```

---

## 롤백

```bash
cd /data/diva/rag-manager

# 이전 버전으로
git checkout <이전-커밋>
docker compose up -d --build
```
