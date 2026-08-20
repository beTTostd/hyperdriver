import Link from "next/link";

type BrandProps = {
  href?: string;
  subtitle?: string | null;
};

export function BrandSymbol({ className = "" }: { className?: string }) {
  return (
    <span className={`brand-symbol ${className}`.trim()} aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

export default function Brand({ href = "/", subtitle = "Pitwall" }: BrandProps) {
  return (
    <Link className="brand-lockup" href={href} aria-label="Hyperdriver — início">
      <BrandSymbol />
      <span className="brand-copy">
        <strong>Hyperdriver</strong>
        {subtitle && <small>{subtitle}</small>}
      </span>
    </Link>
  );
}
