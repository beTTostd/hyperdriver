import Link from "next/link";

type BrandProps = {
  href?: string;
  subtitle?: string;
};

export default function Brand({ href = "/", subtitle = "Pitwall" }: BrandProps) {
  return (
    <Link className="brand-lockup" href={href} aria-label="Hyperdriver — início">
      <span className="brand-symbol" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span className="brand-copy">
        <strong>Hyperdriver</strong>
        <small>{subtitle}</small>
      </span>
    </Link>
  );
}
