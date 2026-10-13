import { TELEGRAM_URL, X_URL } from "@/lib/config";

/**
 * The community channels: Telegram and X.
 *
 * One component, because they are one call to action — "follow along" — and
 * because a footer that grows a link without growing the place links live is
 * how link lists drift apart between pages. The brand paths are Simple Icons'
 * (the same source as the Robinhood feather), embedded rather than hotlinked
 * so they render with no network round trip and inherit the text colour.
 */
export function CommunityLinks({ className = "" }: { className?: string }) {
  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      <a
        href={TELEGRAM_URL}
        target="_blank"
        rel="noreferrer noopener"
        className="btn-ghost inline-flex items-center gap-2 px-4 py-2 text-[13px] font-bold text-beg-ink"
      >
        <TelegramIcon className="size-[15px]" />
        Telegram
      </a>
      <a
        href={X_URL}
        target="_blank"
        rel="noreferrer noopener"
        className="btn-ghost inline-flex items-center gap-2 px-4 py-2 text-[13px] font-bold text-beg-ink"
      >
        <XIcon className="size-[13px]" />
        X
      </a>
    </div>
  );
}

export function TelegramIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={`inline-block ${className}`} fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
  );
}

export function XIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={`inline-block ${className}`} fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" />
    </svg>
  );
}
