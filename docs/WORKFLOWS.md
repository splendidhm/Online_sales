# 업무 상태와 승인 규칙

상태는 상품·채널의 조사 및 승인 건과 채널별 등록 작업에 저장한다. 동일 원본을 여러 채널에서 참조할 수 있다. 각 명령은 현재 상태, 예상 버전, 사용자 권한을 검사하고 성공 시 상태 이력과 근거를 같은 트랜잭션에 저장한다.

| 시작 상태 | 허용되는 다음 상태 | 입력·판정 |
|---|---|---|
| DISCOVERED | NORMALIZED | 공급 원본과 출처가 있으며 옵션·수량을 표준화 |
| NORMALIZED | FILTERED, PAUSED, REJECTED | 기본 조건 통과, 정보 보완, 영구 부적격을 구분 |
| FILTERED | RESEARCH_PENDING | 조사할 상품·옵션·채널 선택 |
| RESEARCH_PENDING | RESEARCHED, DATA_INSUFFICIENT | 채널별 비교 표본과 비용 근거 검사 |
| DATA_INSUFFICIENT | RESEARCH_PENDING | 새 근거 입력 후 재조사 |
| RESEARCHED | SCORED | 가격·비용과 평가 기준 버전 고정 |
| SCORED | SHORTLISTED, PAUSED, REJECTED | 추천 기준 통과 또는 필수 조건 통과 후 수동 심사 선택. 모의 자료는 연습 회차 전용 |
| SHORTLISTED | PENDING_APPROVAL_1 | 상품성 판단 자료를 묶어 대표자에게 제시 |
| PENDING_APPROVAL_1 | APPROVED_1, PAUSED, REJECTED | 대표자의 진행·보류·제외와 메모 |
| APPROVED_1 | CONTENT_GENERATING | 유효한 1차 승인과 동일한 옵션·공급 조건 |
| CONTENT_GENERATING | QA_PENDING, PAUSED | 콘텐츠 버전과 이미지 사용 근거 확보 |
| QA_PENDING | QA_FAILED, PENDING_APPROVAL_2 | 원문, 이미지 문구, 고시와 채널별 최종본 검수 |
| QA_FAILED | CONTENT_GENERATING | 미해결 이슈 보완 후 새 버전 생성 |
| PENDING_APPROVAL_2 | APPROVED_2, CONTENT_GENERATING, REJECTED | 대표자의 게시 승인·수정 요청·제외. 미해결 중대 이슈 차단 |
| APPROVED_2 | PUBLISH_QUEUED | 승인된 대상 채널마다 고유 작업 생성 |
| PUBLISH_QUEUED | PUBLISHING, PAUSED | 최신 승인, 공급가·재고·권리·운영자료 확인 |
| PUBLISHING | PUBLISHED_UNVERIFIED, PUBLISH_FAILED, PAUSED | 등록번호 또는 요청 추적값 저장. 반영 여부 불명 시 조회로 전환 |
| PUBLISHED_UNVERIFIED | VERIFIED, PRICE_MISMATCH, PUBLISH_FAILED, PAUSED | 심사 중이면 현 상태 유지. 판매 중이고 모든 비교 항목이 일치하면 검증 완료, 반려는 실패 |
| PRICE_MISMATCH | PUBLISHED_UNVERIFIED, PAUSED | 기대값·실제값·차액 경고. 대표자 보정 후 재조회 |
| PUBLISH_FAILED | PUBLISH_QUEUED, PAUSED | 원인 해소, 중복 부재 및 같은 승인 버전 확인 후 해당 채널만 재시도 |
| VERIFIED | PRICE_MISMATCH, PAUSED, ARCHIVED | 운영 관측에서 변동 감지 또는 운영 종료 |
| PAUSED | NORMALIZED, RESEARCH_PENDING, PENDING_APPROVAL_1, CONTENT_GENERATING, PUBLISH_QUEUED, PUBLISHED_UNVERIFIED, ARCHIVED | 보류 사유와 재개 위치 저장. 게시 재개는 유효한 2차 승인과 중복 확인 필요 |
| REJECTED | ARCHIVED | 해당 버전 종료. 재제안은 별도 버전으로 시작 |
| ARCHIVED | 종료 | 읽기 전용 이력 |

## 승인 변경과 재검증

- 1차 승인 대상은 공급사·규격·옵션·원가표·채널 가격 시나리오다. 가격, 공급사, 옵션, 공급가, 배송 조건이 바뀌면 해당 채널의 상업 승인과 게시 승인을 폐기하고 재계산·1차 검토로 돌린다.
- 2차 승인은 최종 콘텐츠·이미지·고시·판매 조건·채널의 버전 묶음에 연결한다. 문구 또는 이미지만 변경하면 1차 승인은 유지하고 QA와 2차 승인을 다시 수행한다. 재고 소진은 게시 보류, 수량 변경은 게시 수량 재검증 및 변경된 승인본 재검토 대상으로 한다.
- 변경 처리는 원래 버전을 취소하고 새 버전에서 해당 단계로 진입한다. 이미 접수된 외부 요청은 조회를 계속해 실제 상태를 기록한다. 이전 등록번호를 유지해 재승인이 중복 신규 등록으로 이어지지 않게 한다.

## 실패와 보고

읽기 요청의 일시적 장애·호출 제한은 Retry-After 우선, 그 외 5초·30초·2분 간격으로 최대 3회 재시도한다. 등록 요청 타임아웃은 외부 결과 불명으로 기록해 먼저 판매자 상품코드·등록번호로 조회한다. 중복 여부를 확인할 수 없으면 수동 확인한다. 인증·필수 속성·권리 오류는 원인 수정 후 재개한다.

검증 단위는 마켓의 각 옵션이다. 승인 상품가·옵션 추가금·판매자 할인·배송비·판매 상태·판매가능수량을 비교한다. 가격 또는 배송비 불일치는 PRICE_MISMATCH, 그 밖의 옵션·재고 불일치는 PAUSED와 해당 사유로 표시한다. 조회 지연·심사 대기는 성공 건수에 포함하지 않는다. 채널별 결과를 독립 집계하고 모의·수동 등록은 별도 표시한다.
