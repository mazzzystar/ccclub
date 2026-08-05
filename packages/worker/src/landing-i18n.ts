export type LandingLang = "en" | "zh" | "ja" | "de" | "ru";

export const LANDING_LANGS: LandingLang[] = ["en", "zh", "ja", "de", "ru"];

export function landingPath(lang: LandingLang): string {
  return lang === "en" ? "/" : `/${lang}`;
}

export type LandingT = {
  htmlLang: string;
  title: string;
  description: string;
  ogDescription: string;
  eyebrow: string;
  h1: string;
  tagline: string;
  previewTitle: string;
  previewCaption: string;
  tabAgent: string;
  tabHuman: string;
  agentTitle: string;
  agentSubtitle: string;
  humanTitle: string;
  humanSubtitle: string;
  supportedStrong: string;
  howItWorks: string;
  step1h: string;
  step1p: string; // may contain <code>
  step2h: string;
  step2p: string;
  step3h: string;
  step3p: string;
  howDetail1: string;
  howDetail2: string; // may contain <code>
  guidesNote: string; // contains <a> links to the guides
  commandsTitle: string;
  cmdCreate: string;
  cmdJoin: string;
  cmdToday: string;
  cmdAll: string;
  cmdNoCache: string;
  cmdDays: string;
  cmdSync: string;
  cmdShowData: string;
};

export const LANDING_T: Record<LandingLang, LandingT> = {
  en: {
    htmlLang: "en",
    title: "ccclub — Claude Code & Codex Leaderboard Among Friends",
    description:
      "Claude Code and Codex leaderboard among friends. Track coding agent token usage, costs, and active status across Claude Code, Codex, OpenCode, Amp, and pi-agent.",
    ogDescription:
      "Track Claude Code, Codex, OpenCode, Amp, and pi-agent token usage, costs, and active status with friends.",
    eyebrow: "Among friends",
    h1: "Claude Code & Codex leaderboard among friends.",
    tagline:
      "Track coding agent token usage, cost, active status, and agent mix across Claude Code, Codex, OpenCode, Amp, and pi-agent.",
    previewTitle: "Live leaderboard preview",
    previewCaption: "Cost · tokens · turns · active friends · agent mix",
    tabAgent: "I'm Agent",
    tabHuman: "I'm Human",
    agentTitle: "Send this prompt to your coding agent.",
    agentSubtitle:
      "It will install ccclub, initialize your group, and keep supported agent usage fresh with almost no setup.",
    humanTitle: "Run one command and start your club.",
    humanSubtitle:
      "ccclub auto-detects supported local agent logs. Friends can join with the invite code it prints.",
    supportedStrong: "Supported agents",
    howItWorks: "How it works",
    step1h: "Initialize",
    step1p: 'Run <code class="mono">npx ccclub init</code> and enter your name. You get an invite link to share.',
    step2h: "Invite",
    step2p:
      'Share your invite link or have friends run <code class="mono">npx ccclub join CODE</code>. No account needed.',
    step3h: "See the leaderboard",
    step3p:
      'Claude Code syncs at session end, and background sync picks up Codex, OpenCode, Amp, and pi-agent. Run <code class="mono">ccclub</code> or open the web dashboard.',
    howDetail1:
      "ccclub reads token counts, cost estimates, model names, and number of calls from local coding agent logs for Claude Code, Codex, OpenCode, Amp, and pi-agent. No prompts, responses, code, file paths, or conversation data ever leave your machine.",
    howDetail2: 'Run <code class="mono">ccclub show-data</code> to see exactly what gets uploaded.',
    guidesNote:
      'New to usage tracking? See <a href="/claude-code-usage">how to check Claude Code usage</a> and <a href="/claude-code-limits">how the 5-hour and weekly limits work</a>.',
    commandsTitle: "Commands",
    cmdCreate: "Create a group",
    cmdJoin: "Join a friend's group",
    cmdToday: "Today's leaderboard (active members only)",
    cmdAll: "Show everyone, including those with no activity",
    cmdNoCache: "Exclude cache tokens from count",
    cmdDays: "Yesterday / 7 / 30 / all",
    cmdSync: "Manual sync (auto-sync also runs in background)",
    cmdShowData: "Privacy audit",
  },
  zh: {
    htmlLang: "zh",
    title: "ccclub — 和朋友一起的 Claude Code & Codex 排行榜",
    description:
      "和朋友一起的 Claude Code / Codex 排行榜。追踪 Claude Code、Codex、OpenCode、Amp、pi-agent 的 token 用量、费用和活跃状态。",
    ogDescription: "和朋友一起追踪 Claude Code、Codex、OpenCode、Amp、pi-agent 的 token 用量、费用和活跃状态。",
    eyebrow: "和朋友一起",
    h1: "和朋友一起的 Claude Code & Codex 排行榜。",
    tagline: "追踪 Claude Code、Codex、OpenCode、Amp、pi-agent 的 token 用量、费用、活跃状态和 agent 构成。",
    previewTitle: "实时排行榜预览",
    previewCaption: "费用 · token · 轮次 · 活跃好友 · agent 构成",
    tabAgent: "我是 Agent",
    tabHuman: "我是人类",
    agentTitle: "把这句话发给你的 coding agent。",
    agentSubtitle: "它会安装 ccclub、初始化你的小组，并自动保持用量同步，几乎无需配置。",
    humanTitle: "运行一条命令，开一个你们的 club。",
    humanSubtitle: "ccclub 自动检测本机支持的 agent 日志，朋友用打印出的邀请码即可加入。",
    supportedStrong: "支持的 agents",
    howItWorks: "工作原理",
    step1h: "初始化",
    step1p: '运行 <code class="mono">npx ccclub init</code> 并输入名字，你会得到一个可分享的邀请链接。',
    step2h: "邀请",
    step2p: '分享邀请链接，或让朋友运行 <code class="mono">npx ccclub join CODE</code>。不需要注册账号。',
    step3h: "查看排行榜",
    step3p:
      'Claude Code 在会话结束时自动同步，后台同步覆盖 Codex、OpenCode、Amp 和 pi-agent。运行 <code class="mono">ccclub</code> 或打开网页仪表盘。',
    howDetail1:
      "ccclub 只从本机的 coding agent 日志（Claude Code、Codex、OpenCode、Amp、pi-agent）读取 token 数、费用估算、模型名和调用次数。提示词、回复、代码、文件路径和对话内容永远不会离开你的电脑。",
    howDetail2: '运行 <code class="mono">ccclub show-data</code> 可以看到上传内容的完整明细。',
    guidesNote:
      '刚开始关注用量？看看<a href="/claude-code-usage">如何查看 Claude Code 用量</a>，以及 <a href="/claude-code-limits">5 小时窗口和每周上限的规则</a>。',
    commandsTitle: "命令",
    cmdCreate: "创建小组",
    cmdJoin: "加入朋友的小组",
    cmdToday: "今日排行榜（仅活跃成员）",
    cmdAll: "显示所有人（含无活动成员）",
    cmdNoCache: "统计时排除 cache token",
    cmdDays: "昨天 / 7 天 / 30 天 / 全部",
    cmdSync: "手动同步（后台也会自动同步）",
    cmdShowData: "隐私审计",
  },
  ja: {
    htmlLang: "ja",
    title: "ccclub — 友達と競う Claude Code & Codex リーダーボード",
    description:
      "友達と競う Claude Code / Codex リーダーボード。Claude Code、Codex、OpenCode、Amp、pi-agent のトークン使用量・コスト・アクティブ状況をトラッキング。",
    ogDescription:
      "Claude Code、Codex、OpenCode、Amp、pi-agent のトークン使用量・コスト・アクティブ状況を友達と一緒にトラッキング。",
    eyebrow: "友達と一緒に",
    h1: "友達と競う Claude Code & Codex リーダーボード。",
    tagline:
      "Claude Code、Codex、OpenCode、Amp、pi-agent のトークン使用量、コスト、アクティブ状況、エージェント構成をトラッキング。",
    previewTitle: "ライブリーダーボードのプレビュー",
    previewCaption: "コスト · トークン · ターン · アクティブな友達 · エージェント構成",
    tabAgent: "私はエージェント",
    tabHuman: "私は人間",
    agentTitle: "このプロンプトをコーディングエージェントに送ってください。",
    agentSubtitle: "ccclub のインストール、グループの初期化、使用量の自動同期まで、ほぼ設定なしで完了します。",
    humanTitle: "コマンド一つで自分たちのクラブを始められます。",
    humanSubtitle:
      "ccclub は対応エージェントのローカルログを自動検出します。表示される招待コードで友達が参加できます。",
    supportedStrong: "対応エージェント",
    howItWorks: "仕組み",
    step1h: "初期化",
    step1p:
      '<code class="mono">npx ccclub init</code> を実行して名前を入力すると、共有用の招待リンクが発行されます。',
    step2h: "招待",
    step2p:
      '招待リンクを共有するか、友達に <code class="mono">npx ccclub join CODE</code> を実行してもらいます。アカウント不要。',
    step3h: "リーダーボードを見る",
    step3p:
      'Claude Code はセッション終了時に自動同期し、Codex・OpenCode・Amp・pi-agent はバックグラウンドで同期されます。<code class="mono">ccclub</code> を実行するか、Web ダッシュボードを開いてください。',
    howDetail1:
      "ccclub が読み取るのは、ローカルのエージェントログ（Claude Code、Codex、OpenCode、Amp、pi-agent）にあるトークン数・コスト見積もり・モデル名・呼び出し回数だけです。プロンプト、応答、コード、ファイルパス、会話内容がマシンの外に出ることはありません。",
    howDetail2: '<code class="mono">ccclub show-data</code> を実行すると、アップロードされる内容を正確に確認できます。',
    guidesNote:
      '使用量トラッキングが初めてなら、<a href="/claude-code-usage">Claude Code の使用量を確認する方法</a>と<a href="/claude-code-limits">5時間・週間リミットの仕組み</a>をご覧ください。',
    commandsTitle: "コマンド",
    cmdCreate: "グループを作成",
    cmdJoin: "友達のグループに参加",
    cmdToday: "今日のリーダーボード（アクティブのみ）",
    cmdAll: "全員を表示（アクティビティなしも含む）",
    cmdNoCache: "キャッシュトークンを除外",
    cmdDays: "昨日 / 7日 / 30日 / 全期間",
    cmdSync: "手動同期（自動同期もバックグラウンドで実行）",
    cmdShowData: "プライバシー監査",
  },
  de: {
    htmlLang: "de",
    title: "ccclub — Claude Code & Codex Leaderboard unter Freunden",
    description:
      "Claude Code & Codex Leaderboard unter Freunden. Verfolge Token-Verbrauch, Kosten und Aktivität über Claude Code, Codex, OpenCode, Amp und pi-agent.",
    ogDescription:
      "Token-Verbrauch, Kosten und Aktivität von Claude Code, Codex, OpenCode, Amp und pi-agent gemeinsam mit Freunden verfolgen.",
    eyebrow: "Unter Freunden",
    h1: "Das Claude Code & Codex Leaderboard unter Freunden.",
    tagline:
      "Token-Verbrauch, Kosten, Aktivität und Agent-Mix über Claude Code, Codex, OpenCode, Amp und pi-agent hinweg.",
    previewTitle: "Live-Leaderboard-Vorschau",
    previewCaption: "Kosten · Tokens · Turns · aktive Freunde · Agent-Mix",
    tabAgent: "Ich bin ein Agent",
    tabHuman: "Ich bin ein Mensch",
    agentTitle: "Schick diesen Prompt an deinen Coding-Agent.",
    agentSubtitle:
      "Er installiert ccclub, richtet deine Gruppe ein und hält die Nutzungsdaten automatisch aktuell — fast ohne Setup.",
    humanTitle: "Ein Befehl — und dein Club startet.",
    humanSubtitle:
      "ccclub erkennt unterstützte lokale Agent-Logs automatisch. Freunde treten mit dem angezeigten Einladungscode bei.",
    supportedStrong: "Unterstützte Agents",
    howItWorks: "So funktioniert's",
    step1h: "Initialisieren",
    step1p:
      'Führe <code class="mono">npx ccclub init</code> aus und gib deinen Namen ein. Du bekommst einen Einladungslink zum Teilen.',
    step2h: "Einladen",
    step2p:
      'Teile deinen Link oder lass Freunde <code class="mono">npx ccclub join CODE</code> ausführen. Kein Konto nötig.',
    step3h: "Leaderboard ansehen",
    step3p:
      'Claude Code synchronisiert am Sessionende; Codex, OpenCode, Amp und pi-agent per Hintergrund-Sync. Führe <code class="mono">ccclub</code> aus oder öffne das Web-Dashboard.',
    howDetail1:
      "ccclub liest aus den lokalen Agent-Logs (Claude Code, Codex, OpenCode, Amp, pi-agent) nur Token-Zahlen, Kostenschätzungen, Modellnamen und Aufrufzahlen. Prompts, Antworten, Code, Dateipfade oder Gesprächsinhalte verlassen deinen Rechner nie.",
    howDetail2: 'Mit <code class="mono">ccclub show-data</code> siehst du genau, was hochgeladen wird.',
    guidesNote:
      'Neu beim Usage-Tracking? Siehe <a href="/claude-code-usage">wie man den Claude-Code-Verbrauch prüft</a> und <a href="/claude-code-limits">wie das 5-Stunden-Fenster und die Wochenlimits funktionieren</a>.',
    commandsTitle: "Befehle",
    cmdCreate: "Gruppe erstellen",
    cmdJoin: "Gruppe eines Freundes beitreten",
    cmdToday: "Heutiges Leaderboard (nur aktive Mitglieder)",
    cmdAll: "Alle anzeigen, auch ohne Aktivität",
    cmdNoCache: "Cache-Tokens nicht mitzählen",
    cmdDays: "Gestern / 7 / 30 / alles",
    cmdSync: "Manueller Sync (Auto-Sync läuft im Hintergrund)",
    cmdShowData: "Privacy-Audit",
  },
  ru: {
    htmlLang: "ru",
    title: "ccclub — рейтинг Claude Code и Codex среди друзей",
    description:
      "Рейтинг Claude Code и Codex среди друзей. Отслеживайте расход токенов, затраты и активность в Claude Code, Codex, OpenCode, Amp и pi-agent.",
    ogDescription:
      "Отслеживайте расход токенов, затраты и активность Claude Code, Codex, OpenCode, Amp и pi-agent вместе с друзьями.",
    eyebrow: "Среди друзей",
    h1: "Рейтинг Claude Code и Codex среди друзей.",
    tagline:
      "Расход токенов, затраты, активность и состав агентов: Claude Code, Codex, OpenCode, Amp и pi-agent.",
    previewTitle: "Живой предпросмотр рейтинга",
    previewCaption: "Затраты · токены · ходы · активные друзья · состав агентов",
    tabAgent: "Я агент",
    tabHuman: "Я человек",
    agentTitle: "Отправьте этот промпт своему coding-агенту.",
    agentSubtitle:
      "Он установит ccclub, создаст вашу группу и будет автоматически синхронизировать данные — почти без настройки.",
    humanTitle: "Одна команда — и ваш клуб готов.",
    humanSubtitle:
      "ccclub автоматически находит локальные логи поддерживаемых агентов. Друзья присоединяются по коду-приглашению.",
    supportedStrong: "Поддерживаемые агенты",
    howItWorks: "Как это работает",
    step1h: "Инициализация",
    step1p:
      'Запустите <code class="mono">npx ccclub init</code> и введите имя — вы получите ссылку-приглашение.',
    step2h: "Приглашение",
    step2p:
      'Поделитесь ссылкой или пусть друзья выполнят <code class="mono">npx ccclub join CODE</code>. Без регистрации.',
    step3h: "Смотрите рейтинг",
    step3p:
      'Claude Code синхронизируется в конце сессии; Codex, OpenCode, Amp и pi-agent — в фоне. Запустите <code class="mono">ccclub</code> или откройте веб-дашборд.',
    howDetail1:
      "ccclub читает из локальных логов агентов (Claude Code, Codex, OpenCode, Amp, pi-agent) только количество токенов, оценку затрат, названия моделей и число вызовов. Промпты, ответы, код, пути к файлам и содержимое диалогов никогда не покидают ваш компьютер.",
    howDetail2: 'Команда <code class="mono">ccclub show-data</code> показывает, что именно будет загружено.',
    guidesNote:
      'Впервые следите за расходом? Смотрите <a href="/claude-code-usage">как проверить использование Claude Code</a> и <a href="/claude-code-limits">как работают 5-часовое окно и недельные лимиты</a>.',
    commandsTitle: "Команды",
    cmdCreate: "Создать группу",
    cmdJoin: "Присоединиться к группе друга",
    cmdToday: "Рейтинг за сегодня (только активные)",
    cmdAll: "Показать всех, включая неактивных",
    cmdNoCache: "Не учитывать cache-токены",
    cmdDays: "Вчера / 7 / 30 / всё",
    cmdSync: "Ручная синхронизация (автосинхронизация работает в фоне)",
    cmdShowData: "Аудит приватности",
  },
};
