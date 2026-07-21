import {
  Wallet,
  Coins,
  Gift,
  Bell,
  Activity,
  ShieldCheck,
  ShieldAlert,
  Lock,
  Database,
  EyeOff,
} from 'lucide-react'
import { useT } from '../i18n/I18nContext'
import type { Lang } from '../i18n/i18n'
import Collapsible from '../components/Collapsible'

interface Point {
  title: string
  body: string
}
interface Tut {
  q: string
  a: string
}
interface Content {
  intro: string
  servicesTitle: string
  services: Point[]
  tutorialsTitle: string
  tutorials: Tut[]
  securityTitle: string
  securityLead: string
  securityPoints: Point[]
  dataTitle: string
  dataIntro: string
  dataNeverTitle: string
  dataNever: string[]
  dataCollectTitle: string
  dataCollect: Point[]
  disclaimer: string
}

const DOCS: Record<Lang, Content> = {
  en: {
    intro:
      'Everything you need to use Beehive Wallet safely — how it works, what we can and cannot see, and the risks to understand before moving funds.',
    servicesTitle: 'What we offer',
    services: [
      {
        title: 'Non-custodial wallet',
        body: 'Create or import wallets that live only in your browser. Send and receive MED and other Cosmos assets.',
      },
      {
        title: 'Staking',
        body: 'Delegate to validators — free to the Beehive validator — and track your delegations and rewards.',
      },
      {
        title: 'Rewards',
        body: 'Claim or auto-restake staking rewards and commission, with your average monthly income at a glance.',
      },
      {
        title: 'Transaction alarms',
        body: 'Watch any address and get an in-app or push alert the moment a transaction is sent, received, or unbonded.',
      },
      {
        title: 'Validator uptime alerts',
        body: 'Opt-in monitoring (paid, admin-approved) that warns you when a validator you rely on starts missing blocks. Availability is controlled by the team; when enabled it appears in the menu.',
      },
    ],
    tutorialsTitle: 'Getting started',
    tutorials: [
      {
        q: 'Create a new wallet',
        a: 'Go to Settings → Create new wallet. A 24-word seed phrase is generated in your browser. Write it on paper, confirm you saved it, set a password, and save. The password encrypts the wallet on this device.',
      },
      {
        q: 'Import an existing wallet',
        a: 'Settings → Import wallet. Paste a 12 or 24-word seed phrase or a private key, name it, and set a password. It is encrypted and stored only in this browser.',
      },
      {
        q: 'Send tokens',
        a: 'Open Send, enter the recipient and amount (use the 25/50/75/Max buttons for quick amounts), enter your wallet password to sign, and broadcast. The network fee is paid in the chain’s token.',
      },
      {
        q: 'Stake / delegate',
        a: 'On Validators, pick a validator (Beehive is free), enter an amount, and sign. Undelegations unlock after the ~21-day unbonding period.',
      },
      {
        q: 'Claim or restake rewards',
        a: 'On Rewards, claim to your balance or restake to compound back into your delegations. You can claim across all wallets at once.',
      },
      {
        q: 'Set up alarms',
        a: 'On Alarms, create an account (email + password — never your keys), add an address to watch, choose the alarm type (sent, received, both, or unbonding), and enable push to get alerts even when the app is closed.',
      },
    ],
    securityTitle: 'Security & risks',
    securityLead:
      'Beehive is non-custodial. Your seed phrase and private keys are encrypted with your password and never leave your browser — we cannot see them, move your funds, or recover them for you.',
    securityPoints: [
      {
        title: 'Your seed phrase is everything',
        body: 'Anyone with your seed phrase or private key controls your funds. Write it on paper, never store it digitally, never share it, and never enter it on any other site.',
      },
      {
        title: 'We cannot recover your wallet',
        body: 'If you lose your seed phrase or forget your password, no one — including us — can restore access. There is no reset.',
      },
      {
        title: 'Watch out for phishing',
        body: 'Only use the official address. We will never message you first, ask for your seed phrase, or ask you to “validate” your wallet.',
      },
      {
        title: 'Transactions are final',
        body: 'On-chain transfers cannot be reversed. Double-check the recipient and amount before signing.',
      },
      {
        title: 'Not financial advice',
        body: 'Staking and crypto carry risk, including slashing and price volatility. Nothing here is investment advice.',
      },
    ],
    dataTitle: 'Data & privacy',
    dataIntro:
      'We keep two things completely separate: your keys, which stay in your browser, and your alarm account, which lives on our server and only ever holds public data.',
    dataNeverTitle: 'What we never see or store',
    dataNever: [
      'Your seed phrase or private keys',
      'Your wallet password',
      'Your signing — transactions are signed locally in your browser',
    ],
    dataCollectTitle: 'What our server stores (only if you create an alarm account)',
    dataCollect: [
      {
        title: 'Account',
        body: 'Your email and a password hash (for sign-in), plus an optional main wallet address.',
      },
      {
        title: 'Watched addresses',
        body: 'The public addresses you choose to monitor, their labels, and your alarm-type settings.',
      },
      {
        title: 'Alerts',
        body: 'Records of matching transactions (hash, amount, counterparty) so you can see your alert history.',
      },
      {
        title: 'Push subscriptions',
        body: 'If you enable push, your device’s browser push endpoint, used only to deliver notifications.',
      },
    ],
    disclaimer:
      'Public blockchain data (balances, transactions, validators) is read from public nodes. Prices come from CoinGecko. We do not sell your data.',
  },
  ko: {
    intro:
      'Beehive 지갑을 안전하게 사용하기 위한 모든 것 — 작동 방식, 저희가 볼 수 있는 것과 없는 것, 자금을 옮기기 전에 알아야 할 위험을 설명합니다.',
    servicesTitle: '제공 서비스',
    services: [
      {
        title: '비수탁 지갑',
        body: '브라우저에만 저장되는 지갑을 만들거나 가져오세요. MED 및 기타 Cosmos 자산을 보내고 받을 수 있습니다.',
      },
      {
        title: '스테이킹',
        body: '밸리데이터에 위임하고(Beehive 밸리데이터는 무료) 위임 및 보상을 추적하세요.',
      },
      {
        title: '보상',
        body: '스테이킹 보상과 커미션을 수령하거나 자동 재스테이킹하고, 월 평균 수익을 한눈에 확인하세요.',
      },
      {
        title: '거래 알림',
        body: '원하는 주소를 감시하고 송금·입금·위임 해제가 발생하는 즉시 인앱 또는 푸시 알림을 받으세요.',
      },
      {
        title: '밸리데이터 가동률 알림',
        body: '의존하는 밸리데이터가 블록을 놓치기 시작하면 경고하는 선택형 모니터링(유료, 관리자 승인). 제공 여부는 팀이 관리하며, 활성화되면 메뉴에 표시됩니다.',
      },
    ],
    tutorialsTitle: '시작하기',
    tutorials: [
      {
        q: '새 지갑 만들기',
        a: '설정 → 새 지갑 생성. 브라우저에서 24단어 시드 문구가 생성됩니다. 종이에 적고 저장을 확인한 뒤 비밀번호를 설정하고 저장하세요. 비밀번호는 이 기기에서 지갑을 암호화합니다.',
      },
      {
        q: '기존 지갑 가져오기',
        a: '설정 → 지갑 가져오기. 12 또는 24단어 시드 문구나 개인 키를 붙여넣고 이름과 비밀번호를 설정하세요. 이 브라우저에만 암호화되어 저장됩니다.',
      },
      {
        q: '토큰 보내기',
        a: '송금에서 받는 주소와 금액을 입력하고(25/50/75/최대 버튼으로 빠르게 입력), 지갑 비밀번호로 서명한 뒤 전송하세요. 네트워크 수수료는 체인의 토큰으로 지불됩니다.',
      },
      {
        q: '스테이킹 / 위임',
        a: '밸리데이터 화면에서 밸리데이터를 선택하고(Beehive는 무료) 금액을 입력한 뒤 서명하세요. 위임 해제는 약 21일의 언본딩 기간 후에 잠금 해제됩니다.',
      },
      {
        q: '보상 수령 또는 재스테이킹',
        a: '보상 화면에서 잔액으로 수령하거나 위임에 다시 재스테이킹하여 복리로 운용하세요. 여러 지갑을 한 번에 수령할 수 있습니다.',
      },
      {
        q: '알림 설정',
        a: '알림 화면에서 계정을 만들고(이메일 + 비밀번호 — 키는 절대 아님), 감시할 주소를 추가하고, 알림 유형(보냄·받음·둘 다·위임 해제)을 선택한 뒤, 앱이 닫혀 있어도 알림을 받도록 푸시를 활성화하세요.',
      },
    ],
    securityTitle: '보안 및 위험',
    securityLead:
      'Beehive는 비수탁형입니다. 시드 문구와 개인 키는 비밀번호로 암호화되어 브라우저를 절대 벗어나지 않습니다 — 저희는 이를 볼 수도, 자금을 옮길 수도, 복구해 드릴 수도 없습니다.',
    securityPoints: [
      {
        title: '시드 문구가 전부입니다',
        body: '시드 문구나 개인 키를 아는 사람은 누구나 자금을 제어할 수 있습니다. 종이에 적고, 디지털로 저장하지 말고, 공유하지 말고, 다른 사이트에 입력하지 마세요.',
      },
      {
        title: '지갑을 복구해 드릴 수 없습니다',
        body: '시드 문구를 잃어버리거나 비밀번호를 잊으면 저희를 포함해 누구도 접근을 복원할 수 없습니다. 재설정은 없습니다.',
      },
      {
        title: '피싱에 주의하세요',
        body: '공식 주소만 사용하세요. 저희는 절대 먼저 메시지를 보내거나, 시드 문구를 요구하거나, 지갑 “인증”을 요청하지 않습니다.',
      },
      {
        title: '거래는 되돌릴 수 없습니다',
        body: '온체인 전송은 취소할 수 없습니다. 서명 전에 받는 주소와 금액을 다시 확인하세요.',
      },
      {
        title: '투자 조언이 아닙니다',
        body: '스테이킹과 암호화폐에는 슬래싱과 가격 변동 등 위험이 따릅니다. 이곳의 어떤 내용도 투자 조언이 아닙니다.',
      },
    ],
    dataTitle: '데이터 및 개인정보',
    dataIntro:
      '저희는 두 가지를 완전히 분리합니다: 브라우저에 남는 키와, 서버에 저장되며 오직 공개 데이터만 담는 알림 계정.',
    dataNeverTitle: '저희가 절대 보거나 저장하지 않는 것',
    dataNever: [
      '시드 문구 또는 개인 키',
      '지갑 비밀번호',
      '서명 — 거래는 브라우저에서 로컬로 서명됩니다',
    ],
    dataCollectTitle: '알림 계정을 만들 때 서버에 저장되는 것',
    dataCollect: [
      {
        title: '계정',
        body: '로그인을 위한 이메일과 비밀번호 해시, 선택적 기본 지갑 주소.',
      },
      {
        title: '감시 주소',
        body: '모니터링하도록 선택한 공개 주소, 라벨, 알림 유형 설정.',
      },
      {
        title: '알림',
        body: '일치하는 거래 기록(해시, 금액, 상대방)으로 알림 내역을 확인할 수 있습니다.',
      },
      {
        title: '푸시 구독',
        body: '푸시를 활성화하면 알림 전달에만 사용되는 기기의 브라우저 푸시 엔드포인트.',
      },
    ],
    disclaimer:
      '공개 블록체인 데이터(잔액, 거래, 밸리데이터)는 공개 노드에서 읽어옵니다. 가격은 CoinGecko에서 제공됩니다. 저희는 귀하의 데이터를 판매하지 않습니다.',
  },
}

const SERVICE_ICONS = [Wallet, Coins, Gift, Bell, Activity]

export default function Docs() {
  const { t, lang } = useT()
  const d = DOCS[lang] ?? DOCS.en

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">{t('nav.docs')}</h1>
        <p className="mt-1 text-sm text-slate-500">{d.intro}</p>
      </div>

      {/* Services */}
      <section className="space-y-3">
        <h2 className="font-medium">{d.servicesTitle}</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {d.services.map((s, i) => {
            const Icon = SERVICE_ICONS[i] ?? Wallet
            return (
              <div key={s.title} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Icon className="h-4 w-4 text-amber-600" strokeWidth={1.8} /> {s.title}
                </div>
                <p className="mt-1 text-sm text-slate-500">{s.body}</p>
              </div>
            )
          })}
        </div>
      </section>

      {/* Tutorials */}
      <section className="space-y-2">
        <h2 className="font-medium">{d.tutorialsTitle}</h2>
        <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white px-4 py-1">
          {d.tutorials.map((tut) => (
            <Collapsible key={tut.q} title={tut.q}>
              <p className="pb-2 text-sm text-slate-600">{tut.a}</p>
            </Collapsible>
          ))}
        </div>
      </section>

      {/* Security */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 font-medium">
          <ShieldCheck className="h-4 w-4 text-amber-600" /> {d.securityTitle}
        </h2>
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <p className="text-sm text-amber-900">{d.securityLead}</p>
        </div>
        <ul className="space-y-2">
          {d.securityPoints.map((p) => (
            <li key={p.title} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-sm font-medium">{p.title}</div>
              <p className="mt-1 text-sm text-slate-500">{p.body}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* Data & privacy */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 font-medium">
          <Database className="h-4 w-4 text-amber-600" /> {d.dataTitle}
        </h2>
        <p className="text-sm text-slate-500">{d.dataIntro}</p>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-green-700">
            <EyeOff className="h-4 w-4" /> {d.dataNeverTitle}
          </div>
          <ul className="mt-2 space-y-1 text-sm text-slate-600">
            {d.dataNever.map((n) => (
              <li key={n} className="flex items-start gap-2">
                <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600" /> {n}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-sm font-medium">{d.dataCollectTitle}</div>
          <ul className="mt-2 space-y-2">
            {d.dataCollect.map((c) => (
              <li key={c.title} className="text-sm">
                <span className="font-medium text-slate-700">{c.title}</span>
                <span className="text-slate-500"> — {c.body}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-slate-400">{d.disclaimer}</p>
      </section>
    </div>
  )
}
