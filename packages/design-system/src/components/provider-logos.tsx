import { type FC } from "react";
import { cn } from "../index";

const PROVIDER_COLORS: Record<string, string> = {
  "openai-compatible": "#74AA9C",
  anthropic: "#D97757",
  mistral: "#EB5829",
  "google-gemini": "#4285F4",
};

const PROVIDER_LOGOS: Record<string, FC<{ size?: number; className?: string }>> = {
  "openai-compatible": OpenAILogo,
  openai: OpenAILogo,
  anthropic: AnthropicLogo,
  mistral: MistralLogo,
  "google-gemini": GeminiLogo,
  gemini: GeminiLogo,
};

function OpenAILogo({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={cn("shrink-0", className)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <path
        d="M22.282 9.821a6 6 0 0 0-.516-4.91 6.05 6.05 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a6 6 0 0 0-3.998 2.9 6.05 6.05 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.05 6.05 0 0 0 6.515 2.9A6 6 0 0 0 13.26 24a6.06 6.06 0 0 0 5.772-4.206 6 6 0 0 0 3.997-2.9 6.06 6.06 0 0 0-.747-7.073M13.26 22.43a4.48 4.48 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.8.8 0 0 0 .392-.681v-6.737l2.02 1.168a.07.07 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494M3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.77.77 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646M2.34 7.896a4.5 4.5 0 0 1 2.366-1.973V11.6a.77.77 0 0 0 .388.677l5.815 3.354-2.02 1.168a.08.08 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855-5.833-3.387L15.119 7.2a.08.08 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667m2.01-3.023-.141-.085-4.774-2.782a.78.78 0 0 0-.785 0L9.409 9.23V6.897a.07.07 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.8.8 0 0 0-.393.681zm1.097-2.365 2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5Z"
        fill={PROVIDER_COLORS["openai-compatible"]}
      />
    </svg>
  );
}

function AnthropicLogo({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={cn("shrink-0", className)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={PROVIDER_COLORS.anthropic}
    >
      <path d="M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z" />
    </svg>
  );
}

function MistralLogo({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={cn("shrink-0", className)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <path d="M20.14 10.135h-7.406V7.08h7.406v3.054zM4.359 7.08v3.054h7.394V7.08H4.359zM20.14 13.836h-7.406v3.055h7.406v-3.055zM11.753 13.836H4.359v3.055h7.394v-3.055z" fill="#fcb404"/>
      <path d="M4.359 4.026v3.054h3.697V4.026H4.359zM20.14 4.026v3.054h-3.697V4.026h3.697zM4.359 20.945v-3.055H8.17v-3.054H4.359v-3.082l-3.703-3.054H.656V20.945h3.703zM11.753 20.945v-3.055h-3.81v-3.054h3.81v-3.082l3.704-3.054h.012v12.245h-3.716zM20.14 20.945v-3.055h-3.697v-3.054h3.697v-3.082l3.704-3.054h.012v12.245H20.14z" fill="#fc8304"/>
      <path d="M4.359 10.135v3.701h3.697v-3.701H4.359zM11.753 10.135v3.701h3.698v-3.701h-3.698zM16.455 10.135v3.701h3.697v-3.701h-3.697zM8.07 7.08v3.055h3.697V7.08H8.07z" fill="#fc4c04"/>
    </svg>
  );
}

function GeminiLogo({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={cn("shrink-0", className)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <defs>
        <linearGradient id="gemini-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#4285F4" />
          <stop offset="50%" stopColor="#9B72CB" />
          <stop offset="100%" stopColor="#D96570" />
        </linearGradient>
      </defs>
      <path
        d="M12 0c.343 0 .642.235.726.568a19.64 19.64 0 001.008 2.98c1.086 2.523 2.576 4.73 4.468 6.622 1.892 1.892 4.1 3.382 6.622 4.468.537.231.902.743.902 1.362 0 .619-.365 1.13-.902 1.362a19.637 19.637 0 00-2.98 1.008c-2.523 1.086-4.73 2.576-6.622 4.468-1.892 1.892-3.382 4.1-4.468 6.622A.749.749 0 0112 24a.749.749 0 01-.726-.568 19.637 19.637 0 00-1.008-2.98c-1.086-2.523-2.576-4.73-4.468-6.622-1.892-1.892-4.1-3.382-6.622-4.468A.749.749 0 010 9.96c0-.619.365-1.13.902-1.362a19.64 19.64 0 002.98-1.008c2.523-1.086 4.73-2.576 6.622-4.468 1.892-1.892 3.382-4.1 4.468-6.622A.749.749 0 0112 0z"
        fill="url(#gemini-grad)"
      />
    </svg>
  );
}

function CustomLogo({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={cn("shrink-0", className)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 9l6 6" />
      <path d="M15 9l-6 6" />
    </svg>
  );
}

export function ProviderLogo({
  provider,
  size = 16,
  className,
}: {
  provider?: string | null;
  size?: number;
  className?: string;
}) {
  const key = provider?.toLowerCase() ?? "custom";
  const LogoComponent = PROVIDER_LOGOS[key] ?? CustomLogo;
  return <LogoComponent size={size} className={className} />;
}
