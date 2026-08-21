import type { ReactNode, SVGProps } from "react";

export type IconName =
  | "alertTriangle"
  | "arrowDown"
  | "arrowRight"
  | "arrowUpRight"
  | "chart"
  | "check"
  | "chevronDown"
  | "chevronRight"
  | "clipboard"
  | "download"
  | "externalLink"
  | "heart"
  | "imageEdit"
  | "imageOff"
  | "key"
  | "logOut"
  | "plus"
  | "search"
  | "trash"
  | "x";

type IconProps = Omit<SVGProps<SVGSVGElement>, "aria-hidden" | "name"> & {
  name: IconName;
  size?: number;
};

export default function Icon({ name, size = 16, className, ...props }: IconProps) {
  const classes = ["uiIcon", className].filter(Boolean).join(" ");
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

  let content: ReactNode;
  switch (name) {
    case "alertTriangle": content = <><path d="m12 3 9 17H3L12 3Z" /><path d="M12 9v4m0 3h.01" /></>; break;
    case "arrowDown": content = <path d="M12 4v15m-6-6 6 6 6-6" />; break;
    case "arrowRight": content = <path d="M4 12h15m-6-6 6 6-6 6" />; break;
    case "arrowUpRight": content = <path d="M5 19 19 5m-8 0h8v8" />; break;
    case "chart": content = <><path d="M4 20V10h4v10M10 20V4h4v16M16 20v-7h4v7M3 20h18" /></>; break;
    case "check": content = <path d="m5 12 4 4L19 6" />; break;
    case "chevronDown": content = <path d="m6 9 6 6 6-6" />; break;
    case "chevronRight": content = <path d="m9 5 7 7-7 7" />; break;
    case "clipboard": content = <><rect x="5" y="4" width="14" height="17" rx="1" /><path d="M9 4V3h6v1M9 10h6M9 14h4" /></>; break;
    case "download": content = <><path d="M12 3v12m-5-5 5 5 5-5M5 20h14" /></>; break;
    case "externalLink": content = <><path d="M14 5h5v5m-1-4L11 13" /><path d="M18 13v5H5V5h5" /></>; break;
    case "heart": content = <path d="M20.8 8.7c0 5.2-8.8 10.3-8.8 10.3S3.2 13.9 3.2 8.7A4.7 4.7 0 0 1 12 6.2a4.7 4.7 0 0 1 8.8 2.5Z" />; break;
    case "imageEdit": content = <><rect x="3" y="4" width="14" height="15" rx="1" /><circle cx="8" cy="9" r="1.2" /><path d="m4 16 4-4 3 3 2-2 2 2m3-5 2 2-5 5-3 .5.5-3 5-5Z" /></>; break;
    case "imageOff": content = <><rect x="3" y="4" width="18" height="16" rx="1" /><path d="m3 17 5-5 4 4 2-2 7 6M8 9h.01M4 4l16 16" /></>; break;
    case "key": content = <><circle cx="8" cy="15" r="4" /><path d="m11 12 8-8m-3 0 3 3m-6 0 3 3" /></>; break;
    case "logOut": content = <><path d="M10 5H5v14h5M14 8l4 4-4 4m4-4H9" /></>; break;
    case "plus": content = <path d="M12 5v14M5 12h14" />; break;
    case "search": content = <><circle cx="10.5" cy="10.5" r="6" /><path d="m15 15 5 5" /></>; break;
    case "trash": content = <><path d="M4 7h16m-10-3h4l1 3H9l1-3Zm-4 3 1 12h10l1-12M10 11v7m4-7v7" /></>; break;
    case "x": content = <path d="m6 6 12 12M18 6 6 18" />; break;
  }

  return <svg className={classes} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...common} {...props}>{content}</svg>;
}
