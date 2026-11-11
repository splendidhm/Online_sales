# 데이터 계약

## 공통 형식

내부 키는 UUID, 외부 번호는 문자열로 보존한다. 시각은 시간대가 있는 UTC로 저장하고 화면에서 한국시간으로 변환한다. 금액은 KRW Decimal 문자열, 계산용 비율은 0~1 Decimal, 수량은 정수다. 미확인 값은 null과 사유를 함께 전달한다. 분석에는 source, observed_at, version(규칙 또는 모델), completeness, status, trace_id를 기록한다. 데이터 종류는 fixture(시험), manual(직접 확인), provider(연동)로 구분하고 연습 회차와 운영 회차를 분리한다.

## 영속 모델과 연결 키

| 단위 | 엔터티와 필수 내용 |
|---|---|
| 수집 | Supplier(공급처·직배송 조건), SourcingBatch(회차·종류·수집 상한), SupplierProduct(공급처·외부 상품번호·원본 버전), ProductVariant(옵션코드·구성수량·규격·공급가·재고), ProductCandidate(회차·상품·중복 판정·제외 사유). 외부 상품 유일키는 공급처와 외부 번호의 조합 |
| 증거와 조사 | ProductEvidence(대상 필드·원본 링크 또는 허용된 증빙 파일·수집 시각·권리 범위), MarketComparable(채널·판매자·링크·옵션·구성·판매가·배송비·확인 시각·채택 여부와 사유), MarketResearchSnapshot(대상 옵션·채널·채택 및 제외 표본 ID·가격 범위·중앙값) |
| 판단 | ProfitabilityScenario(옵션·채널·원가와 세금 기준·목표 이익률·수수료 정책·최저가·추천가·공헌이익·민감도), ProductScore(시나리오·근거별 세부 점수·충족률·사유), Approval(단계·채널·승인 대상 버전·결정·대표자·시각·취소/대체 참조) |
| 콘텐츠 | ContentAsset(원본 해시·사용 범위·변형 허용 여부·증거 ID), ContentRevision(버전·사양·문안·이미지 참조·채널별 고시), QAReport(콘텐츠 버전·심각도·문구/이미지 위치·설명·수정안·증거·해결 상태) |
| 채널 등록 | MarketplaceListing(내부 상품·채널·판매자 계정·외부 상품번호), MarketplaceVariant(내부 옵션·외부 옵션번호), PublicationJob(등록 건·승인 버전·명령 종류·고유키·시도·상태), VerificationResult(작업·조회 시각·옵션별 기대값/실제값·차이). 활성 등록은 계정·채널·내부 상품당 하나 |
| 운영 | InventorySnapshot(공급 또는 마켓 옵션·수량·시각), PriceHistory(대상·가격 종류·변경 전후), Order(채널 주문·라인·옵션), Fulfillment(주문 라인·배송 진행), Return(반품·환불·실비), Settlement(정산행·원거래·차감 내역), OperationalAlert(대상·사유·처리 상태), AuditEvent(주체·행위·버전·시각·추적 ID) |

## 외부 인터페이스

각 인터페이스는 시험 구현을 제공한다. 공급처 원본·외부 오류를 어댑터에서 공통 타입으로 변환한다. 읽기 응답에는 관측 시각·원천 ID·누락 사유를 포함한다.

| 계약 | 입력 → 반환 |
|---|---|
| SupplierProvider | 목록 조건·커서 → 상품 참조 목록·다음 커서. 상품 참조 → 옵션·원가·배송·권리 증거 |
| MarketResearchProvider | 옵션·채널·직접 확인한 표본 또는 허가된 데이터 참조 → 비교 표본과 제외 근거 |
| MarketplacePublisher | 승인 버전·목적 채널·판매자 상품코드·고유키 → 접수 식별자 또는 결과 불명 |
| MarketplaceVerifier | 계정·등록번호 또는 지원되는 판매자 상품코드 → 판매 상태·옵션·가격·배송비·재고·관측 시각 |
| OrderProvider | 채널 계정·조회 구간·커서 → 주문·반품·정산 페이지, 다음 커서와 대상별 외부 키 |
| InventoryProvider | 공급처 또는 마켓의 옵션 키 → 재고 스냅숏·관측 시각 |
| NotificationProvider | 알림 ID·중요도·한국어 메시지·대상 화면 → 전달 결과. 초기 목적지는 관리자 알림함 |

## 1단계 관리자 API 계약

| 명령 | 주요 입력 | 결과와 검증 |
|---|---|---|
| POST /batches | 회차 종류·공급원·상한 | 회차 ID, 상한 1~1,000. 모의 회차 또는 직접 확인 자료로 시작 |
| POST /batches/{id}/candidates | 공급 상품·옵션·증빙·직접 확인 시각 | 정규화 결과, 중복 또는 보류 사유. 같은 공급 상품·옵션 재입력은 새 관측으로 처리 |
| POST /candidates/{id}/comparables | 채널·판매자·링크·규격·수량·가격·배송비·확인 시각 | 표본 ID, 채택/제외 사유. 가격·배송비는 음수 금지, 0원 배송 명시 |
| POST /candidates/{id}/evaluations | 채널·옵션·비용 정책·목표·참조 표본 버전 | 스냅숏 ID, 가격 시나리오, 각 점수, 결측 목록. 입력 변경 시 새 평가 |
| GET /candidates/{id} | 후보 ID | 채널별 근거·가격·자료 충족률·허용된 다음 행동 |
| POST /candidates/{id}/approvals | 단계·채널·대상 버전·결정·사유 | 결정 ID·상태. 중복 명령은 동일 결과, 오래된 버전은 409, 권한 부족은 403 |

**표본 예시.** 서랍 정리함 1개 A 옵션, 판매자 ‘표본가게’, 상품가 12,000원, 배송비 3,000원, 같은 지역 일반배송은 관측 총액 15,000원이다. 링크·확인 시각은 실제 입력 시 필수다. 동일 판매자의 2개 세트는 제외 사유 ‘구성 수량 다름’으로 남긴다.
