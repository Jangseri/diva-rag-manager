// TODO: 로그인 구현 시 실제 세션에서 사용자 정보를 가져오도록 교체
// 현재는 임시 기본값을 반환

export interface CurrentUser {
  user_key: string;
  name: string;
}

export function getCurrentUser(): CurrentUser {
  // TODO: 세션/토큰에서 실제 사용자 정보 조회
  return {
    user_key: "user01",
    name: "admin",
  };
}
