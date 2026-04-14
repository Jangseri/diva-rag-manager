# RAG Manager 배포 가이드

## 사전 요구사항

- 서버: 192.168.220.223 (seri 계정)
- Docker, docker-compose 설치
- 다음 서비스 접속 가능:
  - MariaDB: 192.168.220.223:3306
  - Redis: 192.168.220.222:6379
  - milvus-broker: 192.168.220.223:8009

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
└── extract/               ← 추출 결과 (docs-extract-system이 저장)
```

---

## 최초 배포 절차

### 1. 서버 접속 및 디렉토리 준비

```bash
ssh seri@192.168.220.223

# 공유 볼륨 디렉토리 생성
sudo mkdir -p /data/diva/origin /data/diva/extract
sudo chown -R seri:seri /data/diva
```

### 2. 프로젝트 파일 배치

```bash
cd /data/diva
git clone <repository-url> rag-manager
# 또는 rsync로 복사
# rsync -av --exclude node_modules --exclude .next --exclude storage ./ seri@223:/data/diva/rag-manager/

cd rag-manager
```

### 3. 환경변수 파일 생성

```bash
cp .env.production.example .env
vi .env  # 실제 DB 비밀번호 등 입력
```

`.env` 내용 예시:
```
DATABASE_URL="mysql://root:aidb%21%4034@192.168.220.223:3306/extract_document"
REDIS_URL="redis://192.168.220.222:6379/0"
MILVUS_BROKER_URL="http://192.168.220.223:8009"
MILVUS_COLLECTION_NAME="llm_workcenter_v3"
```

> 비밀번호 특수문자 URL 인코딩: `!`→`%21`, `@`→`%40`

### 4. DB 테이블 생성 (최초 1회)

```bash
# Prisma CLI로 실행
docker run --rm \
  -v $(pwd)/prisma:/prisma \
  --env-file .env \
  node:20-alpine \
  sh -c "cd / && npx -y prisma@5 db execute --schema /prisma/schema.prisma --file /prisma/create_table.sql"
```

또는 직접 SQL로:
```sql
-- 223 서버의 MariaDB에 접속 후
USE extract_document;
SOURCE prisma/create_table.sql;
SOURCE prisma/alter_add_user_key.sql;
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
http://192.168.220.223:3000
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

# 특정 user_key 로그 검색
grep '"userKey":"user01"' logs/app.log-*
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
- 볼륨 권한 문제 → `sudo chown -R 1001:1001 /data/diva` (컨테이너 내부 nextjs UID=1001)

### 파일 업로드 실패

```bash
# 권한 확인
ls -la /data/diva/origin
```

Docker 컨테이너 내부 `nextjs` 유저(UID=1001)가 쓰기 가능해야 합니다:
```bash
sudo chown -R 1001:1001 /data/diva/origin
```

### Redis 연결 실패

```bash
# 호스트에서 Redis 확인
redis-cli -h 192.168.220.222 ping
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
mysqldump -h 192.168.220.223 -u root -p extract_document > backup-$(date +%Y%m%d).sql
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
