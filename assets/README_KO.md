[English](../README.md) | [中文](./README_CN.md) | [日本語](./README_JA.md) | [Deutsch](./README_DE.md) | [Français](./README_FR.md) | [Español](./README_ES.md)

# ccclub.dev

친구들과 함께하는 Claude Code 리더보드.

<img src="./demo.png" alt="ccclub" width="80%" />

## 시작하기

```bash
npx ccclub init
```

이름을 입력하면 6자리 초대 코드가 발급됩니다. 친구에게 공유하세요:

```bash
npx ccclub join YHAW6P
```

끝입니다. 사용량은 매시간 자동 동기화됩니다. 설정 없음, 가입 없음, 계정 없음.

친구가 참여하면 리더보드를 확인하세요:

```bash
ccclub
```

## 업로드되는 데이터

CCClub은 Claude Code가 로컬에 기록하는 JSONL 로그를 읽어 1시간 단위 요약(토큰 수 + 비용)으로 묶어 업로드합니다. **프롬프트, 코드, 파일 경로, 프로젝트 이름은 포함되지 않습니다** — 카운터만 전송합니다. `ccclub show-data`로 전송 내용을 확인할 수 있습니다.

## 명령어

일상적으로 이 4가지면 충분합니다:

```bash
ccclub init                        # 최초 설정, 그룹 생성
ccclub join <CODE>                 # 친구 그룹 참여
ccclub sync                        # 수동 동기화 (세션 종료 시 자동 실행)
ccclub                             # 오늘의 사용량 확인
```

추가 옵션:

```bash
ccclub -d 7                        # 기간 선택: 7 / 30 / all
ccclub --global                    # 공개 사용자 전체
ccclub -g YHAW6P                   # 특정 그룹
```

추가 명령어:

```bash
ccclub create                      # 새 그룹 만들기
ccclub profile                     # 프로필 보기
ccclub profile --name "새 이름"     # 표시 이름 변경
ccclub profile --avatar "URL"      # 커스텀 아바타
ccclub profile --public            # 글로벌 랭킹에 표시
ccclub profile --private           # 글로벌 랭킹에서 숨기기 (기본값)
ccclub show-data                   # 업로드 내용 확인
```

## 웹 대시보드

각 그룹마다 실시간 페이지가 있습니다:

```
https://ccclub.dev/g/YHAW6P
```

기간 전환(today/7d/30d/all time), 아바타, 5분마다 자동 새로고침. 공개 사용자의 글로벌 페이지는 `/g/global`에 있습니다.

## 개인정보

업로드되는 데이터는 **이것뿐**입니다:

```json
{
  "blockStart": "2025-02-13T00:00:00Z",
  "blockEnd": "2025-02-13T01:00:00Z",
  "inputTokens": 48210,
  "outputTokens": 12050,
  "cacheCreationTokens": 0,
  "cacheReadTokens": 31200,
  "totalTokens": 91460,
  "costUSD": 0.2184,
  "models": ["claude-sonnet-4-5-20250929"],
  "entryCount": 23
}
```

**기본적으로 비공개** — 참여한 그룹 내에서만 표시됩니다. 글로벌 리더보드는 옵트인(`ccclub profile --public`)입니다.

## 라이선스

MIT
